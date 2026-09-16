-- Keep the existing supplier line amount as the single rounded monetary source.
-- Quantities and unit rates retain full precision; exact entered totals are cents.
alter table public.supplier_bill_items
  alter column line_total set expression as (round(billed_quantity * unit_cost,2));

alter table public.supplier_bill_items
  add constraint supplier_bill_items_finite_values
  check (billed_quantity::text not in ('NaN','Infinity','-Infinity')
    and unit_cost::text not in ('NaN','Infinity','-Infinity')
    and line_total::text not in ('NaN','Infinity','-Infinity')
    and (entered_line_total is null or entered_line_total::text not in ('NaN','Infinity','-Infinity'))),
  add constraint supplier_bill_items_exact_total_cents
  check (entered_line_total is null or entered_line_total = round(entered_line_total,2));
alter table public.supplier_payments
  add constraint supplier_payments_finite_cents
  check (amount::text not in ('NaN','Infinity','-Infinity') and amount=round(amount,2));
alter table public.supplier_payment_applications
  add constraint supplier_payment_applications_finite_cents
  check (amount::text not in ('NaN','Infinity','-Infinity') and amount=round(amount,2));

create or replace function public.populate_supplier_bill_items(p_supplier_bill_id uuid, p_lines jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_line jsonb;
  v_po_item_id uuid;
  v_quantity numeric;
  v_unit_cost numeric;
  v_entered_line_total numeric;
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
    v_entered_line_total := nullif(btrim(v_line->>'line_total'),'')::numeric;

    if v_po_item_id is null then raise exception 'SUPPLIER_BILL_PO_ITEM_REQUIRED'; end if;
    if v_quantity <= 0 or v_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'SUPPLIER_BILL_QUANTITY_INVALID'; end if;
    if v_entered_line_total is not null and (v_entered_line_total < 0 or v_entered_line_total::text in ('NaN','Infinity','-Infinity')) then
      raise exception 'SUPPLIER_BILL_LINE_TOTAL_INVALID';
    end if;

    if v_entered_line_total is not null and v_entered_line_total <> round(v_entered_line_total,2) then
      raise exception 'SUPPLIER_BILL_LINE_TOTAL_PRECISION';
    end if;
    if v_entered_line_total is not null then
      v_unit_cost := v_entered_line_total / v_quantity;
    elsif v_unit_cost is null or v_unit_cost < 0 or v_unit_cost::text in ('NaN','Infinity','-Infinity') then
      raise exception 'SUPPLIER_BILL_COST_REQUIRED';
    end if;

    insert into public.supplier_bill_items(
      supplier_bill_id, purchase_order_item_id, product_id, unit,
      billed_quantity, unit_cost, entered_line_total, currency, notes
    ) values (
      p_supplier_bill_id,
      v_po_item_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'snapshot',
      v_quantity,
      v_unit_cost,
      v_entered_line_total,
      'USD',
      nullif(btrim(v_line->>'notes'),'')
    );
  end loop;
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
  if coalesce(p_amount,0) <= 0 or p_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'SUPPLIER_PAYMENT_AMOUNT_INVALID'; end if;

  if p_amount <> round(p_amount,2) then raise exception 'SUPPLIER_PAYMENT_AMOUNT_PRECISION'; end if;

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
    if v_amount <= 0 or v_amount::text in ('NaN','Infinity','-Infinity') then raise exception 'SUPPLIER_PAYMENT_APPLICATION_AMOUNT_INVALID'; end if;

    if v_amount <> round(v_amount,2) then raise exception 'SUPPLIER_PAYMENT_APPLICATION_AMOUNT_PRECISION'; end if;

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


create or replace function public.pay_supplier_bill(
  p_supplier_bill_id uuid,
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
set search_path = 'public'
as $function$
declare
  v_bill public.supplier_bills;
  v_balance numeric;
  v_payment public.supplier_payments;
begin
  if coalesce(p_amount,0) <= 0 or p_amount::text in ('NaN','Infinity','-Infinity') then
    raise exception 'SUPPLIER_PAYMENT_AMOUNT_INVALID';
  end if;

  if p_amount <> round(p_amount,2) then raise exception 'SUPPLIER_PAYMENT_AMOUNT_PRECISION'; end if;

  select * into v_bill
  from public.supplier_bills
  where id = p_supplier_bill_id
  for update;

  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'posted' then raise exception 'SUPPLIER_BILL_NOT_POSTED'; end if;

  select coalesce(balance_due,0)
    into v_balance
  from public.supplier_bill_financial_progress
  where supplier_bill_id = p_supplier_bill_id;

  if coalesce(v_balance,0) <= 0 then
    raise exception 'SUPPLIER_BILL_ALREADY_PAID';
  end if;
  if p_amount > v_balance then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL';
  end if;

  select * into v_payment
  from public.register_supplier_payment(
    v_bill.purchase_order_id,
    p_amount,
    coalesce(p_payment_date,current_date),
    p_method,
    p_reference,
    p_notes,
    p_actor
  );

  select * into v_payment
  from public.replace_supplier_payment_applications(
    v_payment.id,
    jsonb_build_array(jsonb_build_object(
      'supplier_bill_id', p_supplier_bill_id::text,
      'amount', p_amount::text
    )),
    p_actor
  );

  return v_payment;
end;
$function$;


-- CREATE OR REPLACE preserves existing EXECUTE privileges. Restate the intended
-- boundary: only the canonical payment action and standalone advance RPC are public to the backend.
revoke all on function public.populate_supplier_bill_items(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.register_supplier_payment(uuid,numeric,date,text,text,text,uuid) to service_role;
revoke all on function public.replace_supplier_payment_applications(uuid,jsonb,uuid) from public,anon,authenticated,service_role;
revoke all on function public.pay_supplier_bill(uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated,service_role;
analyze public.supplier_bill_items;
