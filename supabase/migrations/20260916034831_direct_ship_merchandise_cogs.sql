-- Extend the existing COGS owner to supplier-direct allocations.
-- Same basis as warehouse fulfillment: active linked quantities, not a posting ledger.
-- Purchase quantities can differ from sales quantities; never assume unit parity.
create or replace view public.sales_order_item_merchandise_cogs
with (security_invoker = true)
as
with allocation_costs as (
  select sfa.sales_order_item_id, sfa.allocated_quantity,
         l.status <> 'cancelled' as active,
         lic.currency, lic.recognized_unit_cogs,
         lic.cost_coverage,
         (sfa.allocated_quantity * lic.recognized_unit_cogs)::numeric as allocated_cost
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id=sfa.load_item_id
  join public.loads l on l.id=li.load_id
  left join public.load_item_merchandise_cogs lic on lic.load_item_id=sfa.load_item_id
  union all
  select spl.sales_order_item_id, dsa.allocated_sales_quantity,
         true as active,
         cb.currency,
         (dsa.allocated_purchase_quantity * cb.recognized_unit_cost / nullif(dsa.allocated_sales_quantity,0))::numeric,
         case when cb.recognized_unit_cost is null then 'incomplete_allocation' else cb.cost_coverage end,
         (dsa.allocated_purchase_quantity * cb.recognized_unit_cost)::numeric
  from public.direct_shipment_effective_allocations dsa
  join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  left join public.purchase_order_item_merchandise_cost_basis cb on cb.purchase_order_item_id=spa.purchase_order_item_id
  where dsa.allocated_sales_quantity>0
), fulfillment as (
  select sales_order_item_id,
    count(*) filter (where active)::integer as active_allocation_count,
    coalesce(sum(allocated_quantity) filter (where active),0)::numeric as active_allocated_quantity,
    coalesce(sum(allocated_quantity) filter (where not active),0)::numeric as cancelled_allocated_quantity,
    coalesce(sum(allocated_quantity) filter (where active and recognized_unit_cogs is not null),0)::numeric as costed_quantity,
    count(currency) filter (where active)::integer as known_currency_allocation_count,
    count(distinct currency) filter (where active)::integer as source_currency_count,
    min(currency) filter (where active) as single_currency,
    sum(allocated_cost) filter (where active and recognized_unit_cogs is not null)::numeric as cost_candidate,
    bool_or(cost_coverage is null or cost_coverage='incomplete_allocation') filter (where active) as has_incomplete_source,
    bool_and(cost_coverage='actual') filter (where active) as all_actual,
    bool_and(cost_coverage='estimated') filter (where active) as all_estimated
  from allocation_costs group by sales_order_item_id
)
select
  soi.id as sales_order_item_id,
  soi.sales_order_id,
  so.so_number,
  so.status as sales_order_status,
  soi.product_id,
  soi.ordered_quantity,
  soi.unit,
  soi.unit_price,
  so.currency as sales_currency,
  coalesce(f.active_allocation_count,0)::integer as active_fulfillment_allocation_count,
  coalesce(f.active_allocated_quantity,0)::numeric as active_allocated_quantity,
  coalesce(f.cancelled_allocated_quantity,0)::numeric as cancelled_allocated_quantity,
  greatest(soi.ordered_quantity - coalesce(f.active_allocated_quantity,0),0)::numeric as unallocated_order_quantity,
  greatest(coalesce(f.active_allocated_quantity,0) - soi.ordered_quantity,0)::numeric as overallocated_order_quantity,
  coalesce(f.costed_quantity,0)::numeric as costed_quantity,
  coalesce(f.source_currency_count,0)::integer as source_currency_count,
  case
    when f.active_allocation_count > 0
     and f.known_currency_allocation_count = f.active_allocation_count
     and f.source_currency_count = 1
      then f.single_currency
    else null
  end as cogs_currency,
  case
    when f.active_allocation_count > 0
     and f.costed_quantity = f.active_allocated_quantity
     and f.known_currency_allocation_count = f.active_allocation_count
     and f.source_currency_count = 1
     and coalesce(f.has_incomplete_source,false) is false
      then f.cost_candidate
    else null
  end::numeric as attributable_merchandise_cogs,
  case
    when f.active_allocation_count > 0
     and f.costed_quantity = f.active_allocated_quantity
     and f.known_currency_allocation_count = f.active_allocation_count
     and f.source_currency_count = 1
     and coalesce(f.has_incomplete_source,false) is false
     and f.active_allocated_quantity > 0
      then f.cost_candidate / f.active_allocated_quantity
    else null
  end::numeric as recognized_unit_cogs,
  case
    when coalesce(f.active_allocation_count,0) = 0 then 'incomplete_allocation'
    when f.costed_quantity <> f.active_allocated_quantity then 'incomplete_allocation'
    when f.known_currency_allocation_count <> f.active_allocation_count then 'incomplete_allocation'
    when f.source_currency_count <> 1 then 'incomplete_allocation'
    when coalesce(f.has_incomplete_source,false) then 'incomplete_allocation'
    when coalesce(f.all_actual,false) then 'actual'
    when coalesce(f.all_estimated,false) then 'estimated'
    else 'partial_actual'
  end as cost_coverage
from public.sales_order_items soi
join public.sales_orders so on so.id = soi.sales_order_id
left join fulfillment f on f.sales_order_item_id = soi.id;


revoke all on public.sales_order_item_merchandise_cogs from public,anon,authenticated;
grant select on public.sales_order_item_merchandise_cogs to service_role;
comment on view public.sales_order_item_merchandise_cogs is 'COGS por línea de venta desde allocations activas de almacén o Direct Ship efectivo; usa costo PO/Supplier Bills, cantidades de compra y venta separadas y sin FX implícito.';
