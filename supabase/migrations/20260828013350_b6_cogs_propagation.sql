-- B6.3 · Propagación COGS + costos directos
-- Mercancía: WR item → Load item → Sales Order item → Invoice item.
-- Cost Charges: permanecen separados y solo se agregan por su target explícito.
-- No prorratea Cost Charges de PO/WR entre ítems, no capitaliza fulfillment/destination y no inventa FX.

create view public.load_item_merchandise_cogs
with (security_invoker = true)
as
with allocation_costs as (
  select
    la.id as allocation_id,
    la.load_item_id,
    la.receipt_item_id,
    la.allocated_quantity,
    wc.currency,
    wc.recognized_unit_cost,
    wc.cost_coverage
  from public.load_allocations la
  left join public.warehouse_receipt_item_merchandise_cost wc
    on wc.receipt_item_id = la.receipt_item_id
), aggregated as (
  select
    ac.load_item_id,
    count(ac.allocation_id)::integer as allocation_count,
    coalesce(sum(ac.allocated_quantity),0)::numeric as allocated_quantity,
    coalesce(sum(ac.allocated_quantity) filter (where ac.recognized_unit_cost is not null),0)::numeric as costed_quantity,
    count(ac.currency)::integer as known_currency_allocation_count,
    count(distinct ac.currency)::integer as source_currency_count,
    min(ac.currency) as single_currency,
    sum(ac.allocated_quantity * ac.recognized_unit_cost)
      filter (where ac.recognized_unit_cost is not null)::numeric as cost_candidate,
    bool_or(ac.cost_coverage is null or ac.cost_coverage = 'incomplete_allocation') as has_incomplete_source,
    bool_and(ac.cost_coverage = 'actual') as all_actual,
    bool_and(ac.cost_coverage = 'estimated') as all_estimated
  from allocation_costs ac
  group by ac.load_item_id
)
select
  li.id as load_item_id,
  li.load_id,
  l.load_number,
  l.status as load_status,
  l.shipment_id,
  li.product_id,
  li.planned_quantity,
  li.unit,
  coalesce(a.allocation_count,0)::integer as source_allocation_count,
  coalesce(a.allocated_quantity,0)::numeric as allocated_quantity,
  greatest(li.planned_quantity - coalesce(a.allocated_quantity,0),0)::numeric as unallocated_quantity,
  greatest(coalesce(a.allocated_quantity,0) - li.planned_quantity,0)::numeric as overallocated_quantity,
  coalesce(a.costed_quantity,0)::numeric as costed_quantity,
  coalesce(a.source_currency_count,0)::integer as source_currency_count,
  case
    when a.allocation_count > 0
     and a.known_currency_allocation_count = a.allocation_count
     and a.source_currency_count = 1
      then a.single_currency
    else null
  end as currency,
  case
    when a.allocation_count > 0
     and a.allocated_quantity = li.planned_quantity
     and a.costed_quantity = a.allocated_quantity
     and a.known_currency_allocation_count = a.allocation_count
     and a.source_currency_count = 1
     and coalesce(a.has_incomplete_source,false) is false
      then a.cost_candidate
    else null
  end::numeric as recognized_merchandise_cogs,
  case
    when a.allocation_count > 0
     and a.allocated_quantity = li.planned_quantity
     and a.costed_quantity = a.allocated_quantity
     and a.known_currency_allocation_count = a.allocation_count
     and a.source_currency_count = 1
     and coalesce(a.has_incomplete_source,false) is false
     and li.planned_quantity > 0
      then a.cost_candidate / li.planned_quantity
    else null
  end::numeric as recognized_unit_cogs,
  case
    when coalesce(a.allocation_count,0) = 0 then 'incomplete_allocation'
    when a.allocated_quantity <> li.planned_quantity then 'incomplete_allocation'
    when a.costed_quantity <> a.allocated_quantity then 'incomplete_allocation'
    when a.known_currency_allocation_count <> a.allocation_count then 'incomplete_allocation'
    when a.source_currency_count <> 1 then 'incomplete_allocation'
    when coalesce(a.has_incomplete_source,false) then 'incomplete_allocation'
    when coalesce(a.all_actual,false) then 'actual'
    when coalesce(a.all_estimated,false) then 'estimated'
    else 'partial_actual'
  end as cost_coverage
from public.load_items li
join public.loads l on l.id = li.load_id
left join aggregated a on a.load_item_id = li.id;

