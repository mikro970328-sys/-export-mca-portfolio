-- B6.5 · Rentabilidad y trazabilidad
-- Margen derivado; no persiste utilidad, no usa operations.sale_total/cost_total/expense_total,
-- no inventa FX y no prorratea Cost Charges entre entidades sin asignación explícita.

create view public.sales_order_profitability
with (security_invoker = true)
as
with item_scope as (
  select
    so.id as sales_order_id,
    soi.id as sales_order_item_id,
    (soi.ordered_quantity * soi.unit_price)::numeric as ordered_sales_value,
    coalesce(soic.active_allocated_quantity,0)::numeric as active_allocated_quantity,
    (coalesce(soic.active_allocated_quantity,0) * soi.unit_price)::numeric as attributed_sales_value,
    soic.cogs_currency,
    soic.attributable_merchandise_cogs,
    soic.cost_coverage
  from public.sales_orders so
  join public.sales_order_items soi on soi.sales_order_id = so.id
  left join public.sales_order_item_merchandise_cogs soic
    on soic.sales_order_item_id = soi.id
), aggregated as (
  select
    sales_order_id,
    count(*)::integer as item_count,
    count(*) filter (where active_allocated_quantity > 0)::integer as active_item_count,
    coalesce(sum(ordered_sales_value),0)::numeric as order_total,
    coalesce(sum(attributed_sales_value) filter (where active_allocated_quantity > 0),0)::numeric as attributed_sales_revenue,
    count(attributable_merchandise_cogs) filter (where active_allocated_quantity > 0)::integer as costed_active_item_count,
    count(cogs_currency) filter (where active_allocated_quantity > 0)::integer as known_currency_active_item_count,
    count(distinct cogs_currency) filter (where active_allocated_quantity > 0)::integer as source_currency_count,
    min(cogs_currency) filter (where active_allocated_quantity > 0) as single_cogs_currency,
    sum(attributable_merchandise_cogs) filter (where active_allocated_quantity > 0)::numeric as cost_candidate,
    bool_or(cost_coverage = 'incomplete_allocation') filter (where active_allocated_quantity > 0) as has_incomplete_cost,
    bool_and(cost_coverage = 'actual') filter (where active_allocated_quantity > 0) as all_actual,
    bool_and(cost_coverage = 'estimated') filter (where active_allocated_quantity > 0) as all_estimated
  from item_scope
  group by sales_order_id
), base as (
  select
    so.id as sales_order_id,
    so.so_number,
    so.status as sales_order_status,
    so.client_id,
    so.importer_id,
    so.currency as sales_currency,
    coalesce(a.item_count,0)::integer as item_count,
    coalesce(a.active_item_count,0)::integer as active_item_count,
    coalesce(a.order_total,0)::numeric as order_total,
    coalesce(a.attributed_sales_revenue,0)::numeric as attributed_sales_revenue,
    greatest(coalesce(a.order_total,0) - coalesce(a.attributed_sales_revenue,0),0)::numeric as unattributed_order_value,
    coalesce(a.costed_active_item_count,0)::integer as costed_active_item_count,
    coalesce(a.source_currency_count,0)::integer as source_currency_count,
    case
      when coalesce(a.active_item_count,0) > 0
       and a.known_currency_active_item_count = a.active_item_count
       and a.source_currency_count = 1
        then a.single_cogs_currency
      else null
    end as cogs_currency,
    case
      when coalesce(a.active_item_count,0) > 0
       and a.costed_active_item_count = a.active_item_count
       and a.known_currency_active_item_count = a.active_item_count
       and a.source_currency_count = 1
       and coalesce(a.has_incomplete_cost,false) is false
        then a.cost_candidate
      else null
    end::numeric as recognized_merchandise_cogs,
    case
      when coalesce(a.active_item_count,0) = 0 then 'incomplete_allocation'
      when a.costed_active_item_count <> a.active_item_count then 'incomplete_allocation'
      when a.known_currency_active_item_count <> a.active_item_count then 'incomplete_allocation'
      when a.source_currency_count <> 1 then 'incomplete_allocation'
      when coalesce(a.has_incomplete_cost,false) then 'incomplete_allocation'
      when coalesce(a.all_actual,false) then 'actual'
      when coalesce(a.all_estimated,false) then 'estimated'
      else 'partial_actual'
    end as merchandise_cost_coverage
  from public.sales_orders so
  left join aggregated a on a.sales_order_id = so.id
)
select
  b.*,
  (b.recognized_merchandise_cogs is not null and b.cogs_currency = b.sales_currency) as currency_comparable,
  case
    when b.recognized_merchandise_cogs is not null and b.cogs_currency = b.sales_currency
      then b.attributed_sales_revenue - b.recognized_merchandise_cogs
    else null
  end::numeric as gross_margin,
  case
    when b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.sales_currency
     and b.attributed_sales_revenue <> 0
      then ((b.attributed_sales_revenue - b.recognized_merchandise_cogs) / b.attributed_sales_revenue) * 100
    else null
  end::numeric as gross_margin_pct,
  case
    when b.active_item_count = 0 then 'no_fulfillment'
    when b.recognized_merchandise_cogs is null then 'incomplete_cogs'
    when b.cogs_currency <> b.sales_currency then 'currency_mismatch'
    else 'comparable'
  end as profitability_status
