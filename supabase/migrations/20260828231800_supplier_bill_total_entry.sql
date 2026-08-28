-- Allow supplier bills to preserve an exact invoiced line total while retaining
-- unit_cost as a derived/auxiliary value for unit economics.

alter table public.supplier_bill_items
  add column if not exists entered_line_total numeric;

alter table public.supplier_bill_items
  drop constraint if exists supplier_bill_items_entered_line_total_nonnegative;

alter table public.supplier_bill_items
  add constraint supplier_bill_items_entered_line_total_nonnegative
  check (entered_line_total is null or entered_line_total >= 0);

comment on column public.supplier_bill_items.entered_line_total is
  'Exact supplier-invoiced line total when captured by total instead of unit cost. NULL means line_total is quantity * unit_cost.';

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
    if v_quantity <= 0 then raise exception 'SUPPLIER_BILL_QUANTITY_INVALID'; end if;
    if v_entered_line_total is not null and v_entered_line_total < 0 then
      raise exception 'SUPPLIER_BILL_LINE_TOTAL_INVALID';
    end if;

    if v_entered_line_total is not null then
      v_unit_cost := v_entered_line_total / v_quantity;
    elsif v_unit_cost is null or v_unit_cost < 0 then
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

create or replace view public.supplier_bill_financial_progress
with (security_invoker = true)
as
select sb.id as supplier_bill_id,
       sb.bill_number,
       sb.purchase_order_id,
       sb.supplier_id,
       sb.supplier_invoice_number,
       sb.bill_date,
       sb.due_date,
       sb.currency,
       sb.status,
       coalesce(lines.bill_total,0::numeric) as bill_total,
       case when sb.status = 'posted' then coalesce(apps.paid_amount,0::numeric) else 0::numeric end as paid_amount,
       case when sb.status = 'posted' then greatest(coalesce(lines.bill_total,0::numeric)-coalesce(apps.paid_amount,0::numeric),0::numeric) else 0::numeric end as balance_due,
       case
         when sb.status <> 'posted' then sb.status
         when coalesce(lines.bill_total,0::numeric) <= coalesce(apps.paid_amount,0::numeric) then 'paid'::text
         when coalesce(apps.paid_amount,0::numeric) > 0::numeric then 'partial'::text
         else 'unpaid'::text
       end as payment_status,
       (sb.status='posted' and sb.due_date is not null and sb.due_date < current_date and coalesce(lines.bill_total,0::numeric) > coalesce(apps.paid_amount,0::numeric)) as overdue
from public.supplier_bills sb
left join lateral (
  select sum(coalesce(sbi.entered_line_total,sbi.line_total)) as bill_total
  from public.supplier_bill_items sbi
  where sbi.supplier_bill_id = sb.id
) lines on true
left join lateral (
  select sum(spa.amount) as paid_amount
  from public.supplier_payment_applications spa
  join public.supplier_payments sp on sp.id=spa.supplier_payment_id
  where spa.supplier_bill_id=sb.id and sp.status='posted'
) apps on true;

