-- Preserve one supplier cash movement when its HTTP confirmation is lost.
-- Existing rows remain unchanged; callers without an identity retain legacy behavior.
alter table public.supplier_payments
  add column registration_request_id uuid,
  add column registration_request_payload jsonb,
  add constraint supplier_payments_registration_request_pair check (
    (registration_request_id is null) = (registration_request_payload is null)
  );
create unique index supplier_payments_registration_request_unique
  on public.supplier_payments(registration_request_id) where registration_request_id is not null;

create or replace function public.guard_supplier_payment_mutation()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
declare
  v_transition text;
  v_business_changed boolean;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'posted' then raise exception 'SUPPLIER_PAYMENT_MUST_START_POSTED'; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then raise exception 'SUPPLIER_PAYMENT_DELETE_FORBIDDEN'; end if;

  v_business_changed :=
    new.purchase_order_id is distinct from old.purchase_order_id
    or new.supplier_id is distinct from old.supplier_id
    or new.amount is distinct from old.amount
    or new.currency is distinct from old.currency
    or new.payment_date is distinct from old.payment_date
    or new.method is distinct from old.method
    or new.reference is distinct from old.reference
    or new.notes is distinct from old.notes
    or new.created_by is distinct from old.created_by
    or new.registration_request_id is distinct from old.registration_request_id
    or new.registration_request_payload is distinct from old.registration_request_payload;

  if new.status is distinct from old.status then
    if v_business_changed then raise exception 'SUPPLIER_PAYMENT_IMMUTABLE'; end if;

    v_transition := current_setting('export_mca.supplier_payment_transition', true);
    if old.status = 'posted' and new.status = 'reversed' and v_transition = 'reverse' then
      if new.reversal_reason is null or btrim(new.reversal_reason) = '' then
        raise exception 'SUPPLIER_PAYMENT_REVERSAL_REASON_REQUIRED';
      end if;
      return new;
    end if;

    raise exception 'INVALID_SUPPLIER_PAYMENT_STATUS_TRANSITION: % -> %', old.status, new.status;
  end if;

  raise exception 'SUPPLIER_PAYMENT_IMMUTABLE';
end;
$function$;


-- Default eighth arguments preserve old seven-argument callers without overloads.
-- Only identified requests emit SQL audit. Old API callers keep their existing
-- caller-side audit during a migration-first rollout; new API calls always identify.
-- Catalog preflight confirmed no database dependents on these signatures.
drop function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid);
create function public.register_supplier_payment(
  p_purchase_order_id uuid,p_amount numeric,p_payment_date date default current_date,
  p_method text default null,p_reference text default null,p_notes text default null,
  p_actor uuid default null,p_request_id uuid default null
) returns public.supplier_payments language plpgsql security definer
set search_path = public,pg_temp as $function$
declare
  v_payment public.supplier_payments;
  v_payload jsonb;
begin
  if coalesce(p_amount,0)<=0 or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'SUPPLIER_PAYMENT_AMOUNT_INVALID'; end if;
  if p_amount<>round(p_amount,2) then raise exception 'SUPPLIER_PAYMENT_AMOUNT_PRECISION'; end if;
  v_payload:=jsonb_build_object('action','register','target',p_purchase_order_id,'amount',p_amount,
    'payment_date',p_payment_date,'method',nullif(btrim(p_method),''),
    'reference',nullif(btrim(p_reference),''),'notes',nullif(btrim(p_notes),''),'actor',p_actor);
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('supplier-payment:' || p_request_id::text,0));
    select * into v_payment from public.supplier_payments where registration_request_id=p_request_id;
    if found then
      if v_payment.registration_request_payload is distinct from v_payload then
        raise exception 'SUPPLIER_PAYMENT_REQUEST_CONFLICT';
      end if;
      -- A replay returns the original row even after settlement, redistribution or reversal.
      return v_payment;
    end if;
  end if;
  insert into public.supplier_payments(purchase_order_id,supplier_id,amount,currency,payment_date,
    method,reference,status,notes,created_by,registration_request_id,registration_request_payload)
  values(p_purchase_order_id,'00000000-0000-0000-0000-000000000000'::uuid,p_amount,'USD',
    coalesce(p_payment_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference),''),
    'posted',nullif(btrim(p_notes),''),p_actor,p_request_id,
    case when p_request_id is not null then v_payload else null end)
  returning * into v_payment;
  if p_actor is not null and p_request_id is not null then
    insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
    values(p_actor,(select username from public.admin_users where id=p_actor),
      'supplier_payment_registered','supplier_payment',v_payment.id,
      jsonb_build_object('payment_number',v_payment.payment_number,'purchase_order_id',v_payment.purchase_order_id,
        'amount',v_payment.amount));
  end if;
  return v_payment;
