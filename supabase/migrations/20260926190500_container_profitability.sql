-- Rentabilidad por contenedor desde las cantidades y los valores acordados
-- que realmente se asignaron a sus cargues o al flujo Direct Ship.
-- No reparte cargos de Operación entre contenedores sin una asignación explícita.
create or replace view public.shipment_profitability
with (security_invoker = true)
as
with fulfillment_rows as (
  select
    l.shipment_id,
    so.currency as revenue_currency,
    (sfa.allocated_quantity * coalesce(
      soi.entered_line_total / nullif(soi.ordered_quantity, 0),
      soi.unit_price
    ))::numeric as revenue_amount,
    lic.currency as cogs_currency,
    (sfa.allocated_quantity * lic.recognized_unit_cogs)::numeric as cogs_amount,
    lic.cost_coverage
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id = sfa.load_item_id
  join public.loads l on l.id = li.load_id and l.status <> 'cancelled'
  join public.sales_order_items soi on soi.id = sfa.sales_order_item_id
  join public.sales_orders so on so.id = soi.sales_order_id
  left join public.load_item_merchandise_cogs lic on lic.load_item_id = li.id
  where l.shipment_id is not null
    and sfa.allocated_quantity > 0

  union all

  select
    dsa.shipment_id,
    so.currency as revenue_currency,
    (dsa.allocated_sales_quantity * coalesce(
      soi.entered_line_total / nullif(soi.ordered_quantity, 0),
      soi.unit_price
    ))::numeric as revenue_amount,
    cb.currency as cogs_currency,
    (dsa.allocated_purchase_quantity * cb.recognized_unit_cost)::numeric as cogs_amount,
    case
      when cb.recognized_unit_cost is null then 'incomplete_allocation'
      else cb.cost_coverage
    end as cost_coverage
  from public.direct_shipment_effective_allocations dsa
  join public.sales_procurement_allocations spa
    on spa.id = dsa.sales_procurement_allocation_id
  join public.sales_supply_plan_lines spl on spl.id = spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id = spl.sales_order_item_id
  join public.sales_orders so on so.id = soi.sales_order_id
  left join public.purchase_order_item_merchandise_cost_basis cb
    on cb.purchase_order_item_id = spa.purchase_order_item_id
  where dsa.allocated_sales_quantity > 0
), fulfillment_summary as (
  select
    shipment_id,
    count(*)::integer as fulfillment_allocation_count,
    count(distinct revenue_currency)::integer as revenue_currency_count,
    min(revenue_currency) as single_revenue_currency,
    sum(revenue_amount)::numeric as attributed_sales_revenue,
    count(cogs_amount)::integer as costed_allocation_count,
    count(cogs_currency)::integer as known_cogs_currency_count,
    count(distinct cogs_currency)::integer as cogs_currency_count,
    min(cogs_currency) as single_cogs_currency,
    sum(cogs_amount)::numeric as cogs_candidate,
    bool_or(cogs_amount is null or cogs_currency is null or cost_coverage = 'incomplete_allocation') as has_incomplete_cost,
    bool_and(cost_coverage = 'actual') as all_actual,
    bool_and(cost_coverage = 'estimated') as all_estimated
  from fulfillment_rows
  group by shipment_id
), expense_rows as (
  select
    shipment_id,
    cost_charge_id,
    currency,
    allocated_amount
  from public.posted_cost_charge_traceability
  where target_type in ('shipment', 'load')
    and shipment_id is not null
), expense_summary as (
  select
    shipment_id,
    count(distinct cost_charge_id)::integer as direct_cost_charge_count,
    count(distinct currency)::integer as direct_cost_currency_count,
    min(currency) as single_direct_cost_currency,
    sum(allocated_amount)::numeric as direct_cost_candidate
  from expense_rows
  group by shipment_id
), base as (
  select
    s.id as shipment_id,
    s.container_number,
    s.operation_id,
    coalesce(f.fulfillment_allocation_count, 0)::integer as fulfillment_allocation_count,
    coalesce(f.revenue_currency_count, 0)::integer as revenue_currency_count,
    case when f.revenue_currency_count = 1 then f.single_revenue_currency else null end as revenue_currency,
    case when f.revenue_currency_count = 1 then f.attributed_sales_revenue else null end::numeric as attributed_sales_revenue,
    coalesce(f.cogs_currency_count, 0)::integer as cogs_currency_count,
    case
      when f.fulfillment_allocation_count > 0
       and f.known_cogs_currency_count = f.fulfillment_allocation_count
       and f.cogs_currency_count = 1
        then f.single_cogs_currency
      else null
    end as cogs_currency,
    case
      when f.fulfillment_allocation_count > 0
       and f.costed_allocation_count = f.fulfillment_allocation_count
       and f.known_cogs_currency_count = f.fulfillment_allocation_count
       and f.cogs_currency_count = 1
       and coalesce(f.has_incomplete_cost, false) is false
        then f.cogs_candidate
      else null
    end::numeric as recognized_merchandise_cogs,
    case
      when coalesce(f.fulfillment_allocation_count, 0) = 0 then 'incomplete_allocation'
      when f.costed_allocation_count <> f.fulfillment_allocation_count then 'incomplete_allocation'
      when f.known_cogs_currency_count <> f.fulfillment_allocation_count then 'incomplete_allocation'
      when f.cogs_currency_count <> 1 then 'incomplete_allocation'
      when coalesce(f.has_incomplete_cost, false) then 'incomplete_allocation'
      when coalesce(f.all_actual, false) then 'actual'
      when coalesce(f.all_estimated, false) then 'estimated'
      else 'partial_actual'
    end as merchandise_cost_coverage,
    coalesce(e.direct_cost_currency_count, 0)::integer as direct_cost_currency_count,
    case
      when e.direct_cost_currency_count = 1 then e.single_direct_cost_currency
      else null
    end as direct_cost_currency,
    coalesce(e.direct_cost_charge_count, 0)::integer as direct_cost_charge_count,
    case
      when coalesce(e.direct_cost_currency_count, 0) = 0 then 0::numeric
      when e.direct_cost_currency_count = 1 then e.direct_cost_candidate
      else null
    end::numeric as direct_cost_amount
  from public.shipments s
  left join fulfillment_summary f on f.shipment_id = s.id
  left join expense_summary e on e.shipment_id = s.id
)
select
  b.*,
  case
    when b.revenue_currency_count = 1
     and b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.revenue_currency
      then b.attributed_sales_revenue - b.recognized_merchandise_cogs
    else null
  end::numeric as gross_margin_before_direct_costs,
  case
    when b.revenue_currency_count = 1
     and b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.revenue_currency
     and (b.direct_cost_currency_count = 0 or
       (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
      then b.attributed_sales_revenue - b.recognized_merchandise_cogs - coalesce(b.direct_cost_amount, 0)
    else null
  end::numeric as contribution_margin,
  case
    when b.revenue_currency_count = 1
     and b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.revenue_currency
     and (b.direct_cost_currency_count = 0 or
       (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
     and b.attributed_sales_revenue <> 0
      then ((b.attributed_sales_revenue - b.recognized_merchandise_cogs - coalesce(b.direct_cost_amount, 0)) /
        b.attributed_sales_revenue) * 100
    else null
  end::numeric as contribution_margin_pct,
  (
    b.revenue_currency_count = 1
    and b.recognized_merchandise_cogs is not null
    and b.cogs_currency = b.revenue_currency
    and (b.direct_cost_currency_count = 0 or
      (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
  ) as currency_comparable,
  case
    when b.fulfillment_allocation_count = 0 then 'no_sales_allocation'
    when b.revenue_currency_count <> 1 then 'revenue_multi_currency'
    when b.recognized_merchandise_cogs is null then 'incomplete_cogs'
    when b.cogs_currency <> b.revenue_currency then 'merchandise_currency_mismatch'
    when b.direct_cost_currency_count > 1 then 'direct_cost_multi_currency'
    when b.direct_cost_currency_count = 1 and b.direct_cost_currency <> b.revenue_currency then 'direct_cost_currency_mismatch'
    else 'comparable'
  end as profitability_status
from base b;

revoke all on public.shipment_profitability from public, anon, authenticated, service_role;
grant select on public.shipment_profitability to service_role;

comment on view public.shipment_profitability is
  'Rentabilidad por contenedor desde cantidades y valores de venta asignados a sus cargues o Direct Ship, costo reconocido de mercancía y cargos directos explícitos de contenedor/cargue. No distribuye gastos de operación entre contenedores.';
