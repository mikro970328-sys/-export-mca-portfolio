create sequence if not exists public.warehouse_receipt_number_seq start 1;

create table if not exists public.warehouses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  country text not null,
  city text,
  address text,
  notes text,
  active boolean not null default true,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.products add column if not exists package_format text;
alter table public.products add column if not exists default_units_per_pallet numeric;
alter table public.products add column if not exists notes text;

create table if not exists public.warehouse_receipts (
  id uuid primary key default gen_random_uuid(),
  receipt_number text not null unique default ('WR-' || lpad(nextval('public.warehouse_receipt_number_seq')::text, 4, '0')),
  warehouse_id uuid not null references public.warehouses(id),
  supplier_id uuid references public.suppliers(id),
  supplier_name text,
  received_at timestamptz not null default now(),
  truck_reference text,
  driver_name text,
  reference_number text,
  status text not null default 'received' check (status in ('received','cancelled')),
  notes text,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.warehouse_receipt_items (
  id uuid primary key default gen_random_uuid(),
  receipt_id uuid not null references public.warehouse_receipts(id) on delete restrict,
  product_id uuid not null references public.products(id),
  pallets numeric not null default 0 check (pallets >= 0),
  quantity numeric not null check (quantity > 0),
  unit text not null,
  units_per_pallet numeric check (units_per_pallet is null or units_per_pallet > 0),
  net_weight_kg numeric check (net_weight_kg is null or net_weight_kg >= 0),
  gross_weight_kg numeric check (gross_weight_kg is null or gross_weight_kg >= 0),
  unit_cost numeric check (unit_cost is null or unit_cost >= 0),
  currency text not null default 'USD',
  lot_number text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists warehouse_receipts_warehouse_idx on public.warehouse_receipts(warehouse_id, received_at desc);
create index if not exists warehouse_receipt_items_receipt_idx on public.warehouse_receipt_items(receipt_id);
create index if not exists warehouse_receipt_items_product_idx on public.warehouse_receipt_items(product_id);

alter table public.warehouses enable row level security;
alter table public.warehouse_receipts enable row level security;
alter table public.warehouse_receipt_items enable row level security;

comment on table public.warehouses is 'Physical inventory locations. Supports USA, Cuba and future warehouses without hard-coded countries.';
comment on table public.warehouse_receipts is 'Immutable receiving header. receipt_number is generated centrally as WR-0001, WR-0002, etc.';
comment on table public.warehouse_receipt_items is 'Product quantities physically received under a warehouse receipt. Inventory availability is derived in F2 from movements, not edited here.';
