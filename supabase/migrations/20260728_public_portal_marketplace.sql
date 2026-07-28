-- Export MCA: base para portal público de rastreo y mercancía disponible
create extension if not exists pgcrypto;

create table if not exists public.operations (
  id uuid primary key default gen_random_uuid(),
  operation_code text not null unique,
  client_id uuid references public.clients(id) on delete set null,
  invoice_number text,
  title text,
  description text,
  payment_status text not null default 'pending' check (payment_status in ('pending','partial','paid')),
  operational_status text not null default 'draft',
  public_tracking_enabled boolean not null default false,
  public_tracking_code text unique,
  public_summary text,
  origin_port text,
  destination_port text,
  carrier text,
  vessel_name text,
  booking_number text,
  bol_number text,
  estimated_departure_at timestamptz,
  actual_departure_at timestamptz,
  estimated_arrival_at timestamptz,
  actual_arrival_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.operation_shipments (
  operation_id uuid not null references public.operations(id) on delete cascade,
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (operation_id, shipment_id)
);

create table if not exists public.operation_events (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid not null references public.operations(id) on delete cascade,
  shipment_id uuid references public.shipments(id) on delete set null,
  status_code text not null,
  title text not null,
  public_description text,
  location text,
  source text not null default 'admin',
  event_at timestamptz not null default now(),
  is_public boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists operation_events_operation_idx on public.operation_events(operation_id, event_at desc);

create table if not exists public.inventory_listings (
  id uuid primary key default gen_random_uuid(),
  operation_id uuid references public.operations(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  slug text not null unique,
  product_name text not null,
  category text,
  brand text,
  specification text,
  unit text,
  total_quantity numeric(18,3),
  available_quantity numeric(18,3),
  reserved_quantity numeric(18,3) not null default 0,
  price_text text,
  image_url text,
  origin_port text,
  destination_port text,
  estimated_departure_at timestamptz,
  estimated_arrival_at timestamptz,
  availability_status text not null default 'available' check (availability_status in ('coming_soon','available','limited','reserved','sold_out')),
  public_visible boolean not null default false,
  public_notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists inventory_listings_public_idx on public.inventory_listings(public_visible, availability_status, estimated_departure_at);

create table if not exists public.marketplace_leads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references public.inventory_listings(id) on delete set null,
  customer_name text not null,
  company text,
  phone text not null,
  email text,
  requested_quantity numeric(18,3),
  message text,
  status text not null default 'new' check (status in ('new','contacted','quoted','won','lost')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.operations enable row level security;
alter table public.operation_shipments enable row level security;
alter table public.operation_events enable row level security;
alter table public.inventory_listings enable row level security;
alter table public.marketplace_leads enable row level security;

-- El acceso público se realiza exclusivamente mediante las API de Vercel con service role.
-- No se crean políticas anónimas directas sobre las tablas.

create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists operations_set_updated_at on public.operations;
create trigger operations_set_updated_at before update on public.operations
for each row execute function public.set_updated_at();

drop trigger if exists inventory_listings_set_updated_at on public.inventory_listings;
create trigger inventory_listings_set_updated_at before update on public.inventory_listings
for each row execute function public.set_updated_at();

drop trigger if exists marketplace_leads_set_updated_at on public.marketplace_leads;
create trigger marketplace_leads_set_updated_at before update on public.marketplace_leads
for each row execute function public.set_updated_at();
