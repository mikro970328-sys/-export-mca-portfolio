-- Quantity credit notes preserve the original issued invoice and cash ledger.
create sequence public.invoice_credit_note_number_seq;
create table public.invoice_credit_notes (
 id uuid primary key default gen_random_uuid(),
 credit_number text not null unique default ('NC-'||nextval('public.invoice_credit_note_number_seq')::text),
 invoice_id uuid not null references public.invoices(id) on delete restrict,
 request_id uuid not null unique,
 request_payload jsonb not null,
 reason text not null check (length(btrim(reason)) between 3 and 2000),
 total numeric(18,2) not null check (total>=0),
 currency text not null,
 created_by uuid not null references public.admin_users(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index invoice_credit_notes_invoice_idx on public.invoice_credit_notes(invoice_id);
create index invoice_credit_notes_actor_idx on public.invoice_credit_notes(created_by);
create table public.invoice_credit_note_lines (
 id uuid primary key default gen_random_uuid(),
 credit_note_id uuid not null references public.invoice_credit_notes(id) on delete restrict,
 invoice_item_id uuid not null references public.invoice_items(id) on delete restrict,
 quantity numeric not null check (quantity>0 and quantity<>'NaN'::numeric and quantity<>'Infinity'::numeric),
 previous_credited_quantity numeric not null,
 unit_price numeric not null,
 amount numeric(18,2) not null check (amount>=0),
 unique(credit_note_id,invoice_item_id)
);
create index invoice_credit_note_lines_item_idx on public.invoice_credit_note_lines(invoice_item_id);
alter table public.invoice_credit_notes enable row level security;
alter table public.invoice_credit_note_lines enable row level security;
revoke all on public.invoice_credit_notes,public.invoice_credit_note_lines from public,anon,authenticated,service_role;
revoke all on sequence public.invoice_credit_note_number_seq from public,anon,authenticated,service_role;
grant select on public.invoice_credit_notes,public.invoice_credit_note_lines to service_role;

create or replace function public.reject_invoice_credit_mutation()
returns trigger language plpgsql set search_path=public,pg_temp as $$
begin raise exception 'INVOICE_CREDIT_IMMUTABLE'; end;
$$;
revoke all on function public.reject_invoice_credit_mutation() from public,anon,authenticated,service_role;
create trigger invoice_credit_note_immutable before update or delete on public.invoice_credit_notes for each row execute function public.reject_invoice_credit_mutation();
create trigger invoice_credit_line_immutable before update or delete on public.invoice_credit_note_lines for each row execute function public.reject_invoice_credit_mutation();

create or replace view public.invoice_net_items with (security_invoker=true) as
select ii.id,ii.invoice_id,ii.sales_order_item_id,ii.product_id,ii.description,
       (ii.quantity-coalesce(c.quantity,0))::numeric as quantity,
       ii.unit,ii.unit_price,
       (round(ii.line_total,2)-coalesce(c.amount,0))::numeric as line_total,
       ii.notes,ii.created_at,ii.updated_at,
       ii.quantity as original_quantity,round(ii.line_total,2) as original_line_total,
       coalesce(c.quantity,0)::numeric as credited_quantity,
       coalesce(c.amount,0)::numeric as credited_amount
from public.invoice_items ii
left join (select invoice_item_id,sum(quantity) as quantity,sum(amount) as amount from public.invoice_credit_note_lines group by invoice_item_id) c on c.invoice_item_id=ii.id;
revoke all on public.invoice_net_items from public,anon,authenticated;
grant select on public.invoice_net_items to service_role;

create or replace function public.create_invoice_quantity_credit(p_invoice_id uuid,p_request_id uuid,p_lines jsonb,p_reason text,p_actor uuid)
returns public.invoice_credit_notes
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_invoice public.invoices; v_note public.invoice_credit_notes; v_line jsonb;
 v_item public.invoice_items; v_qty numeric; v_prior numeric; v_amount numeric;
 v_total numeric:=0; v_rows jsonb:='[]'::jsonb; v_payload jsonb;
 v_expected numeric; v_seen uuid[]:='{}'::uuid[];
begin
 if not exists(select 1 from public.admin_users where id=p_actor and is_active=true) then raise exception 'INVOICE_CREDIT_ACTOR_INVALID'; end if;
 if p_request_id is null then raise exception 'INVOICE_CREDIT_REQUEST_REQUIRED'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>2000 then raise exception 'INVOICE_CREDIT_REASON_REQUIRED'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'INVOICE_CREDIT_LINES_INVALID'; end if;
 v_payload:=jsonb_build_object('invoice_id',p_invoice_id,'lines',p_lines,'reason',btrim(p_reason));
 select * into v_invoice from public.invoices where id=p_invoice_id for update;
 if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
 select * into v_note from public.invoice_credit_notes where request_id=p_request_id;
 if found then
   if v_note.request_payload is distinct from v_payload or v_note.created_by<>p_actor then raise exception 'INVOICE_CREDIT_REQUEST_CONFLICT'; end if;
   return v_note;
 end if;
 if v_invoice.status<>'issued' then raise exception 'INVOICE_CREDIT_REQUIRES_ISSUED'; end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
   begin
     v_qty:=(v_line->>'quantity')::numeric;
     v_expected:=(v_line->>'expected_credited_quantity')::numeric;
     select * into v_item from public.invoice_items where id=(v_line->>'invoice_item_id')::uuid and invoice_id=p_invoice_id for update;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVOICE_CREDIT_LINES_INVALID'; end;
   if not found or v_item.id=any(v_seen) then raise exception 'INVOICE_CREDIT_LINES_INVALID'; end if;
   v_seen:=array_append(v_seen,v_item.id);
   if v_qty is null or v_qty<=0 or v_qty in ('NaN'::numeric,'Infinity'::numeric) then raise exception 'INVOICE_CREDIT_QUANTITY_INVALID'; end if;
   select coalesce(sum(quantity),0) into v_prior from public.invoice_credit_note_lines where invoice_item_id=v_item.id;
   if v_expected is null or v_expected is distinct from v_prior then raise exception 'INVOICE_CREDIT_STALE'; end if;
   if v_qty+v_prior>v_item.quantity then raise exception 'INVOICE_CREDIT_EXCEEDS_QUANTITY'; end if;
   v_amount:=round((v_item.quantity-v_prior)*v_item.unit_price,2)-round((v_item.quantity-v_prior-v_qty)*v_item.unit_price,2);
   v_total:=v_total+v_amount;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('item',v_item.id,'quantity',v_qty,'prior',v_prior,'price',v_item.unit_price,'amount',v_amount));
 end loop;
 insert into public.invoice_credit_notes(invoice_id,request_id,request_payload,reason,total,currency,created_by)
 values(p_invoice_id,p_request_id,v_payload,btrim(p_reason),v_total,v_invoice.currency,p_actor) returning * into v_note;
 insert into public.invoice_credit_note_lines(credit_note_id,invoice_item_id,quantity,previous_credited_quantity,unit_price,amount)
 select v_note.id,(x->>'item')::uuid,(x->>'quantity')::numeric,(x->>'prior')::numeric,(x->>'price')::numeric,(x->>'amount')::numeric from jsonb_array_elements(v_rows) x;
 -- Publish through the existing invoice live-update trigger, with no ledger mutation.
 update public.invoices set updated_at=now() where id=p_invoice_id;
 return v_note;
end;
$$;
revoke all on function public.create_invoice_quantity_credit(uuid,uuid,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.create_invoice_quantity_credit(uuid,uuid,jsonb,text,uuid) to service_role;

create or replace view public.invoice_financial_progress
with (security_invoker=true)
as
with line_totals as (
  select invoice_id,coalesce(sum(round(line_total,2)),0::numeric) as total
  from public.invoice_net_items
  group by invoice_id
), cash_payment_totals as (
  select invoice_id,coalesce(round(sum(amount),2),0::numeric) as cash_payment_amount
  from public.payments
  where status='posted' and invoice_id is not null
  group by invoice_id
), advance_totals as (
  select caa.invoice_id,coalesce(round(sum(caa.amount),2),0::numeric) as advance_applied_amount
  from public.customer_advance_applications caa
  join public.customer_advances ca on ca.id=caa.customer_advance_id
  where caa.status='posted' and ca.status='posted'
  group by caa.invoice_id
)
select
  i.id as invoice_id,
  i.invoice_number,
  i.sales_order_id,
  i.client_id,
  i.status as invoice_status,
  i.issue_date,
  i.due_date,
  i.currency,
  coalesce(lt.total,0::numeric) as subtotal,
  0::numeric as tax_total,
  coalesce(lt.total,0::numeric) as total,
  round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2) as paid_amount,
  greatest(round(coalesce(lt.total,0::numeric)-coalesce(cpt.cash_payment_amount,0::numeric)-coalesce(at.advance_applied_amount,0::numeric),2),0::numeric) as balance_due,
  case
    when i.status='draft' then 'draft'
    when i.status='void' then 'void'
    when coalesce(lt.total,0)=0 then 'paid'
    when round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2)>=coalesce(lt.total,0::numeric) and coalesce(lt.total,0::numeric)>0 then 'paid'
    when round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2)>0 then 'partial'
    when i.due_date is not null and i.due_date<current_date then 'overdue'
    else 'unpaid'
  end as payment_status,
  coalesce(cpt.cash_payment_amount,0::numeric) as cash_payment_amount,
  coalesce(at.advance_applied_amount,0::numeric) as advance_applied_amount,
  round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2) as settlement_amount,
  coalesce((select sum(round(ii.line_total,2)) from public.invoice_items ii where ii.invoice_id=i.id),0)::numeric as original_total,
  coalesce((select sum(n.total) from public.invoice_credit_notes n where n.invoice_id=i.id),0)::numeric as credited_amount,
  greatest(round(coalesce(cpt.cash_payment_amount,0)+coalesce(at.advance_applied_amount,0)-coalesce(lt.total,0),2),0)::numeric as customer_credit_balance