from base b;

create view public.issued_invoice_profitability
with (security_invoker = true)
as
with totals as (
  select
    i.id as invoice_id,
    count(ii.id)::integer as invoice_item_count,
    coalesce(sum(ii.line_total),0)::numeric as invoice_total
  from public.invoices i
  left join public.invoice_items ii on ii.invoice_id = i.id
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

create view public.load_profitability
with (security_invoker = true)
as
with revenue_by_currency as (
  select
    li.load_id,
    so.currency,
    count(distinct so.id)::integer as sales_order_count,
    count(sfa.id)::integer as fulfillment_allocation_count,
    sum(sfa.allocated_quantity * soi.unit_price)::numeric as attributed_sales_revenue
  from public.load_items li
  join public.loads l on l.id = li.load_id and l.status <> 'cancelled'
  join public.sales_fulfillment_allocations sfa on sfa.load_item_id = li.id
  join public.sales_order_items soi on soi.id = sfa.sales_order_item_id
  join public.sales_orders so on so.id = soi.sales_order_id
  group by li.load_id, so.currency
), revenue as (
  select
    load_id,
    sum(sales_order_count)::integer as sales_order_count,
    sum(fulfillment_allocation_count)::integer as fulfillment_allocation_count,
    count(*)::integer as revenue_currency_count,
    min(currency) as single_revenue_currency,
    case when count(*) = 1 then sum(attributed_sales_revenue) else null end::numeric as attributed_sales_revenue
  from revenue_by_currency
  group by load_id
), direct_cost as (
  select
    load_id,
    count(*)::integer as direct_cost_currency_count,
    min(currency) as single_direct_cost_currency,
    sum(charge_count)::integer as direct_cost_charge_count,
    case when count(*) = 1 then sum(direct_cost_amount) else null end::numeric as direct_cost_amount
  from public.load_direct_costs
  group by load_id
), base as (
  select
    l.id as load_id,
    l.load_number,
    l.status as load_status,
    l.shipment_id,
    s.operation_id,
    coalesce(r.sales_order_count,0)::integer as sales_order_count,
    coalesce(r.fulfillment_allocation_count,0)::integer as fulfillment_allocation_count,
    coalesce(r.revenue_currency_count,0)::integer as revenue_currency_count,
    case when r.revenue_currency_count = 1 then r.single_revenue_currency else null end as revenue_currency,
    case when r.revenue_currency_count = 1 then r.attributed_sales_revenue else null end::numeric as attributed_sales_revenue,
    mc.currency as cogs_currency,
    mc.recognized_merchandise_cogs,
    mc.cost_coverage as merchandise_cost_coverage,
    coalesce(dc.direct_cost_currency_count,0)::integer as direct_cost_currency_count,
    case when dc.direct_cost_currency_count = 1 then dc.single_direct_cost_currency else null end as direct_cost_currency,
    coalesce(dc.direct_cost_charge_count,0)::integer as direct_cost_charge_count,
    case
      when coalesce(dc.direct_cost_currency_count,0) = 0 then 0::numeric
      when dc.direct_cost_currency_count = 1 then dc.direct_cost_amount
      else null
    end::numeric as direct_cost_amount
  from public.loads l
  left join public.shipments s on s.id = l.shipment_id
  left join revenue r on r.load_id = l.id
  left join public.load_merchandise_cogs mc on mc.load_id = l.id
  left join direct_cost dc on dc.load_id = l.id
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
     and (b.direct_cost_currency_count = 0 or (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
      then b.attributed_sales_revenue - b.recognized_merchandise_cogs - coalesce(b.direct_cost_amount,0)
    else null
  end::numeric as contribution_margin,
  case
    when b.revenue_currency_count = 1
     and b.recognized_merchandise_cogs is not null
     and b.cogs_currency = b.revenue_currency
     and (b.direct_cost_currency_count = 0 or (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
     and b.attributed_sales_revenue <> 0
      then ((b.attributed_sales_revenue - b.recognized_merchandise_cogs - coalesce(b.direct_cost_amount,0)) / b.attributed_sales_revenue) * 100
    else null
  end::numeric as contribution_margin_pct,
  (
    b.revenue_currency_count = 1
    and b.recognized_merchandise_cogs is not null
    and b.cogs_currency = b.revenue_currency
    and (b.direct_cost_currency_count = 0 or (b.direct_cost_currency_count = 1 and b.direct_cost_currency = b.revenue_currency))
  ) as currency_comparable,
  case
    when b.load_status = 'cancelled' then 'cancelled'
    when b.fulfillment_allocation_count = 0 then 'no_sales_allocation'
    when b.revenue_currency_count <> 1 then 'revenue_multi_currency'
    when b.recognized_merchandise_cogs is null then 'incomplete_cogs'
    when b.cogs_currency <> b.revenue_currency then 'merchandise_currency_mismatch'
    when b.direct_cost_currency_count > 1 then 'direct_cost_multi_currency'
    when b.direct_cost_currency_count = 1 and b.direct_cost_currency <> b.revenue_currency then 'direct_cost_currency_mismatch'
    else 'comparable'
  end as profitability_status
from base b;

create view public.operation_descendant_direct_costs
with (security_invoker = true)
as
with resolved as (
  select
    p.cost_charge_allocation_id,
    p.cost_charge_id,
    p.cost_number,
    p.category,
    p.stage,
    p.currency,
    p.allocated_amount,
    p.target_type,
    p.target_id,
    case
      when p.target_type = 'operation' then p.operation_id
      when p.target_type = 'shipment' then sd.operation_id
      when p.target_type = 'load' then sl.operation_id
      else null
    end as resolved_operation_id
  from public.posted_cost_charge_allocations p
  left join public.shipments sd
    on p.target_type = 'shipment' and sd.id = p.shipment_id
  left join public.loads l
    on p.target_type = 'load' and l.id = p.load_id
  left join public.shipments sl
    on p.target_type = 'load' and sl.id = l.shipment_id
  where p.target_type in ('operation','shipment','load')
)
select
  o.id as operation_id,
  o.operation_code,
  o.status as operation_status,
  r.currency,
  count(r.cost_charge_allocation_id)::integer as allocation_count,
  count(distinct r.cost_charge_id)::integer as charge_count,
  sum(r.allocated_amount)::numeric as direct_cost_amount,
  coalesce(sum(r.allocated_amount) filter (where r.target_type = 'operation'),0)::numeric as operation_target_amount,
  coalesce(sum(r.allocated_amount) filter (where r.target_type = 'shipment'),0)::numeric as shipment_target_amount,
  coalesce(sum(r.allocated_amount) filter (where r.target_type = 'load'),0)::numeric as load_target_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage = 'inbound'),0)::numeric as inbound_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage = 'fulfillment'),0)::numeric as fulfillment_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage = 'destination'),0)::numeric as destination_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage = 'overhead'),0)::numeric as overhead_amount