end;
$function$;

drop function public.pay_supplier_bill_canonical(uuid,numeric,date,text,text,text,uuid);
create function public.pay_supplier_bill_canonical(
  p_supplier_bill_id uuid,p_amount numeric,p_payment_date date default current_date,
  p_method text default null,p_reference text default null,p_notes text default null,
  p_actor uuid default null,p_request_id uuid default null
) returns public.supplier_payments language plpgsql security definer
set search_path = public,pg_temp as $function$
declare
  v_payment public.supplier_payments;
  v_payload jsonb;
  v_bill public.supplier_bills;
  v_balance numeric;
begin
  if coalesce(p_amount,0)<=0 or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'SUPPLIER_PAYMENT_AMOUNT_INVALID'; end if;
  if p_amount<>round(p_amount,2) then raise exception 'SUPPLIER_PAYMENT_AMOUNT_PRECISION'; end if;
  v_payload:=jsonb_build_object('action','pay_bill','target',p_supplier_bill_id,'amount',p_amount,
    'payment_date',p_payment_date,'method',nullif(btrim(p_method),''),
    'reference',nullif(btrim(p_reference),''),'notes',nullif(btrim(p_notes),''),'actor',p_actor);
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('supplier-payment:' || p_request_id::text,0));
    select * into v_payment from public.supplier_payments where registration_request_id=p_request_id;
    if found then
      if v_payment.registration_request_payload is distinct from v_payload then
        raise exception 'SUPPLIER_PAYMENT_REQUEST_CONFLICT';
      end if;
      -- A replay returns the original row even after settlement, redistribution or reversal.
      return v_payment;
    end if;
  end if;
  perform public.assert_supplier_bill_action(p_supplier_bill_id,'pay');
  select * into v_bill from public.supplier_bills where id=p_supplier_bill_id for update;
  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;
  if v_bill.status<>'posted' then raise exception 'SUPPLIER_BILL_NOT_POSTED'; end if;
  select coalesce(balance_due,0) into v_balance from public.supplier_bill_financial_progress
    where supplier_bill_id=p_supplier_bill_id;
  if coalesce(v_balance,0)<=0 then raise exception 'SUPPLIER_BILL_ALREADY_PAID'; end if;
  if p_amount>v_balance then raise exception 'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL'; end if;
  insert into public.supplier_payments(purchase_order_id,supplier_id,amount,currency,payment_date,
    method,reference,status,notes,created_by,registration_request_id,registration_request_payload)
  values(v_bill.purchase_order_id,'00000000-0000-0000-0000-000000000000'::uuid,p_amount,'USD',
    coalesce(p_payment_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference),''),
    'posted',nullif(btrim(p_notes),''),p_actor,p_request_id,
    case when p_request_id is not null then v_payload else null end)
  returning * into v_payment;
  select * into v_payment from public.replace_supplier_payment_applications(
    v_payment.id,jsonb_build_array(jsonb_build_object('supplier_bill_id',p_supplier_bill_id::text,'amount',p_amount::text)),p_actor);
  if p_actor is not null and p_request_id is not null then
    insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
    values(p_actor,(select username from public.admin_users where id=p_actor),
      'supplier_bill_paid','supplier_payment',v_payment.id,
      jsonb_build_object('payment_number',v_payment.payment_number,'purchase_order_id',v_payment.purchase_order_id,
        'amount',v_payment.amount,'supplier_bill_id',p_supplier_bill_id));
  end if;
  return v_payment;
end;
$function$;

revoke all on function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid,uuid) to service_role;
revoke all on function public.pay_supplier_bill_canonical(uuid,numeric,date,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.pay_supplier_bill_canonical(uuid,numeric,date,text,text,text,uuid,uuid) to service_role;