from public.invoices i
left join line_totals lt on lt.invoice_id=i.id
left join cash_payment_totals cpt on cpt.invoice_id=i.id
left join advance_totals at on at.invoice_id=i.id;

create or replace view public.issued_invoice_item_merchandise_cogs
with (security_invoker = true)
as
with issued_totals as (
  select
    ii.sales_order_item_id,
    sum(ii.quantity)::numeric as total_issued_quantity
  from public.invoice_net_items ii
  join public.invoices i on i.id = ii.invoice_id
  where i.status = 'issued'
  group by ii.sales_order_item_id
)
select
  ii.id as invoice_item_id,
  ii.invoice_id,
  i.invoice_number,
  i.issue_date,
  i.currency as invoice_currency,
  i.sales_order_id,
  ii.sales_order_item_id,
  ii.product_id,
  ii.quantity as invoiced_quantity,
  ii.unit,
  ii.unit_price,
  ii.line_total,
  it.total_issued_quantity as total_issued_quantity_for_so_item,
  soic.active_allocated_quantity,
  case when ii.quantity=0 then i.currency else soic.cogs_currency end as cogs_currency,
  soic.recognized_unit_cogs as source_weighted_unit_cogs,
  case
    when ii.quantity=0 then 0
    when soic.cost_coverage <> 'incomplete_allocation'
     and soic.recognized_unit_cogs is not null
     and it.total_issued_quantity <= soic.active_allocated_quantity
      then ii.quantity * soic.recognized_unit_cogs
    else null
  end::numeric as recognized_merchandise_cogs,
  case
    when ii.quantity=0 then 'actual'
    when soic.cost_coverage = 'incomplete_allocation' then 'incomplete_allocation'
    when soic.recognized_unit_cogs is null then 'incomplete_allocation'
    when it.total_issued_quantity > soic.active_allocated_quantity then 'incomplete_allocation'
    else soic.cost_coverage
  end as cost_coverage,
  case
    when ii.quantity=0 then true
    when soic.cost_coverage <> 'incomplete_allocation'
     and soic.recognized_unit_cogs is not null
     and it.total_issued_quantity <= soic.active_allocated_quantity
      then soic.cogs_currency = i.currency
    else false
  end as currency_comparable
