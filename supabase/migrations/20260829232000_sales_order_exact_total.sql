alter table public.sales_order_items
  add column if not exists entered_line_total numeric;

alter table public.sales_order_items
  drop constraint if exists sales_order_items_entered_line_total_nonnegative;

alter table public.sales_order_items
  add constraint sales_order_items_entered_line_total_nonnegative
  check (entered_line_total is null or entered_line_total >= 0);

comment on column public.sales_order_items.entered_line_total is
  'Exact commercial line total entered by the user. NULL means ordered_quantity * unit_price is authoritative.';

create or replace function public.populate_sales_order_items(p_sales_order_id uuid, p_lines jsonb)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_line jsonb;
  v_product record;
  v_quantity numeric;
  v_pallets numeric;
  v_units_per_pallet numeric;
  v_unit_price numeric;
  v_line_total numeric;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'SO_HAS_NO_ITEMS';
  end if;

  perform 1 from public.sales_orders where id = p_sales_order_id and status = 'draft';
  if not found then raise exception 'SO_NOT_DRAFT'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select id, unit, default_units_per_pallet, active
      into v_product
    from public.products
    where id = nullif(btrim(v_line->>'product_id'),'')::uuid;

    if not found then raise exception 'SO_PRODUCT_NOT_FOUND'; end if;
    if v_product.active is not true then raise exception 'SO_PRODUCT_INACTIVE'; end if;

    v_quantity := coalesce(nullif(btrim(v_line->>'ordered_quantity'),'')::numeric,0);
    v_pallets := coalesce(nullif(btrim(v_line->>'ordered_pallets'),'')::numeric,0);
    v_units_per_pallet := coalesce(nullif(btrim(v_line->>'units_per_pallet'),'')::numeric,v_product.default_units_per_pallet);
    v_unit_price := nullif(btrim(v_line->>'unit_price'),'')::numeric;
    v_line_total := nullif(btrim(v_line->>'line_total'),'')::numeric;

    if v_quantity < 0 or v_pallets < 0 then raise exception 'SO_QUANTITY_INVALID'; end if;
    if v_units_per_pallet is not null and v_units_per_pallet <= 0 then raise exception 'SO_UNITS_PER_PALLET_INVALID'; end if;
    if v_quantity = 0 and v_pallets > 0 and v_units_per_pallet is not null then
      v_quantity := v_pallets * v_units_per_pallet;
    end if;
    if v_quantity <= 0 then raise exception 'SO_QUANTITY_REQUIRED'; end if;

    if v_line_total is not null then
      if v_line_total < 0 then raise exception 'SO_LINE_TOTAL_INVALID'; end if;
      v_unit_price := v_line_total / v_quantity;
    else
      v_unit_price := coalesce(v_unit_price,0);
      if v_unit_price < 0 then raise exception 'SO_UNIT_PRICE_INVALID'; end if;
    end if;

    insert into public.sales_order_items(
      sales_order_id, product_id, ordered_quantity, ordered_pallets, unit,
      units_per_pallet, unit_price, entered_line_total, notes
    ) values (
      p_sales_order_id, v_product.id, v_quantity, v_pallets, v_product.unit,
      v_units_per_pallet, v_unit_price, v_line_total,
      nullif(btrim(v_line->>'notes'),'')
    );
  end loop;
end;
$function$;

