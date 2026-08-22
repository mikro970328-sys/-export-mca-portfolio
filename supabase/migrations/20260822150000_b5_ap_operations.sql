-- B5.2 · Transactional Accounts Payable operations
-- All AP mutations become backend-only RPCs.

create or replace function public.populate_supplier_bill_items(
  p_supplier_bill_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_line jsonb;
  v_po_item_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'SUPPLIER_BILL_HAS_NO_ITEMS';
  end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'SUPPLIER_BILL_TOO_MANY_ITEMS'; end if;

  if not exists (
    select 1 from public.supplier_bills where id = p_supplier_bill_id and status = 'draft'
  ) then
    raise exception 'SUPPLIER_BILL_NOT_DRAFT';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'SUPPLIER_BILL_ITEM_INVALID'; end if;

    v_po_item_id := nullif(btrim(v_line->>'purchase_order_item_id'),'')::uuid;
    v_quantity := coalesce(nullif(btrim(v_line->>'billed_quantity'),'')::numeric,0);
    v_unit_cost := nullif(btrim(v_line->>'unit_cost'),'')::numeric;

    if v_po_item_id is null then raise exception 'SUPPLIER_BILL_PO_ITEM_REQUIRED'; end if;
    if v_quantity <= 0 then raise exception 'SUPPLIER_BILL_QUANTITY_INVALID'; end if;
    if v_unit_cost is null or v_unit_cost < 0 then raise exception 'SUPPLIER_BILL_UNIT_COST_INVALID'; end if;

    insert into public.supplier_bill_items(
      supplier_bill_id, purchase_order_item_id, product_id, unit,
      billed_quantity, unit_cost, currency, notes
    ) values (
      p_supplier_bill_id,
      v_po_item_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'snapshot',
      v_quantity,
      v_unit_cost,
      'USD',
      nullif(btrim(v_line->>'notes'),'')
    );
  end loop;
end;
$function$;

create or replace function public.create_supplier_bill_plan(
  p_purchase_order_id uuid,
  p_lines jsonb,
  p_supplier_invoice_number text default null,
  p_bill_date date default current_date,
  p_due_date date default null,
  p_notes text default null,
  p_actor uuid default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill public.supplier_bills;
begin
  insert into public.supplier_bills(
    purchase_order_id, supplier_id, supplier_invoice_number,
    bill_date, due_date, currency, status, notes, created_by
  ) values (
    p_purchase_order_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    nullif(btrim(p_supplier_invoice_number),''),
    coalesce(p_bill_date,current_date),
    p_due_date,
    'USD',
    'draft',
    nullif(btrim(p_notes),''),
    p_actor
  ) returning * into v_bill;

  perform public.populate_supplier_bill_items(v_bill.id, p_lines);
  select * into v_bill from public.supplier_bills where id = v_bill.id;
  return v_bill;
end;
$function$;

create or replace function public.replace_supplier_bill_plan(
  p_supplier_bill_id uuid,
  p_purchase_order_id uuid,
  p_lines jsonb,
  p_supplier_invoice_number text default null,
  p_bill_date date default current_date,
  p_due_date date default null,
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill public.supplier_bills;
begin
  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'draft' then raise exception 'SUPPLIER_BILL_NOT_DRAFT'; end if;

  delete from public.supplier_bill_items where supplier_bill_id = p_supplier_bill_id;

  update public.supplier_bills
     set purchase_order_id = p_purchase_order_id,
         supplier_invoice_number = nullif(btrim(p_supplier_invoice_number),''),
         bill_date = coalesce(p_bill_date,current_date),
         due_date = p_due_date,
         notes = nullif(btrim(p_notes),'')
   where id = p_supplier_bill_id;

  perform public.populate_supplier_bill_items(p_supplier_bill_id, p_lines);
  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id;
  return v_bill;
end;
$function$;

create or replace function public.transition_supplier_bill(
  p_supplier_bill_id uuid,
  p_action text,
  p_actor uuid default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_bill public.supplier_bills;
  v_action text := lower(btrim(coalesce(p_action,'')));
begin
  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id for update;
  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;

  if v_action = 'post' then
    if v_bill.status <> 'draft' then raise exception 'SUPPLIER_BILL_NOT_DRAFT'; end if;
    perform set_config('export_mca.supplier_bill_transition','post',true);
    update public.supplier_bills
       set status = 'posted', posted_at = now()
     where id = p_supplier_bill_id;
  elsif v_action = 'void' then
    if v_bill.status not in ('draft','posted') then raise exception 'SUPPLIER_BILL_CANNOT_VOID'; end if;
    perform set_config('export_mca.supplier_bill_transition','void',true);
    update public.supplier_bills
       set status = 'void', voided_at = now()
     where id = p_supplier_bill_id;
  else
    raise exception 'SUPPLIER_BILL_ACTION_INVALID';
  end if;

  select * into v_bill from public.supplier_bills where id = p_supplier_bill_id;
  return v_bill;
end;
$function$;

create or replace function public.register_supplier_payment(
  p_purchase_order_id uuid,
  p_amount numeric,
  p_payment_date date default current_date,
  p_method text default null,
  p_reference text default null,
  p_notes text default null,
  p_actor uuid default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.supplier_payments;
begin
  if coalesce(p_amount,0) <= 0 then raise exception 'SUPPLIER_PAYMENT_AMOUNT_INVALID'; end if;

  insert into public.supplier_payments(
    purchase_order_id, supplier_id, amount, currency, payment_date,
    method, reference, status, notes, created_by
  ) values (
    p_purchase_order_id,
    '00000000-0000-0000-0000-000000000000'::uuid,
    p_amount,
    'USD',
    coalesce(p_payment_date,current_date),
    nullif(btrim(p_method),''),
    nullif(btrim(p_reference),''),
    'posted',
    nullif(btrim(p_notes),''),
    p_actor
  ) returning * into v_payment;

  return v_payment;
end;
$function$;

create or replace function public.reverse_supplier_payment(
  p_supplier_payment_id uuid,
  p_reason text,
  p_actor uuid default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.supplier_payments;
  v_reason text := nullif(btrim(p_reason),'');
begin
  if v_reason is null then raise exception 'SUPPLIER_PAYMENT_REVERSAL_REASON_REQUIRED'; end if;

  select * into v_payment from public.supplier_payments where id = p_supplier_payment_id for update;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND'; end if;
  if v_payment.status = 'reversed' then raise exception 'SUPPLIER_PAYMENT_ALREADY_REVERSED'; end if;

  perform set_config('export_mca.supplier_payment_transition','reverse',true);
  update public.supplier_payments
     set status = 'reversed',
         reversed_at = now(),
         reversed_by = p_actor,
         reversal_reason = v_reason
   where id = p_supplier_payment_id;

  select * into v_payment from public.supplier_payments where id = p_supplier_payment_id;
  return v_payment;
end;
$function$;

create or replace function public.replace_supplier_payment_applications(
  p_supplier_payment_id uuid,
  p_applications jsonb,
  p_actor uuid default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.supplier_payments;
  v_app jsonb;
  v_bill_id uuid;
  v_amount numeric;
begin
  select * into v_payment from public.supplier_payments where id = p_supplier_payment_id for update;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND'; end if;
  if v_payment.status <> 'posted' then raise exception 'SUPPLIER_PAYMENT_NOT_POSTED'; end if;

  if p_applications is null or jsonb_typeof(p_applications) <> 'array' then
    raise exception 'SUPPLIER_PAYMENT_APPLICATIONS_INVALID';
  end if;
  if jsonb_array_length(p_applications) > 500 then raise exception 'SUPPLIER_PAYMENT_TOO_MANY_APPLICATIONS'; end if;

  perform set_config('export_mca.supplier_payment_application_delete','allow',true);
  delete from public.supplier_payment_applications
  where supplier_payment_id = p_supplier_payment_id;

  for v_app in select value from jsonb_array_elements(p_applications)
  loop
    if jsonb_typeof(v_app) <> 'object' then raise exception 'SUPPLIER_PAYMENT_APPLICATION_INVALID'; end if;
    v_bill_id := nullif(btrim(v_app->>'supplier_bill_id'),'')::uuid;
    v_amount := coalesce(nullif(btrim(v_app->>'amount'),'')::numeric,0);
    if v_bill_id is null then raise exception 'SUPPLIER_PAYMENT_BILL_REQUIRED'; end if;
    if v_amount <= 0 then raise exception 'SUPPLIER_PAYMENT_APPLICATION_AMOUNT_INVALID'; end if;

    insert into public.supplier_payment_applications(
      supplier_payment_id, supplier_bill_id, amount, created_by
    ) values (
      p_supplier_payment_id, v_bill_id, v_amount, p_actor
    );
  end loop;

  select * into v_payment from public.supplier_payments where id = p_supplier_payment_id;
  return v_payment;
end;
$function$;

-- Only the RPC layer may mutate AP after B5.2.
revoke insert, update, delete on public.supplier_bills from service_role;
revoke insert, update, delete on public.supplier_bill_items from service_role;
revoke insert, update, delete on public.supplier_payments from service_role;
revoke insert, update, delete on public.supplier_payment_applications from service_role;
revoke all on sequence public.supplier_bills_bill_serial_seq from service_role;
revoke all on sequence public.supplier_payments_payment_serial_seq from service_role;

grant select on public.supplier_bills to service_role;
grant select on public.supplier_bill_items to service_role;
grant select on public.supplier_payments to service_role;
grant select on public.supplier_payment_applications to service_role;

revoke all on function public.populate_supplier_bill_items(uuid,jsonb) from public, anon, authenticated, service_role;

revoke all on function public.create_supplier_bill_plan(uuid,jsonb,text,date,date,text,uuid) from public, anon, authenticated;
revoke all on function public.replace_supplier_bill_plan(uuid,uuid,jsonb,text,date,date,text) from public, anon, authenticated;
revoke all on function public.transition_supplier_bill(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid) from public, anon, authenticated;
revoke all on function public.reverse_supplier_payment(uuid,text,uuid) from public, anon, authenticated;
revoke all on function public.replace_supplier_payment_applications(uuid,jsonb,uuid) from public, anon, authenticated;

grant execute on function public.create_supplier_bill_plan(uuid,jsonb,text,date,date,text,uuid) to service_role;
grant execute on function public.replace_supplier_bill_plan(uuid,uuid,jsonb,text,date,date,text) to service_role;
grant execute on function public.transition_supplier_bill(uuid,text,uuid) to service_role;
grant execute on function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid) to service_role;
grant execute on function public.reverse_supplier_payment(uuid,text,uuid) to service_role;
grant execute on function public.replace_supplier_payment_applications(uuid,jsonb,uuid) to service_role;

comment on function public.create_supplier_bill_plan(uuid,jsonb,text,date,date,text,uuid) is 'Creates a complete draft supplier bill atomically from immutable PO lines.';
comment on function public.replace_supplier_bill_plan(uuid,uuid,jsonb,text,date,date,text) is 'Replaces a draft supplier bill atomically.';
comment on function public.transition_supplier_bill(uuid,text,uuid) is 'Posts or voids a supplier bill through guarded lifecycle transitions.';
comment on function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid) is 'Registers an immutable supplier cash outflow/prepayment against a PO.';
comment on function public.reverse_supplier_payment(uuid,text,uuid) is 'Reverses a supplier payment while preserving its history and applications.';
comment on function public.replace_supplier_payment_applications(uuid,jsonb,uuid) is 'Atomically redistributes a posted supplier payment/prepayment across posted bills of the same PO.';