from public.invoice_net_items ii
join public.invoices i on i.id = ii.invoice_id and i.status = 'issued'
join issued_totals it on it.sales_order_item_id = ii.sales_order_item_id
join public.sales_order_item_merchandise_cogs soic
  on soic.sales_order_item_id = ii.sales_order_item_id;

create or replace view public.issued_invoice_profitability
with (security_invoker = true)
as
with totals as (
  select
    i.id as invoice_id,
    count(ii.id)::integer as invoice_item_count,
    coalesce(sum(ii.line_total),0)::numeric as invoice_total
  from public.invoices i
  left join public.invoice_net_items ii on ii.invoice_id = i.id
  where i.status = 'issued'
  group by i.id
)
select
  ic.invoice_id,
  ic.invoice_number,
  ic.issue_date,
  ic.sales_order_id,
  ic.operation_id,
  ic.invoice_currency,
  t.invoice_item_count,
  t.invoice_total,
  ic.cogs_currency,
  ic.recognized_merchandise_cogs,
  ic.cost_coverage as merchandise_cost_coverage,
  ic.currency_comparable,
  case
    when ic.currency_comparable and ic.recognized_merchandise_cogs is not null
      then t.invoice_total - ic.recognized_merchandise_cogs
    else null
  end::numeric as gross_margin,
  case
    when ic.currency_comparable
     and ic.recognized_merchandise_cogs is not null
     and t.invoice_total <> 0
      then ((t.invoice_total - ic.recognized_merchandise_cogs) / t.invoice_total) * 100
    else null
  end::numeric as gross_margin_pct,
  case
    when ic.recognized_merchandise_cogs is null then 'incomplete_cogs'
    when not ic.currency_comparable then 'currency_mismatch'
    else 'comparable'
  end as profitability_status
from public.issued_invoice_merchandise_cogs ic
join totals t on t.invoice_id = ic.invoice_id;

