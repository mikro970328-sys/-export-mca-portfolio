-- B6.5 · Hardening de trazabilidad
-- La evidencia de Supplier Bill expuesta en el drill-down debe provenir únicamente de Bills posted.

create or replace view public.sales_order_cost_traceability
with (security_invoker = true)
as
with posted_bill_items as (
  select
    sbi.id as supplier_bill_item_id,
    sbi.purchase_order_item_id,
    sbi.billed_quantity,
    sbi.unit_cost,
    sbi.currency,
    sb.id as supplier_bill_id,
    sb.bill_number,
    sb.supplier_invoice_number
  from public.supplier_bill_items sbi
  join public.supplier_bills sb on sb.id = sbi.supplier_bill_id
  where sb.status = 'posted'
)
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
  pbi.supplier_bill_id,
  pbi.bill_number as supplier_bill_number,
  pbi.supplier_invoice_number,
  pbi.supplier_bill_item_id,
  pbi.billed_quantity as supplier_billed_quantity,
  pbi.unit_cost as supplier_bill_unit_cost,
  pbi.currency as supplier_bill_currency,
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
left join posted_bill_items pbi on pbi.purchase_order_item_id = poi.id;

revoke all on public.sales_order_cost_traceability from public, anon, authenticated;
grant select on public.sales_order_cost_traceability to service_role;
