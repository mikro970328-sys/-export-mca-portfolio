-- A1 · Núcleo de Cargues
-- Fase estrictamente aditiva: define estructura y restricciones.
-- No reserva, descuenta ni mueve inventario; no inicia Tracking.
-- Esta migración es deliberadamente determinista: si un objeto ya existe,
-- debe fallar para revelar deriva de esquema en lugar de ocultarla.

create table public.loads (
  id uuid primary key default gen_random_uuid(),
  load_serial bigint generated always as identity,
  load_number text generated always as ('CG-' || lpad(load_serial::text, 4, '0')) stored,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  shipment_id uuid null references public.shipments(id) on delete restrict,
  status text not null default 'draft' check (status in ('draft','reserved','loading','loaded','dispatched','cancelled')),
  scheduled_at timestamptz null,
  loading_started_at timestamptz null,
  loaded_at timestamptz null,
  dispatched_at timestamptz null,
  cancelled_at timestamptz null,
  notes text null,
  created_by uuid null references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint loads_load_number_unique unique (load_number),
  constraint loads_status_timestamps_check check (
    (status <> 'loading' or loading_started_at is not null)
    and (status <> 'loaded' or (loading_started_at is not null and loaded_at is not null))
    and (status <> 'dispatched' or (loading_started_at is not null and loaded_at is not null and dispatched_at is not null))
    and (status <> 'cancelled' or cancelled_at is not null)
    and not (dispatched_at is not null and cancelled_at is not null)
  )
);

create unique index loads_shipment_id_unique
  on public.loads(shipment_id)
  where shipment_id is not null;

create index loads_warehouse_id_idx on public.loads(warehouse_id);
create index loads_status_idx on public.loads(status);
create index loads_created_at_idx on public.loads(created_at desc);

create table public.load_items (
  id uuid primary key default gen_random_uuid(),
  load_id uuid not null references public.loads(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  planned_quantity numeric not null default 0,
  planned_pallets numeric not null default 0,
  unit text not null,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint load_items_planned_nonnegative_check check (
    planned_quantity >= 0 and planned_pallets >= 0
  ),
  constraint load_items_planned_positive_check check (
    planned_quantity > 0 or planned_pallets > 0
  ),
  constraint load_items_unit_not_blank_check check (btrim(unit) <> ''),
  constraint load_items_load_product_unique unique (load_id, product_id)
);

create index load_items_load_id_idx on public.load_items(load_id);
create index load_items_product_id_idx on public.load_items(product_id);

create table public.load_allocations (
  id uuid primary key default gen_random_uuid(),
  load_item_id uuid not null references public.load_items(id) on delete cascade,
  receipt_item_id uuid not null references public.warehouse_receipt_items(id) on delete restrict,
  allocated_quantity numeric not null default 0,
  allocated_pallets numeric not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint load_allocations_nonnegative_check check (
    allocated_quantity >= 0 and allocated_pallets >= 0
  ),
  constraint load_allocations_positive_check check (
    allocated_quantity > 0 or allocated_pallets > 0
  ),
  constraint load_allocations_source_unique unique (load_item_id, receipt_item_id)
);

create index load_allocations_load_item_id_idx on public.load_allocations(load_item_id);
create index load_allocations_receipt_item_id_idx on public.load_allocations(receipt_item_id);

create function public.validate_load_allocation_source()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_load_product_id uuid;
  v_load_warehouse_id uuid;
  v_receipt_product_id uuid;
  v_receipt_warehouse_id uuid;
  v_receipt_status text;
begin
  select li.product_id, l.warehouse_id
    into v_load_product_id, v_load_warehouse_id
  from public.load_items li
  join public.loads l on l.id = li.load_id
  where li.id = new.load_item_id;

  if v_load_product_id is null then
    raise exception 'LOAD_ITEM_NOT_FOUND';
  end if;

  select wri.product_id, wr.warehouse_id, wr.status
    into v_receipt_product_id, v_receipt_warehouse_id, v_receipt_status
  from public.warehouse_receipt_items wri
  join public.warehouse_receipts wr on wr.id = wri.receipt_id
  where wri.id = new.receipt_item_id;

  if v_receipt_product_id is null then
    raise exception 'RECEIPT_ITEM_NOT_FOUND';
  end if;

  if v_receipt_status <> 'received' then
    raise exception 'WR_NOT_ACTIVE';
  end if;

  if v_receipt_product_id <> v_load_product_id then
    raise exception 'LOAD_ALLOCATION_PRODUCT_MISMATCH';
  end if;

  if v_receipt_warehouse_id <> v_load_warehouse_id then
    raise exception 'LOAD_ALLOCATION_WAREHOUSE_MISMATCH';
  end if;

  return new;
end;
$$;

create trigger load_allocations_validate_source
before insert or update of load_item_id, receipt_item_id
on public.load_allocations
for each row execute function public.validate_load_allocation_source();

alter table public.loads enable row level security;
alter table public.load_items enable row level security;
alter table public.load_allocations enable row level security;

revoke all on public.loads from anon, authenticated;
revoke all on public.load_items from anon, authenticated;
revoke all on public.load_allocations from anon, authenticated;
revoke all on function public.validate_load_allocation_source() from public, anon, authenticated;

-- Identity sequences have privileges independent from their owning table.
revoke all on sequence public.loads_load_serial_seq from anon, authenticated;
grant usage, select on sequence public.loads_load_serial_seq to service_role;

grant all on public.loads to service_role;
grant all on public.load_items to service_role;
grant all on public.load_allocations to service_role;
grant execute on function public.validate_load_allocation_source() to service_role;

comment on table public.loads is 'Cabecera de cargue físico. A1 define estructura; efectos de inventario se implementan en fases posteriores.';
comment on column public.loads.load_number is 'Número CG generado exclusivamente por PostgreSQL a partir de load_serial.';
comment on table public.load_items is 'Contenido lógico planificado por producto dentro de un cargue.';
comment on table public.load_allocations is 'Asignación exacta de cantidades de un load_item a warehouse_receipt_items de origen.';
comment on function public.validate_load_allocation_source() is 'Impide asignar a un cargue mercancía de otro producto, otro almacén o un WR cancelado.';