create or replace view public.sales_order_item_progress
with (security_invoker = true)
as
with allocation_totals as (
  select sfa.sales_order_item_id,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status='draft'),0::numeric) as planned_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status='draft'),0::numeric) as planned_pallets,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status = any(array['reserved','loading','loaded']::text[])),0::numeric) as prepared_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status = any(array['reserved','loading','loaded']::text[])),0::numeric) as prepared_pallets,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status='dispatched'),0::numeric) as dispatched_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status='dispatched'),0::numeric) as dispatched_pallets
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id=sfa.load_item_id
  join public.loads l on l.id=li.load_id
  group by sfa.sales_order_item_id
)
select soi.id as sales_order_item_id,
  soi.sales_order_id,
  soi.product_id,
  soi.ordered_quantity,
  soi.ordered_pallets,
  soi.unit,
  soi.units_per_pallet,
  soi.unit_price,
  coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price) as line_total,
  coalesce(a.planned_quantity,0::numeric) as planned_quantity,
  coalesce(a.planned_pallets,0::numeric) as planned_pallets,
  coalesce(a.prepared_quantity,0::numeric) as prepared_quantity,
  coalesce(a.prepared_pallets,0::numeric) as prepared_pallets,
  coalesce(a.dispatched_quantity,0::numeric) as dispatched_quantity,
  coalesce(a.dispatched_pallets,0::numeric) as dispatched_pallets,
  greatest(soi.ordered_quantity-coalesce(a.planned_quantity,0)-coalesce(a.prepared_quantity,0)-coalesce(a.dispatched_quantity,0),0::numeric) as unallocated_quantity,
  greatest(soi.ordered_pallets-coalesce(a.planned_pallets,0)-coalesce(a.prepared_pallets,0)-coalesce(a.dispatched_pallets,0),0::numeric) as unallocated_pallets,
  greatest(soi.ordered_quantity-coalesce(a.dispatched_quantity,0),0::numeric) as remaining_to_dispatch_quantity,
  greatest(soi.ordered_pallets-coalesce(a.dispatched_pallets,0),0::numeric) as remaining_to_dispatch_pallets,
  (coalesce(a.dispatched_quantity,0)>=soi.ordered_quantity and (soi.ordered_pallets=0 or coalesce(a.dispatched_pallets,0)>=soi.ordered_pallets)) as is_fully_dispatched,
  (coalesce(a.dispatched_quantity,0)>0 and not (coalesce(a.dispatched_quantity,0)>=soi.ordered_quantity and (soi.ordered_pallets=0 or coalesce(a.dispatched_pallets,0)>=soi.ordered_pallets))) as has_partial_dispatch,
  case
    when coalesce(a.dispatched_quantity,0)>=soi.ordered_quantity and (soi.ordered_pallets=0 or coalesce(a.dispatched_pallets,0)>=soi.ordered_pallets) then 'dispatched'::text
    when coalesce(a.prepared_quantity,0)>0 or coalesce(a.prepared_pallets,0)>0 then 'prepared'::text
    when coalesce(a.planned_quantity,0)>0 or coalesce(a.planned_pallets,0)>0 then 'planned'::text
    when coalesce(a.dispatched_quantity,0)>0 or coalesce(a.dispatched_pallets,0)>0 then 'dispatched'::text
    else 'pending'::text
  end as fulfillment_stage
from public.sales_order_items soi
left join allocation_totals a on a.sales_order_item_id=soi.id;

