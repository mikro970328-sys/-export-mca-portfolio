-- A transport retry is the same collection, not a second receipt of money.
-- Keep the existing payments ledger and all invoice/currency/credit guards.
-- Historical rows and callers without a request ID retain their prior behavior.
alter table public.payments
  add column registration_request_id uuid,
  add column registration_request_payload jsonb,
  add constraint payments_registration_request_pair check (
    (registration_request_id is null) = (registration_request_payload is null)
  );
create unique index payments_registration_request_unique
  on public.payments(registration_request_id) where registration_request_id is not null;

create or replace function public.guard_payment_structure()
returns trigger language plpgsql set search_path = public, pg_temp as $function$
begin
  if tg_op = 'UPDATE' and (
    new.invoice_id is distinct from old.invoice_id or
    new.operation_id is distinct from old.operation_id or
    new.client_id is distinct from old.client_id or
    new.amount is distinct from old.amount or
    new.currency is distinct from old.currency or
    new.payment_date is distinct from old.payment_date or
    new.method is distinct from old.method or
    new.reference_number is distinct from old.reference_number or
    new.registration_request_id is distinct from old.registration_request_id or
    new.registration_request_payload is distinct from old.registration_request_payload
  ) then raise exception 'PAYMENT_STRUCTURE_LOCKED'; end if;
  return new;
end;
$function$;

-- No overload: the two added default arguments preserve legacy six-argument calls.
-- The old signature has no database dependents (verified before deployment).
drop function public.register_invoice_payment(uuid,numeric,date,text,text,text);
create function public.register_invoice_payment(
  p_invoice_id uuid, p_amount numeric, p_payment_date date default current_date,
  p_method text default null, p_reference_number text default null, p_notes text default null,
  p_request_id uuid default null, p_actor uuid default null
) returns public.payments language plpgsql security definer
set search_path = public, pg_temp as $function$
declare
  v_payment public.payments;
  v_payload jsonb;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;
  v_payload := jsonb_build_object('invoice_id',p_invoice_id,'amount',p_amount,
    'payment_date',p_payment_date,'method',nullif(btrim(p_method),''),
    'reference_number',nullif(btrim(p_reference_number),''),'notes',nullif(btrim(p_notes),''),
    'actor',p_actor);
  if p_request_id is not null then
    perform pg_advisory_xact_lock(hashtextextended('invoice-payment:' || p_request_id::text,0));
    select * into v_payment from public.payments where registration_request_id=p_request_id;
    if found then
      if v_payment.registration_request_payload is distinct from v_payload then
        raise exception 'PAYMENT_REQUEST_CONFLICT';
      end if;
      -- Return even if fully settled or subsequently reversed; never recreate it.
      return v_payment;
    end if;
  end if;
  perform public.assert_invoice_action(p_invoice_id,'record_payment');
  insert into public.payments(invoice_id,operation_id,client_id,amount,currency,payment_date,
    method,reference_number,status,notes,created_by,registration_request_id,registration_request_payload)
  values(p_invoice_id,null,'00000000-0000-0000-0000-000000000000'::uuid,p_amount,'USD',
    coalesce(p_payment_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference_number),''),
    'posted',nullif(btrim(p_notes),''),p_actor,p_request_id,
    case when p_request_id is not null then v_payload else null end)
  returning * into v_payment;
  -- Receipt and its audit either both commit or neither does.
  if p_actor is not null then
    insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
    values(p_actor,(select username from public.admin_users where id=p_actor),
      'invoice_payment_registered','payment',v_payment.id,
      jsonb_build_object('invoice_id',v_payment.invoice_id,'amount',v_payment.amount,
        'currency',v_payment.currency,'reference_number',v_payment.reference_number));
  end if;
  return v_payment;
end;
$function$;
revoke all on function public.register_invoice_payment(uuid,numeric,date,text,text,text,uuid,uuid) from public,anon,authenticated;
grant execute on function public.register_invoice_payment(uuid,numeric,date,text,text,text,uuid,uuid) to service_role;