create or replace view public.purchase_order_item_merchandise_cost_basis
with (security_invoker = true)
as
with actual as (
  select sbi.purchase_order_item_id,
         coalesce(sum(sbi.billed_quantity),0::numeric) as billed_quantity,
         coalesce(sum(coalesce(sbi.entered_line_total,sbi.line_total)),0::numeric) as billed_cost
  from public.supplier_bill_items sbi
  join public.supplier_bills sb on sb.id=sbi.supplier_bill_id
  where sb.status='posted'
  group by sbi.purchase_order_item_id
)
select poi.id as purchase_order_item_id,
       poi.purchase_order_id,
       poi.product_id,
       poi.ordered_quantity,
       poi.unit,
       poi.unit_cost as estimated_unit_cost,
       poi.currency,
       coalesce(a.billed_quantity,0::numeric) as actual_billed_quantity,
       coalesce(a.billed_cost,0::numeric) as actual_billed_cost,
       greatest(poi.ordered_quantity-coalesce(a.billed_quantity,0::numeric),0::numeric) as estimated_remaining_quantity,
       case when coalesce(a.billed_quantity,0::numeric)>0 then a.billed_cost/a.billed_quantity else null::numeric end as actual_unit_cost,
       case
         when poi.ordered_quantity>0 and coalesce(a.billed_quantity,0::numeric)>=poi.ordered_quantity and coalesce(a.billed_quantity,0::numeric)>0 then a.billed_cost
         when coalesce(a.billed_quantity,0::numeric)>0 and poi.unit_cost is not null and poi.ordered_quantity>0 then a.billed_cost+(greatest(poi.ordered_quantity-a.billed_quantity,0::numeric)*poi.unit_cost)
         when coalesce(a.billed_quantity,0::numeric)=0 and poi.unit_cost is not null and poi.ordered_quantity>0 then poi.ordered_quantity*poi.unit_cost
         else null::numeric
       end as recognized_merchandise_cost,
       case
         when poi.ordered_quantity>0 and coalesce(a.billed_quantity,0::numeric)>=poi.ordered_quantity and coalesce(a.billed_quantity,0::numeric)>0 then a.billed_cost/a.billed_quantity
         when coalesce(a.billed_quantity,0::numeric)>0 and poi.unit_cost is not null and poi.ordered_quantity>0 then (a.billed_cost+(greatest(poi.ordered_quantity-a.billed_quantity,0::numeric)*poi.unit_cost))/poi.ordered_quantity
         when coalesce(a.billed_quantity,0::numeric)=0 and poi.unit_cost is not null then poi.unit_cost
         else null::numeric
       end as recognized_unit_cost,
       case
         when poi.ordered_quantity>0 and coalesce(a.billed_quantity,0::numeric)>=poi.ordered_quantity and coalesce(a.billed_quantity,0::numeric)>0 then 'actual'::text
         when coalesce(a.billed_quantity,0::numeric)>0 and poi.unit_cost is not null and poi.ordered_quantity>0 then 'partial_actual'::text
         when coalesce(a.billed_quantity,0::numeric)=0 and poi.unit_cost is not null then 'estimated'::text
         else 'incomplete_allocation'::text
       end as cost_coverage
from public.purchase_order_items poi
left join actual a on a.purchase_order_item_id=poi.id;

create or replace function public.validate_supplier_payment_application()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_bill record;
  v_payment_applied numeric;
  v_bill_applied numeric;
  v_bill_total numeric;
begin
  select id, purchase_order_id, supplier_id, currency, amount, status
    into v_payment
  from public.supplier_payments
  where id = new.supplier_payment_id
  for update;

  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND'; end if;
  if v_payment.status <> 'posted' then raise exception 'SUPPLIER_PAYMENT_NOT_POSTED'; end if;

  select id, purchase_order_id, supplier_id, currency, status
    into v_bill
  from public.supplier_bills
  where id = new.supplier_bill_id
  for update;

  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'posted' then raise exception 'SUPPLIER_BILL_NOT_POSTED'; end if;

  if v_payment.purchase_order_id <> v_bill.purchase_order_id
     or v_payment.supplier_id <> v_bill.supplier_id
     or v_payment.currency <> v_bill.currency then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_CONTEXT_MISMATCH';
  end if;

  select coalesce(sum(amount),0)
    into v_payment_applied
  from public.supplier_payment_applications
  where supplier_payment_id = new.supplier_payment_id
    and id <> new.id;

  if v_payment_applied + new.amount > v_payment.amount then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_PAYMENT';
  end if;

  select coalesce(sum(coalesce(entered_line_total,line_total)),0)
    into v_bill_total
  from public.supplier_bill_items
  where supplier_bill_id = new.supplier_bill_id;

  select coalesce(sum(spa.amount),0)
    into v_bill_applied
  from public.supplier_payment_applications spa
  join public.supplier_payments sp on sp.id = spa.supplier_payment_id
  where spa.supplier_bill_id = new.supplier_bill_id
    and spa.id <> new.id
    and sp.status = 'posted';

  if v_bill_applied + new.amount > v_bill_total then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL';
  end if;

  return new;
end;
$function$;