create view public.load_merchandise_cogs
with (security_invoker = true)
as
with aggregated as (
  select
    l.id as load_id,
    count(lic.load_item_id)::integer as item_count,
    count(lic.recognized_merchandise_cogs)::integer as costed_item_count,
    count(lic.currency)::integer as known_currency_item_count,
    count(distinct lic.currency)::integer as source_currency_count,
    min(lic.currency) as single_currency,
    sum(lic.recognized_merchandise_cogs) as cost_candidate,
    bool_or(lic.cost_coverage = 'incomplete_allocation') as has_incomplete_item,
    bool_and(lic.cost_coverage = 'actual') as all_actual,
    bool_and(lic.cost_coverage = 'estimated') as all_estimated
  from public.loads l
  left join public.load_item_merchandise_cogs lic on lic.load_id = l.id
  group by l.id
)
select
  l.id as load_id,
  l.load_number,
  l.status as load_status,
  l.shipment_id,
  s.operation_id,
  a.item_count,
  a.costed_item_count,
  a.source_currency_count,
  case
    when a.item_count > 0
     and a.known_currency_item_count = a.item_count
     and a.source_currency_count = 1
      then a.single_currency
    else null
  end as currency,
  case
    when a.item_count > 0
     and a.costed_item_count = a.item_count
     and a.known_currency_item_count = a.item_count
     and a.source_currency_count = 1
     and coalesce(a.has_incomplete_item,false) is false
      then a.cost_candidate
    else null
  end::numeric as recognized_merchandise_cogs,
  case
    when a.item_count = 0 then 'incomplete_allocation'
    when a.costed_item_count <> a.item_count then 'incomplete_allocation'
    when a.known_currency_item_count <> a.item_count then 'incomplete_allocation'
    when a.source_currency_count <> 1 then 'incomplete_allocation'
    when coalesce(a.has_incomplete_item,false) then 'incomplete_allocation'
    when coalesce(a.all_actual,false) then 'actual'
    when coalesce(a.all_estimated,false) then 'estimated'
    else 'partial_actual'
  end as cost_coverage
from public.loads l
join aggregated a on a.load_id = l.id
left join public.shipments s on s.id = l.shipment_id;

create view public.sales_order_item_merchandise_cogs
with (security_invoker = true)
as
with fulfillment as (
  select
    sfa.sales_order_item_id,
    count(sfa.id) filter (where l.status <> 'cancelled')::integer as active_allocation_count,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status <> 'cancelled'),0)::numeric as active_allocated_quantity,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status = 'cancelled'),0)::numeric as cancelled_allocated_quantity,
    coalesce(sum(sfa.allocated_quantity) filter (
      where l.status <> 'cancelled' and lic.recognized_unit_cogs is not null
    ),0)::numeric as costed_quantity,
    count(lic.currency) filter (where l.status <> 'cancelled')::integer as known_currency_allocation_count,
    count(distinct lic.currency) filter (where l.status <> 'cancelled')::integer as source_currency_count,
    min(lic.currency) filter (where l.status <> 'cancelled') as single_currency,
    sum(sfa.allocated_quantity * lic.recognized_unit_cogs) filter (
      where l.status <> 'cancelled' and lic.recognized_unit_cogs is not null
    )::numeric as cost_candidate,
    bool_or(lic.cost_coverage is null or lic.cost_coverage = 'incomplete_allocation')
      filter (where l.status <> 'cancelled') as has_incomplete_source,
    bool_and(lic.cost_coverage = 'actual') filter (where l.status <> 'cancelled') as all_actual,
    bool_and(lic.cost_coverage = 'estimated') filter (where l.status <> 'cancelled') as all_estimated
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id = sfa.load_item_id
  join public.loads l on l.id = li.load_id
  left join public.load_item_merchandise_cogs lic on lic.load_item_id = sfa.load_item_id
  group by sfa.sales_order_item_id
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

