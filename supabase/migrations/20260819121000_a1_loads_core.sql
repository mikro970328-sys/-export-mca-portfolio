-- A1 · Núcleo de Cargues
-- Fase estrictamente aditiva: define estructura y restricciones.
-- No reserva, descuenta ni mueve inventario; no inicia Tracking.

create table if not exists public.loads (
  id uuid primary key default gen_random_uuid(),
  load_number text not null unique,
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
  constraint loads_status_timestamps_check check (
    (status <> 'loading' or loading_started_at is not null)
    and (status <> 'loaded' or loaded_at is not null)
    and (status <> 'dispatched' or dispatched_at is not null)
    and (status <> 'cancelled' or cancelled_at is not null)
  )
);

create unique index if not exists loads_shipment_id_unique
  on public.loads(shipment_id)
  where shipment_id is not null;

create index if not exists loads_warehouse_id_idx on public.loads(warehouse_id);
create index if not exists loads_status_idx on public.loads(status);
create index if not exists loads_created_at_idx on public.loads(created_at desc);

create table if not exists public.load_items (
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

create index if not exists load_items_load_id_idx on public.load_items(load_id);
create index if not exists load_items_product_id_idx on public.load_items(product_id);

create table if not exists public.load_allocations (
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

create index if not exists load_allocations_load_item_id_idx on public.load_allocations(load_item_id);
create index if not exists load_allocations_receipt_item_id_idx on public.load_allocations(receipt_item_id);

alter table public.loads enable row level security;
alter table public.load_items enable row level security;
alter table public.load_allocations enable row level security;

revoke all on public.loads from anon, authenticated;
revoke all on public.load_items from anon, authenticated;
revoke all on public.load_allocations from anon, authenticated;

grant all on public.loads to service_role;
grant all on public.load_items to service_role;
grant all on public.load_allocations to service_role;

comment on table public.loads is 'Cabecera de cargue físico. A1 define estructura; efectos de inventario se implementan en fases posteriores.';
comment on table public.load_items is 'Contenido lógico planificado por producto dentro de un cargue.';
comment on table public.load_allocations is 'Asignación exacta de cantidades de un load_item a warehouse_receipt_items de origen.';