create or replace view public.sales_order_profitability
with (security_invoker = true)
as
with item_scope as (
  select so.id as sales_order_id,
    soi.id as sales_order_item_id,
    coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price) as ordered_sales_value,
    coalesce(soic.active_allocated_quantity,0::numeric) as active_allocated_quantity,
    case when soi.ordered_quantity>0 then coalesce(soic.active_allocated_quantity,0::numeric) * (coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price)/soi.ordered_quantity) else 0::numeric end as attributed_sales_value,
    soic.cogs_currency,
    soic.attributable_merchandise_cogs,
    soic.cost_coverage
  from public.sales_orders so
  join public.sales_order_items soi on soi.sales_order_id=so.id
  left join public.sales_order_item_merchandise_cogs soic on soic.sales_order_item_id=soi.id
), aggregated as (
  select item_scope.sales_order_id,
    count(*)::integer as item_count,
    count(*) filter (where item_scope.active_allocated_quantity>0)::integer as active_item_count,
    coalesce(sum(item_scope.ordered_sales_value),0::numeric) as order_total,
    coalesce(sum(item_scope.attributed_sales_value) filter (where item_scope.active_allocated_quantity>0),0::numeric) as attributed_sales_revenue,
    count(item_scope.attributable_merchandise_cogs) filter (where item_scope.active_allocated_quantity>0)::integer as costed_active_item_count,
    count(item_scope.cogs_currency) filter (where item_scope.active_allocated_quantity>0)::integer as known_currency_active_item_count,
    count(distinct item_scope.cogs_currency) filter (where item_scope.active_allocated_quantity>0)::integer as source_currency_count,
    min(item_scope.cogs_currency) filter (where item_scope.active_allocated_quantity>0) as single_cogs_currency,
    sum(item_scope.attributable_merchandise_cogs) filter (where item_scope.active_allocated_quantity>0) as cost_candidate,
    bool_or(item_scope.cost_coverage='incomplete_allocation') filter (where item_scope.active_allocated_quantity>0) as has_incomplete_cost,
    bool_and(item_scope.cost_coverage='actual') filter (where item_scope.active_allocated_quantity>0) as all_actual,
    bool_and(item_scope.cost_coverage='estimated') filter (where item_scope.active_allocated_quantity>0) as all_estimated
  from item_scope group by item_scope.sales_order_id
), base as (
  select so.id as sales_order_id, so.so_number, so.status as sales_order_status, so.client_id, so.importer_id, so.currency as sales_currency,
    coalesce(a.item_count,0) as item_count, coalesce(a.active_item_count,0) as active_item_count,
    coalesce(a.order_total,0::numeric) as order_total, coalesce(a.attributed_sales_revenue,0::numeric) as attributed_sales_revenue,
    greatest(coalesce(a.order_total,0)-coalesce(a.attributed_sales_revenue,0),0::numeric) as unattributed_order_value,
    coalesce(a.costed_active_item_count,0) as costed_active_item_count, coalesce(a.source_currency_count,0) as source_currency_count,
    case when coalesce(a.active_item_count,0)>0 and a.known_currency_active_item_count=a.active_item_count and a.source_currency_count=1 then a.single_cogs_currency else null::text end as cogs_currency,
    case when coalesce(a.active_item_count,0)>0 and a.costed_active_item_count=a.active_item_count and a.known_currency_active_item_count=a.active_item_count and a.source_currency_count=1 and coalesce(a.has_incomplete_cost,false) is false then a.cost_candidate else null::numeric end as recognized_merchandise_cogs,
    case when coalesce(a.active_item_count,0)=0 then 'incomplete_allocation'::text when a.costed_active_item_count<>a.active_item_count then 'incomplete_allocation'::text when a.known_currency_active_item_count<>a.active_item_count then 'incomplete_allocation'::text when a.source_currency_count<>1 then 'incomplete_allocation'::text when coalesce(a.has_incomplete_cost,false) then 'incomplete_allocation'::text when coalesce(a.all_actual,false) then 'actual'::text when coalesce(a.all_estimated,false) then 'estimated'::text else 'partial_actual'::text end as merchandise_cost_coverage
  from public.sales_orders so left join aggregated a on a.sales_order_id=so.id
)
select sales_order_id,so_number,sales_order_status,client_id,importer_id,sales_currency,item_count,active_item_count,order_total,attributed_sales_revenue,unattributed_order_value,costed_active_item_count,source_currency_count,cogs_currency,recognized_merchandise_cogs,merchandise_cost_coverage,
  (recognized_merchandise_cogs is not null and cogs_currency=sales_currency) as currency_comparable,
  case when recognized_merchandise_cogs is not null and cogs_currency=sales_currency then attributed_sales_revenue-recognized_merchandise_cogs else null::numeric end as gross_margin,
  case when recognized_merchandise_cogs is not null and cogs_currency=sales_currency and attributed_sales_revenue<>0 then ((attributed_sales_revenue-recognized_merchandise_cogs)/attributed_sales_revenue)*100 else null::numeric end as gross_margin_pct,
  case when active_item_count=0 then 'no_fulfillment'::text when recognized_merchandise_cogs is null then 'incomplete_cogs'::text when cogs_currency<>sales_currency then 'currency_mismatch'::text else 'comparable'::text end as profitability_status
from base;

