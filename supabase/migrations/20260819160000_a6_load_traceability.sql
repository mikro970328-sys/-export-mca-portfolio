-- A6 · Trazabilidad extremo a extremo de Cargues
-- Lectura canónica: WR → allocation → reserva → despacho → shipment → expediente.
-- No suma cantidades de productos/unidades heterogéneas en un total global.

create or replace view public.load_traceability_sources
with (security_invoker = true)
as
with load_ledger as (
  select
    im.reference_id as load_id,
    im.receipt_item_id,
    sum(im.reserved_quantity_delta) as load_reserved_quantity,
    sum(im.reserved_pallets_delta) as load_reserved_pallets,
    sum(case when im.movement_type = 'dispatch' then -im.quantity_delta else 0 end) as load_dispatched_quantity,
    sum(case when im.movement_type = 'dispatch' then -im.pallets_delta else 0 end) as load_dispatched_pallets,
    count(*) as load_movement_count,
    max(im.created_at) as last_load_movement_at
  from public.inventory_movements im
  where im.reference_type = 'load'
    and im.reference_id is not null
    and im.receipt_item_id is not null
  group by im.reference_id, im.receipt_item_id
), allocations as (
  select
    li.load_id,
    li.id as load_item_id,
    li.product_id,
    li.unit as load_item_unit,
    la.receipt_item_id,
    sum(la.allocated_quantity) as allocated_quantity,
    sum(la.allocated_pallets) as allocated_pallets
  from public.load_items li
  join public.load_allocations la on la.load_item_id = li.id
  group by li.load_id, li.id, li.product_id, li.unit, la.receipt_item_id
)
select
  a.load_id,
  l.load_number,
  l.status as load_status,
  l.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  l.shipment_id,
  s.container_number,
  s.booking_number,
  s.bol_number,
  s.carrier,
  s.operational_status as tracking_status,
  s.last_status as tracking_last_status,
  s.last_location as tracking_last_location,
  s.last_event_at as tracking_last_event_at,
  s.shipsgo_status,
  a.load_item_id,
  a.product_id,
  p.sku as product_sku,
  p.name as product_name,
  p.brand as product_brand,
  coalesce(a.load_item_unit, p.unit) as unit,
  a.receipt_item_id,
  src.receipt_id,
  src.receipt_number,
  src.received_at,
  src.lot_number,
  a.allocated_quantity,
  a.allocated_pallets,
  coalesce(ll.load_reserved_quantity, 0) as load_reserved_quantity,
  coalesce(ll.load_reserved_pallets, 0) as load_reserved_pallets,
  coalesce(ll.load_dispatched_quantity, 0) as load_dispatched_quantity,
  coalesce(ll.load_dispatched_pallets, 0) as load_dispatched_pallets,
  coalesce(ll.load_movement_count, 0) as load_movement_count,
  ll.last_load_movement_at,
  src.physical_quantity as source_physical_quantity,
  src.physical_pallets as source_physical_pallets,
  src.reserved_quantity as source_reserved_quantity,
  src.reserved_pallets as source_reserved_pallets,
  src.physical_quantity - src.reserved_quantity as source_available_quantity,
  src.physical_pallets - src.reserved_pallets as source_available_pallets
from allocations a
join public.loads l on l.id = a.load_id
join public.warehouses w on w.id = l.warehouse_id
join public.products p on p.id = a.product_id
left join public.shipments s on s.id = l.shipment_id
left join public.inventory_source_balances src on src.receipt_item_id = a.receipt_item_id
left join load_ledger ll on ll.load_id = a.load_id and ll.receipt_item_id = a.receipt_item_id;

create or replace view public.load_traceability_summary
with (security_invoker = true)
as
select
  l.id as load_id,
  l.load_number,
  l.status,
  l.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  l.shipment_id,
  s.container_number,
  s.booking_number,
  s.bol_number,
  s.carrier,
  s.operational_status as tracking_status,
  s.last_status as tracking_last_status,
  s.last_location as tracking_last_location,
  s.last_event_at as tracking_last_event_at,
  s.shipsgo_status,
  l.scheduled_at,
  l.loading_started_at,
  l.loaded_at,
  l.dispatched_at,
  l.cancelled_at,
  l.created_at,
  l.updated_at,
  (select count(*) from public.load_items li where li.load_id = l.id) as item_line_count,
  (select count(distinct la.receipt_item_id)
     from public.load_items li
     join public.load_allocations la on la.load_item_id = li.id
    where li.load_id = l.id) as source_item_count,
  (select count(distinct src.receipt_id)
     from public.load_items li
     join public.load_allocations la on la.load_item_id = li.id
     join public.inventory_source_balances src on src.receipt_item_id = la.receipt_item_id
    where li.load_id = l.id) as source_wr_count,
  (select count(*) from public.load_expediente_documents d where d.load_id = l.id) as expediente_document_count,
  (select count(*) from public.inventory_movements im where im.reference_type='load' and im.reference_id=l.id) as inventory_movement_count,
  (select max(im.created_at) from public.inventory_movements im where im.reference_type='load' and im.reference_id=l.id) as last_inventory_movement_at
from public.loads l
join public.warehouses w on w.id = l.warehouse_id
left join public.shipments s on s.id = l.shipment_id;

comment on view public.load_traceability_sources is
  'Trazabilidad por producto y fuente WR: allocation, reserva del cargue, despacho y saldos actuales de la fuente.';
comment on view public.load_traceability_summary is
  'Resumen por Cargue para navegar almacén, fuentes WR, inventario, contenedor, Tracking y expediente.';
