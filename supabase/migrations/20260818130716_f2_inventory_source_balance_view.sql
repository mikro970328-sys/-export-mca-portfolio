create index if not exists inventory_movements_receipt_item_id_idx on public.inventory_movements(receipt_item_id);

create or replace view public.inventory_source_balances
with (security_invoker = true)
as
select
  wri.id as receipt_item_id,
  wr.id as receipt_id,
  wr.receipt_number,
  wr.received_at,
  wr.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  w.country as warehouse_country,
  w.city as warehouse_city,
  w.active as warehouse_active,
  wri.product_id,
  p.sku as product_sku,
  p.name as product_name,
  p.brand as product_brand,
  p.category as product_category,
  p.unit as product_unit,
  p.package_format as product_package_format,
  wri.unit as receipt_unit,
  wri.units_per_pallet,
  wri.lot_number,
  wri.gross_weight_kg,
  wri.quantity + coalesce(sum(im.quantity_delta),0) as physical_quantity,
  wri.pallets + coalesce(sum(im.pallets_delta),0) as physical_pallets,
  coalesce(sum(im.reserved_quantity_delta),0) as reserved_quantity,
  coalesce(sum(im.reserved_pallets_delta),0) as reserved_pallets,
  count(im.id) as movement_count
from public.warehouse_receipt_items wri
join public.warehouse_receipts wr on wr.id = wri.receipt_id and wr.status = 'received'
join public.warehouses w on w.id = wr.warehouse_id
join public.products p on p.id = wri.product_id
left join public.inventory_movements im on im.receipt_item_id = wri.id
group by
  wri.id, wr.id, wr.receipt_number, wr.received_at, wr.warehouse_id,
  w.code, w.name, w.country, w.city, w.active,
  wri.product_id, p.sku, p.name, p.brand, p.category, p.unit, p.package_format,
  wri.unit, wri.units_per_pallet, wri.lot_number, wri.gross_weight_kg,
  wri.quantity, wri.pallets;