create or replace view public.load_profitability
with (security_invoker = true)
as
with revenue_by_currency as (
  select li.load_id, so.currency, count(distinct so.id)::integer as sales_order_count, count(sfa.id)::integer as fulfillment_allocation_count,
    sum(sfa.allocated_quantity * coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price)) as attributed_sales_revenue
  from public.load_items li
  join public.loads l on l.id=li.load_id and l.status<>'cancelled'
  join public.sales_fulfillment_allocations sfa on sfa.load_item_id=li.id
  join public.sales_order_items soi on soi.id=sfa.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  group by li.load_id,so.currency
), revenue as (
  select load_id,sum(sales_order_count)::integer as sales_order_count,sum(fulfillment_allocation_count)::integer as fulfillment_allocation_count,count(*)::integer as revenue_currency_count,min(currency) as single_revenue_currency,case when count(*)=1 then sum(attributed_sales_revenue) else null::numeric end as attributed_sales_revenue from revenue_by_currency group by load_id
), direct_cost as (
  select load_id,count(*)::integer as direct_cost_currency_count,min(currency) as single_direct_cost_currency,sum(charge_count)::integer as direct_cost_charge_count,case when count(*)=1 then sum(direct_cost_amount) else null::numeric end as direct_cost_amount from public.load_direct_costs group by load_id
), base as (
  select l.id as load_id,l.load_number,l.status as load_status,l.shipment_id,s.operation_id,coalesce(r.sales_order_count,0) as sales_order_count,coalesce(r.fulfillment_allocation_count,0) as fulfillment_allocation_count,coalesce(r.revenue_currency_count,0) as revenue_currency_count,case when r.revenue_currency_count=1 then r.single_revenue_currency else null::text end as revenue_currency,case when r.revenue_currency_count=1 then r.attributed_sales_revenue else null::numeric end as attributed_sales_revenue,mc.currency as cogs_currency,mc.recognized_merchandise_cogs,mc.cost_coverage as merchandise_cost_coverage,coalesce(dc.direct_cost_currency_count,0) as direct_cost_currency_count,case when dc.direct_cost_currency_count=1 then dc.single_direct_cost_currency else null::text end as direct_cost_currency,coalesce(dc.direct_cost_charge_count,0) as direct_cost_charge_count,case when coalesce(dc.direct_cost_currency_count,0)=0 then 0::numeric when dc.direct_cost_currency_count=1 then dc.direct_cost_amount else null::numeric end as direct_cost_amount
  from public.loads l left join public.shipments s on s.id=l.shipment_id left join revenue r on r.load_id=l.id left join public.load_merchandise_cogs mc on mc.load_id=l.id left join direct_cost dc on dc.load_id=l.id
)
select load_id,load_number,load_status,shipment_id,operation_id,sales_order_count,fulfillment_allocation_count,revenue_currency_count,revenue_currency,attributed_sales_revenue,cogs_currency,recognized_merchandise_cogs,merchandise_cost_coverage,direct_cost_currency_count,direct_cost_currency,direct_cost_charge_count,direct_cost_amount,
  case when revenue_currency_count=1 and recognized_merchandise_cogs is not null and cogs_currency=revenue_currency then attributed_sales_revenue-recognized_merchandise_cogs else null::numeric end as gross_margin_before_direct_costs,
  case when revenue_currency_count=1 and recognized_merchandise_cogs is not null and cogs_currency=revenue_currency and (direct_cost_currency_count=0 or (direct_cost_currency_count=1 and direct_cost_currency=revenue_currency)) then attributed_sales_revenue-recognized_merchandise_cogs-coalesce(direct_cost_amount,0) else null::numeric end as contribution_margin,
  case when revenue_currency_count=1 and recognized_merchandise_cogs is not null and cogs_currency=revenue_currency and (direct_cost_currency_count=0 or (direct_cost_currency_count=1 and direct_cost_currency=revenue_currency)) and attributed_sales_revenue<>0 then ((attributed_sales_revenue-recognized_merchandise_cogs-coalesce(direct_cost_amount,0))/attributed_sales_revenue)*100 else null::numeric end as contribution_margin_pct,
  (revenue_currency_count=1 and recognized_merchandise_cogs is not null and cogs_currency=revenue_currency and (direct_cost_currency_count=0 or (direct_cost_currency_count=1 and direct_cost_currency=revenue_currency))) as currency_comparable,
  case when load_status='cancelled' then 'cancelled'::text when fulfillment_allocation_count=0 then 'no_sales_allocation'::text when revenue_currency_count<>1 then 'revenue_multi_currency'::text when recognized_merchandise_cogs is null then 'incomplete_cogs'::text when cogs_currency<>revenue_currency then 'merchandise_currency_mismatch'::text when direct_cost_currency_count>1 then 'direct_cost_multi_currency'::text when direct_cost_currency_count=1 and direct_cost_currency<>revenue_currency then 'direct_cost_currency_mismatch'::text else 'comparable'::text end as profitability_status
from base;

create or replace view public.sales_order_invoice_progress
with (security_invoker = true)
as
select so.id as sales_order_id,so.so_number,so.client_id,so.currency,
  coalesce(sum(coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price)),0::numeric) as sales_order_total,
  coalesce(sum(sip.draft_invoice_quantity * coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price)),0::numeric) as draft_invoice_total,
  coalesce(sum(sip.invoiced_quantity * coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price)),0::numeric) as invoiced_total,
  coalesce(sum(sip.allocated_invoice_quantity * coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price)),0::numeric) as allocated_invoice_total,
  greatest(coalesce(sum(coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price)),0::numeric)-coalesce(sum(sip.allocated_invoice_quantity*coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price)),0::numeric),0::numeric) as available_to_invoice_total,
  greatest(coalesce(sum(coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price)),0::numeric)-coalesce(sum(sip.invoiced_quantity*coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price)),0::numeric),0::numeric) as uninvoiced_total,
  coalesce(bool_and(sip.uninvoiced_quantity=0),false) as fully_invoiced
from public.sales_orders so
left join public.sales_order_items soi on soi.sales_order_id=so.id
left join public.sales_order_item_invoice_progress sip on sip.sales_order_item_id=soi.id
group by so.id,so.so_number,so.client_id,so.currency;