create view public.issued_invoice_item_merchandise_cogs
with (security_invoker = true)
as
with issued_totals as (
  select
    ii.sales_order_item_id,
    sum(ii.quantity)::numeric as total_issued_quantity
  from public.invoice_items ii
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
  soic.cogs_currency,
  soic.recognized_unit_cogs as source_weighted_unit_cogs,
  case
    when soic.cost_coverage <> 'incomplete_allocation'
     and soic.recognized_unit_cogs is not null
     and it.total_issued_quantity <= soic.active_allocated_quantity
      then ii.quantity * soic.recognized_unit_cogs
    else null
  end::numeric as recognized_merchandise_cogs,
  case
    when soic.cost_coverage = 'incomplete_allocation' then 'incomplete_allocation'
    when soic.recognized_unit_cogs is null then 'incomplete_allocation'
    when it.total_issued_quantity > soic.active_allocated_quantity then 'incomplete_allocation'
    else soic.cost_coverage
  end as cost_coverage,
  case
    when soic.cost_coverage <> 'incomplete_allocation'
     and soic.recognized_unit_cogs is not null
     and it.total_issued_quantity <= soic.active_allocated_quantity
      then soic.cogs_currency = i.currency
    else false
  end as currency_comparable
from public.invoice_items ii
join public.invoices i on i.id = ii.invoice_id and i.status = 'issued'
join issued_totals it on it.sales_order_item_id = ii.sales_order_item_id
join public.sales_order_item_merchandise_cogs soic
  on soic.sales_order_item_id = ii.sales_order_item_id;

create view public.issued_invoice_merchandise_cogs
with (security_invoker = true)
as
with aggregated as (
  select
    i.id as invoice_id,
    count(ic.invoice_item_id)::integer as item_count,
    count(ic.recognized_merchandise_cogs)::integer as costed_item_count,
    count(ic.cogs_currency)::integer as known_currency_item_count,
    count(distinct ic.cogs_currency)::integer as source_currency_count,
    min(ic.cogs_currency) as single_currency,
    sum(ic.recognized_merchandise_cogs)::numeric as cost_candidate,
    bool_or(ic.cost_coverage = 'incomplete_allocation') as has_incomplete_item,
    bool_and(ic.cost_coverage = 'actual') as all_actual,
    bool_and(ic.cost_coverage = 'estimated') as all_estimated
  from public.invoices i
  left join public.issued_invoice_item_merchandise_cogs ic on ic.invoice_id = i.id
  where i.status = 'issued'
  group by i.id
)
select
  i.id as invoice_id,
  i.invoice_number,
  i.issue_date,
  i.sales_order_id,
  i.operation_id,
  i.currency as invoice_currency,
  a.item_count,
  a.costed_item_count,
  a.source_currency_count,
  case
    when a.item_count > 0
     and a.known_currency_item_count = a.item_count
     and a.source_currency_count = 1
      then a.single_currency
    else null
  end as cogs_currency,
  case
    when a.item_count > 0
     and a.costed_item_count = a.item_count
     and a.known_currency_item_count = a.item_count
     and a.source_currency_count = 1
     and coalesce(a.has_incomplete_item,false) is false
      then a.cost_candidate
    else null
  end::numeric as recognized_merchandise_cogs,
  case
    when a.item_count = 0 then 'incomplete_allocation'
    when a.costed_item_count <> a.item_count then 'incomplete_allocation'
    when a.known_currency_item_count <> a.item_count then 'incomplete_allocation'
    when a.source_currency_count <> 1 then 'incomplete_allocation'
    when coalesce(a.has_incomplete_item,false) then 'incomplete_allocation'
    when coalesce(a.all_actual,false) then 'actual'
    when coalesce(a.all_estimated,false) then 'estimated'
    else 'partial_actual'
  end as cost_coverage,
  case
    when a.item_count > 0
     and a.costed_item_count = a.item_count
     and a.known_currency_item_count = a.item_count
     and a.source_currency_count = 1
     and coalesce(a.has_incomplete_item,false) is false
      then a.single_currency = i.currency
    else false
  end as currency_comparable
from public.invoices i
join aggregated a on a.invoice_id = i.id
where i.status = 'issued';

create view public.posted_cost_charge_allocations
with (security_invoker = true)
as
select
  cca.id as cost_charge_allocation_id,
  cc.id as cost_charge_id,
  cc.cost_number,
  cc.category,
  cc.stage,
  cc.currency,
  cc.incurred_date,
  cca.amount as allocated_amount,
  cca.basis,
  case
    when cca.purchase_order_id is not null then 'purchase_order'
    when cca.warehouse_receipt_id is not null then 'warehouse_receipt'
    when cca.load_id is not null then 'load'
    when cca.shipment_id is not null then 'shipment'
    when cca.operation_id is not null then 'operation'
  end as target_type,
  coalesce(
    cca.purchase_order_id,
    cca.warehouse_receipt_id,
    cca.load_id,
    cca.shipment_id,
    cca.operation_id
  ) as target_id,
  cca.purchase_order_id,
  cca.warehouse_receipt_id,
  cca.load_id,
  cca.shipment_id,
  cca.operation_id
from public.cost_charge_allocations cca
join public.cost_charges cc on cc.id = cca.cost_charge_id
where cc.status = 'posted';

create view public.load_direct_costs
with (security_invoker = true)
as
select
  l.id as load_id,
  l.load_number,
  l.status as load_status,
  l.shipment_id,
  s.operation_id,
  p.currency,
  count(*)::integer as allocation_count,
  count(distinct p.cost_charge_id)::integer as charge_count,
  sum(p.allocated_amount)::numeric as direct_cost_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'inbound'),0)::numeric as inbound_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'fulfillment'),0)::numeric as fulfillment_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'destination'),0)::numeric as destination_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'overhead'),0)::numeric as overhead_amount
from public.posted_cost_charge_allocations p
join public.loads l on l.id = p.load_id
left join public.shipments s on s.id = l.shipment_id
where p.target_type = 'load'
group by l.id,l.load_number,l.status,l.shipment_id,s.operation_id,p.currency;

