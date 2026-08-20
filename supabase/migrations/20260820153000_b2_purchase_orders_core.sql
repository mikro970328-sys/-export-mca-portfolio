-- B2.1 · Núcleo Purchase Orders
-- La PO representa mercancía comprada/esperada. No crea inventario.
-- El WR sigue siendo el único hecho físico de entrada.

create sequence if not exists public.purchase_order_number_seq;

create table public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  po_number text not null unique default ('PO-' || lpad(nextval('public.purchase_order_number_seq'::regclass)::text, 4, '0')),
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  warehouse_id uuid references public.warehouses(id) on delete restrict,
  order_date date not null default current_date,
  expected_at timestamptz,
  currency text not null default 'USD',
  supplier_reference text,
  status text not null default 'draft',
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_orders_po_number_not_blank check (btrim(po_number) <> ''),
  constraint purchase_orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint purchase_orders_status_check check (status in ('draft','issued','confirmed','closed','cancelled'))
);

create index purchase_orders_supplier_id_idx on public.purchase_orders(supplier_id);
create index purchase_orders_warehouse_id_idx on public.purchase_orders(warehouse_id) where warehouse_id is not null;
create index purchase_orders_status_idx on public.purchase_orders(status);
create index purchase_orders_order_date_idx on public.purchase_orders(order_date desc);
create index purchase_orders_created_by_idx on public.purchase_orders(created_by) where created_by is not null;

create trigger purchase_orders_set_updated_at
before update on public.purchase_orders
for each row execute function public.set_erp_updated_at();

