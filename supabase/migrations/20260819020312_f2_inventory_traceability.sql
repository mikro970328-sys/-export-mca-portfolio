alter table public.inventory_movements
  alter column receipt_item_id set not null;

drop index if exists public.inventory_movements_receipt_item_id_idx;

create or replace function public.inventory_movement_bind_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  source_warehouse_id uuid;
  source_product_id uuid;
  source_status text;
begin
  select wr.warehouse_id, wri.product_id, wr.status
    into source_warehouse_id, source_product_id, source_status
  from public.warehouse_receipt_items wri
  join public.warehouse_receipts wr on wr.id = wri.receipt_id
  where wri.id = new.receipt_item_id;

  if source_warehouse_id is null then
    raise exception 'El WR de origen no existe';
  end if;

  if source_status <> 'received' then
    raise exception 'No se puede mover inventario desde un WR cancelado';
  end if;

  new.warehouse_id := source_warehouse_id;
  new.product_id := source_product_id;
  return new;
end;
$$;

revoke all on function public.inventory_movement_bind_source() from public, anon, authenticated;
grant execute on function public.inventory_movement_bind_source() to service_role;

drop trigger if exists inventory_movements_bind_source on public.inventory_movements;
create trigger inventory_movements_bind_source
before insert or update of receipt_item_id, warehouse_id, product_id
on public.inventory_movements
for each row execute function public.inventory_movement_bind_source();

alter view public.inventory_by_receipt set (security_invoker = true);
alter view public.inventory_summary set (security_invoker = true);
alter view public.inventory_source_balances set (security_invoker = true);

create or replace view public.inventory_traceability
with (security_invoker = true)
as
select
  ('receipt:' || wri.id::text) as event_key,
  'receipt'::text as event_kind,
  'receipt'::text as movement_type,
  wr.received_at as occurred_at,
  wr.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  wri.product_id,
  p.sku as product_sku,
  p.name as product_name,
  coalesce(nullif(trim(wri.unit), ''), nullif(trim(p.unit), ''), 'unidades') as unit,
  wr.id as receipt_id,
  wr.receipt_number,
  wri.id as receipt_item_id,
  wri.lot_number,
  wri.quantity as quantity_delta,
  wri.pallets as pallets_delta,
  0::numeric as reserved_quantity_delta,
  0::numeric as reserved_pallets_delta,
  'warehouse_receipt'::text as reference_type,
  wr.id as reference_id,
  coalesce(wri.notes, wr.notes) as notes,
  wr.created_by,
  au.username as created_by_username,
  wr.created_at
from public.warehouse_receipt_items wri
join public.warehouse_receipts wr on wr.id = wri.receipt_id and wr.status = 'received'
join public.warehouses w on w.id = wr.warehouse_id
join public.products p on p.id = wri.product_id
left join public.admin_users au on au.id = wr.created_by

union all

select
  ('movement:' || im.id::text) as event_key,
  'movement'::text as event_kind,
  im.movement_type,
  im.created_at as occurred_at,
  im.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  im.product_id,
  p.sku as product_sku,
  p.name as product_name,
  coalesce(nullif(trim(wri.unit), ''), nullif(trim(p.unit), ''), 'unidades') as unit,
  wr.id as receipt_id,
  wr.receipt_number,
  wri.id as receipt_item_id,
  wri.lot_number,
  im.quantity_delta,
  im.pallets_delta,
  im.reserved_quantity_delta,
  im.reserved_pallets_delta,
  im.reference_type,
  im.reference_id,
  im.notes,
  im.created_by,
  au.username as created_by_username,
  im.created_at
from public.inventory_movements im
join public.warehouse_receipt_items wri on wri.id = im.receipt_item_id
join public.warehouse_receipts wr on wr.id = wri.receipt_id
join public.warehouses w on w.id = im.warehouse_id
join public.products p on p.id = im.product_id
left join public.admin_users au on au.id = im.created_by;

revoke all on public.inventory_movements from anon, authenticated;
revoke all on public.inventory_by_receipt from anon, authenticated;
revoke all on public.inventory_summary from anon, authenticated;
revoke all on public.inventory_source_balances from anon, authenticated;
revoke all on public.inventory_traceability from anon, authenticated;

grant all on public.inventory_movements to service_role;
grant select on public.inventory_by_receipt to service_role;
grant select on public.inventory_summary to service_role;
grant select on public.inventory_source_balances to service_role;
grant select on public.inventory_traceability to service_role;

comment on table public.inventory_movements is 'Append-only inventory ledger. Every movement is bound to a warehouse receipt item so WR provenance cannot be lost.';
comment on view public.inventory_traceability is 'Read-only chronological inventory trace combining initial WR receipts and subsequent WR-bound movements.';