create view public.shipment_direct_costs
with (security_invoker = true)
as
select
  s.id as shipment_id,
  s.container_number,
  s.operation_id,
  p.currency,
  count(*)::integer as allocation_count,
  count(distinct p.cost_charge_id)::integer as charge_count,
  sum(p.allocated_amount)::numeric as direct_cost_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'inbound'),0)::numeric as inbound_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'fulfillment'),0)::numeric as fulfillment_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'destination'),0)::numeric as destination_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'overhead'),0)::numeric as overhead_amount
from public.posted_cost_charge_allocations p
join public.shipments s on s.id = p.shipment_id
where p.target_type = 'shipment'
group by s.id,s.container_number,s.operation_id,p.currency;

create view public.operation_direct_costs
with (security_invoker = true)
as
select
  o.id as operation_id,
  o.operation_code,
  o.status as operation_status,
  p.currency,
  count(*)::integer as allocation_count,
  count(distinct p.cost_charge_id)::integer as charge_count,
  sum(p.allocated_amount)::numeric as direct_cost_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'inbound'),0)::numeric as inbound_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'fulfillment'),0)::numeric as fulfillment_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'destination'),0)::numeric as destination_amount,
  coalesce(sum(p.allocated_amount) filter (where p.stage = 'overhead'),0)::numeric as overhead_amount
from public.posted_cost_charge_allocations p
join public.operations o on o.id = p.operation_id
where p.target_type = 'operation'
group by o.id,o.operation_code,o.status,p.currency;

-- Backend-only read models. Revoke default privileges explicitly.
revoke all on table public.load_item_merchandise_cogs from anon, authenticated, service_role;
revoke all on table public.load_merchandise_cogs from anon, authenticated, service_role;
revoke all on table public.sales_order_item_merchandise_cogs from anon, authenticated, service_role;
revoke all on table public.issued_invoice_item_merchandise_cogs from anon, authenticated, service_role;
revoke all on table public.issued_invoice_merchandise_cogs from anon, authenticated, service_role;
revoke all on table public.posted_cost_charge_allocations from anon, authenticated, service_role;
revoke all on table public.load_direct_costs from anon, authenticated, service_role;
revoke all on table public.shipment_direct_costs from anon, authenticated, service_role;
revoke all on table public.operation_direct_costs from anon, authenticated, service_role;

grant select on table public.load_item_merchandise_cogs to service_role;
grant select on table public.load_merchandise_cogs to service_role;
grant select on table public.sales_order_item_merchandise_cogs to service_role;
grant select on table public.issued_invoice_item_merchandise_cogs to service_role;
grant select on table public.issued_invoice_merchandise_cogs to service_role;
grant select on table public.posted_cost_charge_allocations to service_role;
grant select on table public.load_direct_costs to service_role;
grant select on table public.shipment_direct_costs to service_role;
grant select on table public.operation_direct_costs to service_role;

comment on view public.load_item_merchandise_cogs is 'COGS de mercancía por línea de Cargue desde WR reales. Solo emite costo completo cuando todas las cantidades y monedas fuente son compatibles.';
comment on view public.load_merchandise_cogs is 'COGS de mercancía agregado por Cargue. No suma monedas distintas y conserva status del Cargue, incluso cancelled, para trazabilidad.';
comment on view public.sales_order_item_merchandise_cogs is 'COGS atribuible por línea de Sales Order usando cantidades de sales_fulfillment_allocations activas y costo unitario ponderado del Load item; allocations de Cargues cancelled no participan.';
comment on view public.issued_invoice_item_merchandise_cogs is 'COGS atribuible a líneas de facturas issued. Como Invoice no identifica un Load específico, usa el costo unitario ponderado de la cantidad activamente asignada al SO item y rechaza cobertura si el total facturado supera esa cantidad.';
comment on view public.issued_invoice_merchandise_cogs is 'COGS de mercancía por Invoice issued. No calcula margen y marca currency_comparable sin realizar conversión FX.';
comment on view public.posted_cost_charge_allocations is 'Allocations normalizadas de Cost Charges posted. VOID/DRAFT no afectan costos; cada fila conserva su target explícito.';
comment on view public.load_direct_costs is 'Cost Charges posted asignados explícitamente al Cargue, agrupados por moneda. No hereda cargos de Shipment/Operation para evitar doble conteo.';
comment on view public.shipment_direct_costs is 'Cost Charges posted asignados explícitamente al Shipment, agrupados por moneda. No redistribuye a Cargues.';
comment on view public.operation_direct_costs is 'Cost Charges posted asignados explícitamente a la Operation, agrupados por moneda. No hereda ni duplica cargos de Load/Shipment.';