create table public.purchase_order_items (
  id uuid primary key default gen_random_uuid(),
  purchase_order_id uuid not null references public.purchase_orders(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  ordered_quantity numeric not null default 0,
  ordered_pallets numeric not null default 0,
  unit text not null,
  units_per_pallet numeric,
  unit_cost numeric,
  currency text not null default 'USD',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint purchase_order_items_nonnegative_check check (ordered_quantity >= 0 and ordered_pallets >= 0),
  constraint purchase_order_items_positive_check check (ordered_quantity > 0 or ordered_pallets > 0),
  constraint purchase_order_items_unit_not_blank_check check (btrim(unit) <> ''),
  constraint purchase_order_items_unit_semantic_check check (btrim(unit) !~ '^[0-9]+([.,][0-9]+)?$'),
  constraint purchase_order_items_units_per_pallet_check check (units_per_pallet is null or units_per_pallet > 0),
  constraint purchase_order_items_unit_cost_check check (unit_cost is null or unit_cost >= 0),
  constraint purchase_order_items_currency_check check (currency ~ '^[A-Z]{3}$')
);

create index purchase_order_items_purchase_order_id_idx on public.purchase_order_items(purchase_order_id);
create index purchase_order_items_product_id_idx on public.purchase_order_items(product_id);

create trigger purchase_order_items_set_updated_at
before update on public.purchase_order_items
for each row execute function public.set_erp_updated_at();

create table public.purchase_receipt_allocations (
  id uuid primary key default gen_random_uuid(),
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete restrict,
  receipt_item_id uuid not null references public.warehouse_receipt_items(id) on delete restrict,
  received_quantity numeric not null default 0,
  received_pallets numeric not null default 0,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint purchase_receipt_allocations_nonnegative_check check (received_quantity >= 0 and received_pallets >= 0),
  constraint purchase_receipt_allocations_positive_check check (received_quantity > 0 or received_pallets > 0),
  constraint purchase_receipt_allocations_source_unique unique (purchase_order_item_id, receipt_item_id)
);

create index purchase_receipt_allocations_po_item_idx on public.purchase_receipt_allocations(purchase_order_item_id);
create index purchase_receipt_allocations_receipt_item_idx on public.purchase_receipt_allocations(receipt_item_id);
create index purchase_receipt_allocations_created_by_idx on public.purchase_receipt_allocations(created_by) where created_by is not null;

create or replace function public.validate_purchase_order_item_unit()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_product_unit text;
begin
  select unit into v_product_unit
  from public.products
  where id = new.product_id;

  if not found then
    raise exception 'PO_PRODUCT_NOT_FOUND';
  end if;

  if btrim(new.unit) is distinct from btrim(v_product_unit) then
    raise exception 'PO_UNIT_MUST_MATCH_PRODUCT';
  end if;

  return new;
end;
$function$;

create trigger purchase_order_items_validate_unit
before insert or update of product_id, unit on public.purchase_order_items
for each row execute function public.validate_purchase_order_item_unit();

create or replace function public.guard_purchase_order_item_structure()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if (new.purchase_order_id is distinct from old.purchase_order_id
      or new.product_id is distinct from old.product_id)
     and exists (
       select 1 from public.purchase_receipt_allocations
       where purchase_order_item_id = old.id
     ) then
    raise exception 'PO_ITEM_HAS_RECEIPTS';
  end if;
  return new;
end;
$function$;

create trigger purchase_order_items_guard_structure
before update of purchase_order_id, product_id on public.purchase_order_items
for each row execute function public.guard_purchase_order_item_structure();

create or replace function public.guard_purchase_order_structure()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if (new.supplier_id is distinct from old.supplier_id
      or new.warehouse_id is distinct from old.warehouse_id)
     and exists (
       select 1
       from public.purchase_order_items poi
       join public.purchase_receipt_allocations pra on pra.purchase_order_item_id = poi.id
       where poi.purchase_order_id = old.id
     ) then
    raise exception 'PO_HAS_RECEIPTS';
  end if;
  return new;
end;
$function$;

create trigger purchase_orders_guard_structure
before update of supplier_id, warehouse_id on public.purchase_orders
for each row execute function public.guard_purchase_order_structure();

create or replace function public.validate_purchase_receipt_allocation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_po_supplier_id uuid;
  v_po_warehouse_id uuid;
  v_po_product_id uuid;
  v_wr_supplier_id uuid;
  v_wr_warehouse_id uuid;
  v_wr_product_id uuid;
  v_wr_status text;
  v_wr_quantity numeric;
  v_wr_pallets numeric;
  v_existing_quantity numeric;
  v_existing_pallets numeric;
begin
  select po.supplier_id, po.warehouse_id, poi.product_id
    into v_po_supplier_id, v_po_warehouse_id, v_po_product_id
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id = poi.purchase_order_id
  where poi.id = new.purchase_order_item_id;

  if not found then
    raise exception 'PO_ITEM_NOT_FOUND';
  end if;

  select wr.supplier_id, wr.warehouse_id, wri.product_id, wr.status, wri.quantity, wri.pallets
    into v_wr_supplier_id, v_wr_warehouse_id, v_wr_product_id, v_wr_status, v_wr_quantity, v_wr_pallets
  from public.warehouse_receipt_items wri
  join public.warehouse_receipts wr on wr.id = wri.receipt_id
  where wri.id = new.receipt_item_id
  for update of wri;

  if not found then
    raise exception 'WR_ITEM_NOT_FOUND';
  end if;

  if v_wr_status <> 'received' then
    raise exception 'WR_NOT_ACTIVE';
  end if;

  if v_wr_product_id <> v_po_product_id then
    raise exception 'PO_WR_PRODUCT_MISMATCH';
  end if;

  if v_wr_supplier_id is null or v_wr_supplier_id <> v_po_supplier_id then
    raise exception 'PO_WR_SUPPLIER_MISMATCH';
  end if;

  if v_po_warehouse_id is not null and v_wr_warehouse_id <> v_po_warehouse_id then
    raise exception 'PO_WR_WAREHOUSE_MISMATCH';
  end if;

  select coalesce(sum(received_quantity),0), coalesce(sum(received_pallets),0)
    into v_existing_quantity, v_existing_pallets
  from public.purchase_receipt_allocations
  where receipt_item_id = new.receipt_item_id
    and id <> coalesce(new.id, gen_random_uuid());

  if v_existing_quantity + new.received_quantity > v_wr_quantity
     or v_existing_pallets + new.received_pallets > v_wr_pallets then
    raise exception 'PO_WR_ALLOCATION_EXCEEDS_RECEIPT';
  end if;

  return new;
end;
$function$;

create trigger purchase_receipt_allocations_validate
before insert or update on public.purchase_receipt_allocations
for each row execute function public.validate_purchase_receipt_allocation();

create or replace view public.purchase_order_item_progress as
select
  poi.id as purchase_order_item_id,
  poi.purchase_order_id,
  poi.product_id,
  poi.ordered_quantity,
  poi.ordered_pallets,
  poi.unit,
  poi.units_per_pallet,
  poi.unit_cost,
  poi.currency,
  coalesce(sum(pra.received_quantity),0)::numeric as received_quantity,
  coalesce(sum(pra.received_pallets),0)::numeric as received_pallets,
  greatest(poi.ordered_quantity - coalesce(sum(pra.received_quantity),0),0)::numeric as remaining_quantity,
  greatest(poi.ordered_pallets - coalesce(sum(pra.received_pallets),0),0)::numeric as remaining_pallets,
  greatest(coalesce(sum(pra.received_quantity),0) - poi.ordered_quantity,0)::numeric as excess_quantity,
  greatest(coalesce(sum(pra.received_pallets),0) - poi.ordered_pallets,0)::numeric as excess_pallets,
  case
    when coalesce(sum(pra.received_quantity),0) = 0
         and coalesce(sum(pra.received_pallets),0) = 0 then 'pending'
    when (poi.ordered_quantity = 0 or coalesce(sum(pra.received_quantity),0) >= poi.ordered_quantity)
         and (poi.ordered_pallets = 0 or coalesce(sum(pra.received_pallets),0) >= poi.ordered_pallets) then 'received'
    else 'partial'
  end as receipt_status,
  (
    (poi.ordered_quantity > 0 and coalesce(sum(pra.received_quantity),0) > poi.ordered_quantity)
    or (poi.ordered_pallets > 0 and coalesce(sum(pra.received_pallets),0) > poi.ordered_pallets)
  ) as has_excess
from public.purchase_order_items poi
left join public.purchase_receipt_allocations pra on pra.purchase_order_item_id = poi.id
group by poi.id;

create or replace view public.purchase_order_progress as
select
  po.id as purchase_order_id,
  po.po_number,
  po.supplier_id,
  po.warehouse_id,
  po.status as commercial_status,
  count(p.purchase_order_item_id)::integer as item_count,
  count(*) filter (where p.receipt_status = 'pending')::integer as pending_items,
  count(*) filter (where p.receipt_status = 'partial')::integer as partial_items,
  count(*) filter (where p.receipt_status = 'received')::integer as received_items,
  coalesce(bool_or(p.has_excess), false) as has_excess,
  case
    when count(p.purchase_order_item_id) = 0 then 'pending'
    when count(*) filter (where p.receipt_status = 'received') = count(p.purchase_order_item_id) then 'received'
    when count(*) filter (where p.receipt_status = 'pending') = count(p.purchase_order_item_id) then 'pending'
    else 'partial'
  end as receipt_status
from public.purchase_orders po
left join public.purchase_order_item_progress p on p.purchase_order_id = po.id
group by po.id;

comment on table public.purchase_orders is 'Orden comercial de compra. No representa inventario físico.';
comment on table public.purchase_order_items is 'Mercancía ordenada por Purchase Order.';
comment on table public.purchase_receipt_allocations is 'Trazabilidad entre líneas compradas y líneas físicamente recibidas en WR.';
comment on view public.purchase_order_item_progress is 'Estado físico derivado por línea de PO a partir de allocations; no es fuente mutable.';
comment on view public.purchase_order_progress is 'Estado físico derivado de la PO; separado del estado comercial de purchase_orders.status.';
