create table if not exists public.inventory_movements (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses(id),
  product_id uuid not null references public.products(id),
  receipt_item_id uuid references public.warehouse_receipt_items(id),
  movement_type text not null check (movement_type in ('reserve','release','dispatch','adjustment_in','adjustment_out','transfer_out','transfer_in')),
  quantity_delta numeric not null default 0,
  pallets_delta numeric not null default 0,
  reserved_quantity_delta numeric not null default 0,
  reserved_pallets_delta numeric not null default 0,
  reference_type text,
  reference_id uuid,
  notes text,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  check (quantity_delta <> 0 or pallets_delta <> 0 or reserved_quantity_delta <> 0 or reserved_pallets_delta <> 0)
);

create index if not exists inventory_movements_warehouse_product_idx on public.inventory_movements(warehouse_id, product_id);
create index if not exists inventory_movements_receipt_item_idx on public.inventory_movements(receipt_item_id);
create index if not exists inventory_movements_reference_idx on public.inventory_movements(reference_type, reference_id);
alter table public.inventory_movements enable row level security;

create or replace view public.inventory_by_receipt as
select
  wr.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  wri.product_id,
  p.sku,
  p.name as product_name,
  coalesce(nullif(trim(p.unit),''),'unidades') as unit,
  wr.id as receipt_id,
  wr.receipt_number,
  wri.id as receipt_item_id,
  wr.received_at,
  wri.lot_number,
  wri.units_per_pallet,
  case when wr.status='received' then wri.quantity else 0 end + coalesce(sum(im.quantity_delta),0) as physical_quantity,
  case when wr.status='received' then wri.pallets else 0 end + coalesce(sum(im.pallets_delta),0) as physical_pallets,
  coalesce(sum(im.reserved_quantity_delta),0) as reserved_quantity,
  coalesce(sum(im.reserved_pallets_delta),0) as reserved_pallets,
  (case when wr.status='received' then wri.quantity else 0 end + coalesce(sum(im.quantity_delta),0) - coalesce(sum(im.reserved_quantity_delta),0)) as available_quantity,
  (case when wr.status='received' then wri.pallets else 0 end + coalesce(sum(im.pallets_delta),0) - coalesce(sum(im.reserved_pallets_delta),0)) as available_pallets
from public.warehouse_receipt_items wri
join public.warehouse_receipts wr on wr.id=wri.receipt_id
join public.warehouses w on w.id=wr.warehouse_id
join public.products p on p.id=wri.product_id
left join public.inventory_movements im on im.receipt_item_id=wri.id
group by wr.warehouse_id,w.code,w.name,wri.product_id,p.sku,p.name,p.unit,wr.id,wr.receipt_number,wri.id,wr.received_at,wri.lot_number,wri.units_per_pallet,wri.quantity,wri.pallets,wr.status;

create or replace view public.inventory_summary as
select
  warehouse_id, warehouse_code, warehouse_name, product_id, sku, product_name, unit,
  sum(physical_quantity) as physical_quantity,
  sum(physical_pallets) as physical_pallets,
  sum(reserved_quantity) as reserved_quantity,
  sum(reserved_pallets) as reserved_pallets,
  sum(available_quantity) as available_quantity,
  sum(available_pallets) as available_pallets
from public.inventory_by_receipt
group by warehouse_id,warehouse_code,warehouse_name,product_id,sku,product_name,unit;