create or replace view public.operation_profitability
with (security_invoker = true)
as
with revenue_by_currency as (
  select
    i.operation_id,
    i.currency,
    count(distinct i.id)::integer as issued_invoice_count,
    coalesce(sum(ii.line_total),0)::numeric as issued_revenue
  from public.invoices i
  left join public.invoice_net_items ii on ii.invoice_id = i.id
  where i.status = 'issued' and i.operation_id is not null
  group by i.operation_id,i.currency
), revenue as (
  select
    operation_id,
    sum(issued_invoice_count)::integer as issued_invoice_count,
    count(*)::integer as revenue_currency_count,
    min(currency) as single_revenue_currency,
    case when count(*) = 1 then sum(issued_revenue) else null end::numeric as issued_revenue
  from revenue_by_currency
  group by operation_id
), cogs as (
  select
    operation_id,
    count(*)::integer as invoice_cogs_row_count,
    count(recognized_merchandise_cogs)::integer as costed_invoice_count,
    count(cogs_currency)::integer as known_cogs_currency_count,
    count(distinct cogs_currency)::integer as cogs_currency_count,
    min(cogs_currency) as single_cogs_currency,
    sum(recognized_merchandise_cogs)::numeric as cost_candidate,
    bool_or(cost_coverage = 'incomplete_allocation') as has_incomplete_cost,
    bool_and(cost_coverage = 'actual') as all_actual,
    bool_and(cost_coverage = 'estimated') as all_estimated
  from public.issued_invoice_merchandise_cogs
  where operation_id is not null
  group by operation_id
), direct_cost as (
  select
    operation_id,
    count(*)::integer as direct_cost_currency_count,
    min(currency) as single_direct_cost_currency,
    sum(charge_count)::integer as direct_cost_charge_count,
    case when count(*) = 1 then sum(direct_cost_amount) else null end::numeric as direct_cost_amount
  from public.operation_descendant_direct_costs
  group by operation_id
), counts as (
  select
    o.id as operation_id,
    count(distinct s.id)::integer as shipment_count,
    count(distinct l.id)::integer as load_count
  from public.operations o
  left join public.shipments s on s.operation_id = o.id
  left join public.loads l on l.shipment_id = s.id
  group by o.id
), base as (
  select
    o.id as operation_id,
    o.operation_code,
    o.status as operation_status,
    o.container_number,
    coalesce(ct.shipment_count,0)::integer as shipment_count,
    coalesce(ct.load_count,0)::integer as load_count,
    coalesce(r.issued_invoice_count,0)::integer as issued_invoice_count,
    coalesce(r.revenue_currency_count,0)::integer as revenue_currency_count,
    case when r.revenue_currency_count = 1 then r.single_revenue_currency else null end as revenue_currency,
    case when r.revenue_currency_count = 1 then r.issued_revenue else null end::numeric as issued_revenue,
    coalesce(c.cogs_currency_count,0)::integer as cogs_currency_count,
    case
      when c.invoice_cogs_row_count > 0
       and c.costed_invoice_count = c.invoice_cogs_row_count
       and c.known_cogs_currency_count = c.invoice_cogs_row_count
       and c.cogs_currency_count = 1
       and coalesce(c.has_incomplete_cost,false) is false
        then c.single_cogs_currency
      else null
    end as cogs_currency,
    case
      when c.invoice_cogs_row_count > 0
       and c.costed_invoice_count = c.invoice_cogs_row_count
       and c.known_cogs_currency_count = c.invoice_cogs_row_count
       and c.cogs_currency_count = 1
       and coalesce(c.has_incomplete_cost,false) is false
        then c.cost_candidate
      else null
    end::numeric as recognized_merchandise_cogs,
    case
      when coalesce(c.invoice_cogs_row_count,0) = 0 then 'incomplete_allocation'
      when c.costed_invoice_count <> c.invoice_cogs_row_count then 'incomplete_allocation'
      when c.known_cogs_currency_count <> c.invoice_cogs_row_count then 'incomplete_allocation'
      when c.cogs_currency_count <> 1 then 'incomplete_allocation'
      when coalesce(c.has_incomplete_cost,false) then 'incomplete_allocation'
      when coalesce(c.all_actual,false) then 'actual'
      when coalesce(c.all_estimated,false) then 'estimated'
      else 'partial_actual'
    end as merchandise_cost_coverage,
    coalesce(dc.direct_cost_currency_count,0)::integer as direct_cost_currency_count,
    case when dc.direct_cost_currency_count = 1 then dc.single_direct_cost_currency else null end as direct_cost_currency,
    coalesce(dc.direct_cost_charge_count,0)::integer as direct_cost_charge_count,
    case
      when coalesce(dc.direct_cost_currency_count,0) = 0 then 0::numeric
      when dc.direct_cost_currency_count = 1 then dc.direct_cost_amount
      else null
    end::numeric as direct_cost_amount
  from public.operations o
  left join revenue r on r.operation_id = o.id
  left join cogs c on c.operation_id = o.id
  left join direct_cost dc on dc.operation_id = o.id
  left join counts ct on ct.operation_id = o.id
)
select
  b.*,
  case
    when b.revenue_currency_count = 1
     and b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.revenue_currency
      then b.issued_revenue - b.recognized_merchandise_cogs
    else null
  end::numeric as gross_margin_before_direct_costs,
  case
    when b.revenue_currency_count = 1
     and b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.revenue_currency
     and (b.direct_cost_currency_count = 0 or (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
      then b.issued_revenue - b.recognized_merchandise_cogs - coalesce(b.direct_cost_amount,0)
    else null
  end::numeric as contribution_margin,
  case
    when b.revenue_currency_count = 1
     and b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.revenue_currency
     and (b.direct_cost_currency_count = 0 or (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
     and b.issued_revenue <> 0
      then ((b.issued_revenue - b.recognized_merchandise_cogs - coalesce(b.direct_cost_amount,0)) / b.issued_revenue) * 100
    else null
  end::numeric as contribution_margin_pct,
  (
    b.revenue_currency_count = 1
    and b.recognized_merchandise_cogs is not null
    and b.cogs_currency = b.revenue_currency
    and (b.direct_cost_currency_count = 0 or (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
  ) as currency_comparable,
  case
    when b.issued_invoice_count = 0 then 'no_issued_revenue'
    when b.revenue_currency_count <> 1 then 'revenue_multi_currency'
    when b.recognized_merchandise_cogs is null then 'incomplete_cogs'
    when b.cogs_currency <> b.revenue_currency then 'merchandise_currency_mismatch'
    when b.direct_cost_currency_count > 1 then 'direct_cost_multi_currency'
    when b.direct_cost_currency_count = 1 and b.direct_cost_currency <> b.revenue_currency then 'direct_cost_currency_mismatch'
    else 'comparable'
  end as profitability_status
from base b;

create or replace view public.issued_invoice_cost_traceability
with (security_invoker = true)
as
select
  i.id as invoice_id,
  i.invoice_number,
  i.issue_date,
  i.currency as invoice_currency,
  ii.id as invoice_item_id,
  ii.sales_order_item_id,
  ii.product_id as invoice_product_id,
  ii.quantity as invoiced_quantity,
  ii.line_total,
  t.sales_order_id,
  t.so_number,
  t.fulfillment_allocation_id,
  t.sales_allocated_quantity,
  t.load_item_id,
  t.load_id,
  t.load_number,
  t.shipment_id,
  t.operation_id as traced_operation_id,
  t.load_allocation_id,
  t.load_allocated_quantity,
  t.receipt_item_id,
  t.warehouse_receipt_id,
  t.receipt_number,
  t.purchase_receipt_allocation_id,
  t.purchase_order_item_id,
  t.purchase_order_id,
  t.po_number,
  t.po_unit_cost,
  t.po_currency,
  t.supplier_bill_id,
  t.supplier_bill_number,
  t.supplier_invoice_number,
  t.supplier_bill_item_id,
  t.supplier_billed_quantity,
  t.supplier_bill_unit_cost,
  t.supplier_bill_currency,
  t.recognized_unit_cogs,
  t.recognized_cogs_currency,
  t.cost_coverage
from public.invoices i
join public.invoice_net_items ii on ii.invoice_id = i.id
left join public.sales_order_cost_traceability t on t.sales_order_item_id = ii.sales_order_item_id
where i.status = 'issued';

create or replace view public.sales_order_item_invoice_progress
with (security_invoker = true)
as
select
  soi.id as sales_order_item_id,
  soi.sales_order_id,
  soi.product_id,
  soi.ordered_quantity,
  soi.unit,
  soi.unit_price,
  coalesce(sum(ii.quantity) filter (where i.status = 'draft'),0)::numeric as draft_invoice_quantity,
  coalesce(sum(ii.quantity) filter (where i.status = 'issued'),0)::numeric as invoiced_quantity,
  coalesce(sum(ii.quantity) filter (where i.status in ('draft','issued')),0)::numeric as allocated_invoice_quantity,
  greatest(
    soi.ordered_quantity - coalesce(sum(ii.quantity) filter (where i.status in ('draft','issued')),0),
    0
  )::numeric as available_to_invoice_quantity,
  greatest(
    soi.ordered_quantity - coalesce(sum(ii.quantity) filter (where i.status = 'issued'),0),
    0
  )::numeric as uninvoiced_quantity
from public.sales_order_items soi
left join public.invoice_net_items ii on ii.sales_order_item_id = soi.id
left join public.invoices i on i.id = ii.invoice_id
group by soi.id, soi.sales_order_id, soi.product_id, soi.ordered_quantity, soi.unit, soi.unit_price;

create or replace function public.prepare_invoice_item()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_invoice public.invoices;
  v_so_item public.sales_order_items;
  v_product record;
  v_existing numeric;
begin
  select * into v_invoice
  from public.invoices
  where id = new.invoice_id
  for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status <> 'draft' then raise exception 'INVOICE_ITEMS_LOCKED'; end if;

  select * into v_so_item
  from public.sales_order_items
  where id = new.sales_order_item_id
  for update;
  if not found then raise exception 'INVOICE_SO_ITEM_NOT_FOUND'; end if;
  if v_so_item.sales_order_id <> v_invoice.sales_order_id then
    raise exception 'INVOICE_SO_ITEM_MISMATCH';
  end if;

  select id, sku, name into v_product
  from public.products where id = v_so_item.product_id;
  if not found then raise exception 'INVOICE_PRODUCT_NOT_FOUND'; end if;

  new.product_id := v_so_item.product_id;
  new.description := concat_ws(' · ', nullif(v_product.sku,''), v_product.name);
  new.unit := v_so_item.unit;
  new.unit_price := v_so_item.unit_price;

  select coalesce(sum(ii.quantity),0)
    into v_existing
  from public.invoice_net_items ii
  join public.invoices i on i.id = ii.invoice_id
  where ii.sales_order_item_id = new.sales_order_item_id
    and i.status <> 'void'
    and ii.id <> new.id;

  if v_existing + new.quantity > v_so_item.ordered_quantity then
    raise exception 'INVOICE_QUANTITY_EXCEEDS_SALES_ORDER';
  end if;

  return new;
end;
$function$;

create or replace function public.validate_invoice_payment()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_invoice public.invoices;
  v_total numeric;
  v_existing numeric;
  v_advance_applied numeric;
begin
  if tg_op='INSERT' and new.status='reversed' then raise exception 'PAYMENT_INVALID_INITIAL_STATUS'; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id for update;
  if not found then raise exception 'PAYMENT_INVOICE_NOT_FOUND'; end if;
  if new.status<>'reversed' and v_invoice.status<>'issued' then raise exception 'PAYMENT_INVOICE_NOT_ISSUED'; end if;
  new.client_id:=v_invoice.client_id;
  new.currency:=v_invoice.currency;
  new.operation_id:=null;
  if new.status='posted' then
    select coalesce(sum(round(line_total,2)),0) into v_total from public.invoice_net_items where invoice_id=new.invoice_id;
    select coalesce(round(sum(amount),2),0) into v_existing from public.payments where invoice_id=new.invoice_id and status='posted' and id<>new.id;
    select coalesce(round(sum(caa.amount),2),0) into v_advance_applied
    from public.customer_advance_applications caa
    join public.customer_advances ca on ca.id=caa.customer_advance_id
    where caa.invoice_id=new.invoice_id and caa.status='posted' and ca.status='posted';
    if v_total<=0 then raise exception 'PAYMENT_INVOICE_HAS_NO_TOTAL'; end if;
    if round(v_existing+v_advance_applied+new.amount,2)>v_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_customer_advance_application()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_advance record;
  v_invoice record;
  v_advance_applied numeric;
  v_advance_refunded numeric;
  v_invoice_total numeric;
  v_invoice_cash numeric;
  v_invoice_advance numeric;
begin
  if new.status<>'posted' then return new; end if;
  select id,sales_order_id,client_id,currency,amount,status into v_advance from public.customer_advances where id=new.customer_advance_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_NOT_FOUND'; end if;
  if v_advance.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_NOT_POSTED'; end if;
  select id,sales_order_id,client_id,currency,status into v_invoice from public.invoices where id=new.invoice_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_INVOICE_NOT_FOUND'; end if;
  if v_invoice.status<>'issued' then raise exception 'CUSTOMER_ADVANCE_INVOICE_NOT_ISSUED'; end if;
  if v_invoice.sales_order_id<>v_advance.sales_order_id or v_invoice.client_id<>v_advance.client_id or v_invoice.currency<>v_advance.currency then raise exception 'CUSTOMER_ADVANCE_APPLICATION_CONTEXT_MISMATCH'; end if;
  select coalesce(sum(amount),0) into v_advance_applied from public.customer_advance_applications where customer_advance_id=new.customer_advance_id and status='posted' and id<>new.id;
  select coalesce(sum(amount),0) into v_advance_refunded from public.customer_advance_refunds where customer_advance_id=new.customer_advance_id and status='posted';
  if v_advance_applied+v_advance_refunded+new.amount>v_advance.amount then raise exception 'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_AVAILABLE'; end if;
  select coalesce(sum(round(line_total,2)),0) into v_invoice_total from public.invoice_net_items where invoice_id=new.invoice_id;
  select coalesce(round(sum(amount),2),0) into v_invoice_cash from public.payments where invoice_id=new.invoice_id and status='posted';
  select coalesce(round(sum(amount),2),0) into v_invoice_advance from public.customer_advance_applications where invoice_id=new.invoice_id and status='posted' and id<>new.id;
  if v_invoice_total<=0 then raise exception 'CUSTOMER_ADVANCE_INVOICE_HAS_NO_TOTAL'; end if;
  if round(v_invoice_cash+v_invoice_advance+new.amount,2)>v_invoice_total then raise exception 'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE'; end if;
  return new;
end;
$$;

create or replace function public.invoice_action_state(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_invoice public.invoices;
  v_financial record;
  v_item_count integer := 0;
  v_posted_payments integer := 0;
  v_posted_advance_applications integer := 0;
  v_edit_allowed boolean;
  v_issue_allowed boolean;
  v_payment_allowed boolean;
  v_void_allowed boolean;
  v_issue_reason text;
  v_payment_reason text;
  v_void_reason text;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  select count(*)::integer into v_item_count
  from public.invoice_items where invoice_id=v_invoice.id;

  select * into v_financial
  from public.invoice_financial_progress
  where invoice_id=v_invoice.id;

  select count(*)::integer into v_posted_payments
  from public.payments
  where invoice_id=v_invoice.id and status='posted';

  select count(*)::integer into v_posted_advance_applications
  from public.customer_advance_applications
  where invoice_id=v_invoice.id and status='posted';

  v_edit_allowed := v_invoice.status='draft';

  v_issue_reason := case
    when v_invoice.status<>'draft' then 'INVOICE_NOT_DRAFT'
    when v_item_count=0 then 'INVOICE_HAS_NO_ITEMS'
    else null
  end;
  v_issue_allowed := v_issue_reason is null;

  v_payment_reason := case
    when v_invoice.status<>'issued' then 'PAYMENT_INVOICE_NOT_ISSUED'
    when coalesce(v_financial.total,0)<=0 then 'PAYMENT_INVOICE_HAS_NO_TOTAL'
    when coalesce(v_financial.balance_due,0)<=0 then 'PAYMENT_INVOICE_ALREADY_SETTLED'
    else null
  end;
  v_payment_allowed := v_payment_reason is null;

  v_void_reason := case
    when v_invoice.status not in ('draft','issued') then 'INVOICE_CANNOT_VOID'
    when exists(select 1 from public.invoice_credit_notes where invoice_id=v_invoice.id) then 'INVOICE_HAS_CREDITS'
    when v_posted_payments>0 then 'INVOICE_HAS_POSTED_PAYMENTS'
    when v_posted_advance_applications>0 then 'INVOICE_HAS_POSTED_ADVANCE_APPLICATIONS'
    else null
  end;
  v_void_allowed := v_void_reason is null;

  return jsonb_build_object(
    'invoice_status',v_invoice.status,
    'payment_status',coalesce(v_financial.payment_status,case when v_invoice.status='draft' then 'draft' when v_invoice.status='void' then 'void' else 'unpaid' end),
    'item_count',v_item_count,
    'total',coalesce(v_financial.total,0),
    'cash_payment_amount',coalesce(v_financial.cash_payment_amount,0),
    'advance_applied_amount',coalesce(v_financial.advance_applied_amount,0),
    'balance_due',coalesce(v_financial.balance_due,0),
    'posted_payment_count',v_posted_payments,
    'posted_advance_application_count',v_posted_advance_applications,
    'actions',jsonb_build_object(
      'credit',jsonb_build_object('allowed',v_invoice.status='issued' and exists(select 1 from public.invoice_net_items where invoice_id=v_invoice.id and quantity>0),'reason',case when v_invoice.status<>'issued' then 'INVOICE_CREDIT_REQUIRES_ISSUED' else null end),
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'INVOICE_NOT_DRAFT' end),
      'issue',jsonb_build_object('allowed',v_issue_allowed,'reason',v_issue_reason),
      'record_payment',jsonb_build_object('allowed',v_payment_allowed,'reason',v_payment_reason),
      'void',jsonb_build_object('allowed',v_void_allowed,'reason',v_void_reason)
    )
  );
end;
$$;

create or replace view public.executive_invoice_kpi_source
with (security_invoker = true)
as
select
  f.invoice_id,
  f.invoice_number,
  f.sales_order_id,
  i.operation_id,
  f.client_id,
  f.issue_date,
  f.due_date,
  f.currency,
  f.total as invoice_total,
  f.paid_amount,
  f.balance_due,
  f.payment_status,
  (f.balance_due > 0 and f.due_date is not null and f.due_date < current_date) as overdue,
  p.recognized_merchandise_cogs,
  p.cogs_currency,
  p.merchandise_cost_coverage,
  p.currency_comparable,
  p.gross_margin,
  p.gross_margin_pct,
  p.profitability_status,
  coalesce((
    select array_agg(distinct ii.product_id order by ii.product_id)
    from public.invoice_items ii
    where ii.invoice_id = f.invoice_id
      and ii.product_id is not null
  ), '{}'::uuid[]) as product_ids,
  f.original_total,f.credited_amount,f.customer_credit_balance
from public.invoice_financial_progress f
join public.invoices i on i.id = f.invoice_id
left join public.issued_invoice_profitability p on p.invoice_id = f.invoice_id
where f.invoice_status = 'issued';

create or replace function public.executive_report_dataset(
  p_dataset text,
  p_start_date date default null,
  p_end_date date default null,
  p_currency text default null,
  p_client_id uuid default null,
  p_supplier_id uuid default null,
  p_product_id uuid default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_dataset text := lower(btrim(coalesce(p_dataset,'')));
  v_limit integer := least(greatest(coalesce(p_limit,1000),1),5000);
  v_rows jsonb := '[]'::jsonb;
  v_basis text := 'period_activity';
  v_dimensions text[] := '{}'::text[];
begin
  if p_start_date is not null and p_end_date is not null and p_start_date > p_end_date then
    raise exception 'REPORT_DATE_RANGE_INVALID';
  end if;

  if p_currency is not null and btrim(p_currency) !~ '^[A-Za-z]{3,10}$' then
    raise exception 'REPORT_CURRENCY_INVALID';
  end if;

  if v_dataset = 'sales' then
    if p_supplier_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:supplier_id'; end if;
    v_dimensions := array['period','currency','client','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.order_date desc, q.so_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.sales_order_id,
        x.so_number,
        x.order_date,
        c.name as client_name,
        c.company as client_company,
        i.name as importer_name,
        x.status,
        x.currency,
        x.order_total,
        x.fulfillment_status,
        x.attributed_sales_revenue,
        x.unattributed_order_value,
        x.recognized_merchandise_cogs,
        x.merchandise_cost_coverage,
        x.gross_margin,
        x.gross_margin_pct,
        x.profitability_status,
        x.direct_cost_amount,
        x.contribution_margin,
        x.contribution_margin_pct,
        x.contribution_status
      from public.executive_sales_order_kpi_source x
      left join public.clients c on c.id=x.client_id
      left join public.importers i on i.id=x.importer_id
      where (p_start_date is null or x.order_date >= p_start_date)
        and (p_end_date is null or x.order_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_client_id is null or x.client_id=p_client_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.order_date desc, x.so_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'purchases' then
    if p_client_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:client_id'; end if;
    v_dimensions := array['period','currency','supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.order_date desc, q.po_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.purchase_order_id,
        x.po_number,
        x.order_date,
        x.expected_at,
        s.name as supplier_name,
        s.legal_name as supplier_legal_name,
        w.code as warehouse_code,
        w.name as warehouse_name,
        x.status,
        x.receipt_status,
        x.currency,
        x.order_total,
        x.order_value_coverage,
        x.item_count,
        x.costed_item_count,
        x.has_excess
      from public.executive_purchase_order_kpi_source x
      left join public.suppliers s on s.id=x.supplier_id
      left join public.warehouses w on w.id=x.warehouse_id
      where (p_start_date is null or x.order_date >= p_start_date)
        and (p_end_date is null or x.order_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_supplier_id is null or x.supplier_id=p_supplier_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.order_date desc, x.po_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'invoices' then
    if p_supplier_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:supplier_id'; end if;
    v_dimensions := array['period','currency','client','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.issue_date desc, q.invoice_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.invoice_id,
        x.invoice_number,
        x.issue_date,
        x.due_date,
        c.name as client_name,
        c.company as client_company,
        x.currency,
        x.invoice_total,
        x.original_total,x.credited_amount,x.customer_credit_balance,
        x.paid_amount,
        x.balance_due,
        x.payment_status,
        x.overdue,
        x.recognized_merchandise_cogs,
        x.merchandise_cost_coverage,
        x.gross_margin,
        x.gross_margin_pct,
        x.profitability_status
      from public.executive_invoice_kpi_source x
      left join public.clients c on c.id=x.client_id
      where (p_start_date is null or x.issue_date >= p_start_date)
        and (p_end_date is null or x.issue_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_client_id is null or x.client_id=p_client_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.issue_date desc, x.invoice_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'supplier_bills' then
    if p_client_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:client_id'; end if;
    v_dimensions := array['period','currency','supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.bill_date desc, q.bill_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.supplier_bill_id,
        x.bill_number,
        x.supplier_invoice_number,
        x.bill_date,
        x.due_date,
        s.name as supplier_name,
        s.legal_name as supplier_legal_name,
        x.currency,
        x.bill_total,
        x.paid_amount,
        x.balance_due,
        x.payment_status,
        x.overdue,
        po.po_number
      from public.executive_supplier_bill_kpi_source x
      left join public.suppliers s on s.id=x.supplier_id
      left join public.purchase_orders po on po.id=x.purchase_order_id
      where (p_start_date is null or x.bill_date >= p_start_date)
        and (p_end_date is null or x.bill_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_supplier_id is null or x.supplier_id=p_supplier_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.bill_date desc, x.bill_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'cash' then
    v_dimensions := array['period','currency','client','supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.payment_date desc, q.event_type, q.reference_number),'[]'::jsonb)
      into v_rows
    from (
      select
        x.event_type,x.direction,x.event_id,x.payment_date,x.party_name,x.party_detail,
        x.currency,x.amount,x.method,x.reference_number,x.document_number
      from public.executive_cash_movement_source x
      where (p_start_date is null or x.payment_date >= p_start_date)
        and (p_end_date is null or x.payment_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_client_id is null or x.client_id=p_client_id)
        and (p_supplier_id is null or x.supplier_id=p_supplier_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by payment_date desc, event_type, reference_number
      limit v_limit
    ) q;

  elsif v_dataset = 'inventory' then
    if p_start_date is not null or p_end_date is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:period'; end if;
    if p_currency is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:currency'; end if;
    if p_client_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:client_id'; end if;
    v_basis := 'current_snapshot';
    v_dimensions := array['supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.warehouse_code, q.product_name, q.receipt_number),'[]'::jsonb)
      into v_rows
    from (
      select
        ib.receipt_item_id,
        ib.receipt_number,
        ib.received_at,
        ib.warehouse_code,
        ib.warehouse_name,
        ib.product_id,
        ib.sku as product_sku,
        ib.product_name,
        ib.unit,
        ib.lot_number,
        wr.supplier_id,
        coalesce(s.name,wr.supplier_name) as supplier_name,
        ib.physical_quantity,
        ib.reserved_quantity,
        ib.available_quantity,
        ib.physical_pallets,
        ib.reserved_pallets,
        ib.available_pallets
      from public.inventory_by_receipt ib
      join public.warehouse_receipts wr on wr.id=ib.receipt_id
      left join public.suppliers s on s.id=wr.supplier_id
      where (p_supplier_id is null or wr.supplier_id=p_supplier_id)
        and (p_product_id is null or ib.product_id=p_product_id)
      order by ib.warehouse_code, ib.product_name, ib.receipt_number
      limit v_limit
    ) q;

  else
    raise exception 'REPORT_DATASET_INVALID';
  end if;

  return jsonb_build_object(
    'dataset',v_dataset,
    'basis',v_basis,
    'currency_policy','separate_no_fx',
    'dimensions',to_jsonb(v_dimensions),
    'filters',jsonb_build_object(
      'start_date',p_start_date,
      'end_date',p_end_date,
      'currency',case when p_currency is null then null else upper(p_currency) end,
      'client_id',p_client_id,
      'supplier_id',p_supplier_id,
      'product_id',p_product_id
    ),
    'limit',v_limit,
    'row_count',jsonb_array_length(v_rows),
    'rows',v_rows
  );
end;
$$;

revoke all on public.invoice_financial_progress from public,anon,authenticated;
grant select on public.invoice_financial_progress to service_role;