from public.operations o
join resolved r on r.resolved_operation_id = o.id
group by o.id,o.operation_code,o.status,r.currency;

create view public.operation_profitability
with (security_invoker = true)
as
with revenue_by_currency as (
  select
    i.operation_id,
    i.currency,
    count(distinct i.id)::integer as issued_invoice_count,
    coalesce(sum(ii.line_total),0)::numeric as issued_revenue
  from public.invoices i
  left join public.invoice_items ii on ii.invoice_id = i.id
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

create view public.sales_order_cost_traceability
with (security_invoker = true)
as
select
  so.id as sales_order_id,
  so.so_number,
  soi.id as sales_order_item_id,
  soi.product_id,
  sfa.id as fulfillment_allocation_id,
  sfa.allocated_quantity as sales_allocated_quantity,
  li.id as load_item_id,
  l.id as load_id,
  l.load_number,
  l.shipment_id,
  sh.operation_id,
  la.id as load_allocation_id,
  la.allocated_quantity as load_allocated_quantity,
  wri.id as receipt_item_id,
  wr.id as warehouse_receipt_id,
  wr.receipt_number,
  pra.id as purchase_receipt_allocation_id,
  poi.id as purchase_order_item_id,
  po.id as purchase_order_id,
  po.po_number,
  poi.unit_cost as po_unit_cost,
  poi.currency as po_currency,
  sb.id as supplier_bill_id,
  sb.bill_number as supplier_bill_number,
  sb.supplier_invoice_number,
  sbi.id as supplier_bill_item_id,
  sbi.billed_quantity as supplier_billed_quantity,
  sbi.unit_cost as supplier_bill_unit_cost,
  sbi.currency as supplier_bill_currency,
  lic.recognized_unit_cogs,
  lic.currency as recognized_cogs_currency,
  lic.cost_coverage
from public.sales_orders so
join public.sales_order_items soi on soi.sales_order_id = so.id
left join public.sales_fulfillment_allocations sfa on sfa.sales_order_item_id = soi.id
left join public.load_items li on li.id = sfa.load_item_id
left join public.loads l on l.id = li.load_id
left join public.shipments sh on sh.id = l.shipment_id
left join public.load_item_merchandise_cogs lic on lic.load_item_id = li.id
left join public.load_allocations la on la.load_item_id = li.id
left join public.warehouse_receipt_items wri on wri.id = la.receipt_item_id
left join public.warehouse_receipts wr on wr.id = wri.receipt_id
left join public.purchase_receipt_allocations pra on pra.receipt_item_id = wri.id
left join public.purchase_order_items poi on poi.id = pra.purchase_order_item_id
left join public.purchase_orders po on po.id = poi.purchase_order_id
left join public.supplier_bill_items sbi on sbi.purchase_order_item_id = poi.id
left join public.supplier_bills sb on sb.id = sbi.supplier_bill_id and sb.status = 'posted';

create view public.issued_invoice_cost_traceability
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
join public.invoice_items ii on ii.invoice_id = i.id
left join public.sales_order_cost_traceability t on t.sales_order_item_id = ii.sales_order_item_id
where i.status = 'issued';

create view public.posted_cost_charge_traceability
with (security_invoker = true)
as
with resolved as (
  select
    p.*,
    l.load_number,
    coalesce(p.shipment_id,l.shipment_id) as resolved_shipment_id,
    coalesce(sd.container_number,sl.container_number) as container_number,
    coalesce(p.operation_id,sd.operation_id,sl.operation_id) as resolved_operation_id,
    po.po_number,
    wr.receipt_number
  from public.posted_cost_charge_allocations p
  left join public.purchase_orders po on po.id = p.purchase_order_id
  left join public.warehouse_receipts wr on wr.id = p.warehouse_receipt_id
  left join public.loads l on l.id = p.load_id
  left join public.shipments sd on sd.id = p.shipment_id
  left join public.shipments sl on sl.id = l.shipment_id
)
select
  r.cost_charge_allocation_id,
  r.cost_charge_id,
  r.cost_number,
  r.category,
  r.stage,
  r.currency,
  r.incurred_date,
  r.allocated_amount,
  r.basis,
  r.target_type,
  r.target_id,
  r.purchase_order_id,
  r.po_number,
  r.warehouse_receipt_id,
  r.receipt_number,
  r.load_id,
  r.load_number,
  r.resolved_shipment_id as shipment_id,
  r.container_number,
  r.resolved_operation_id as operation_id,
  o.operation_code,
  case
    when r.target_type = 'purchase_order' then r.po_number
    when r.target_type = 'warehouse_receipt' then r.receipt_number
    when r.target_type = 'load' then r.load_number
    when r.target_type = 'shipment' then r.container_number
    when r.target_type = 'operation' then o.operation_code
    else null
  end as target_reference
from resolved r
left join public.operations o on o.id = r.resolved_operation_id;

revoke all on public.sales_order_profitability from public, anon, authenticated;
revoke all on public.issued_invoice_profitability from public, anon, authenticated;
revoke all on public.load_profitability from public, anon, authenticated;
revoke all on public.operation_descendant_direct_costs from public, anon, authenticated;
revoke all on public.operation_profitability from public, anon, authenticated;
revoke all on public.sales_order_cost_traceability from public, anon, authenticated;
revoke all on public.issued_invoice_cost_traceability from public, anon, authenticated;
revoke all on public.posted_cost_charge_traceability from public, anon, authenticated;

grant select on public.sales_order_profitability to service_role;
grant select on public.issued_invoice_profitability to service_role;
grant select on public.load_profitability to service_role;
grant select on public.operation_descendant_direct_costs to service_role;
grant select on public.operation_profitability to service_role;
grant select on public.sales_order_cost_traceability to service_role;
grant select on public.issued_invoice_cost_traceability to service_role;
grant select on public.posted_cost_charge_traceability to service_role;
