create extension if not exists pgcrypto;

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  phone text not null,
  email text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  container_number text not null unique,
  booking_number text,
  bol_number text,
  carrier text,
  product text,
  active boolean not null default true,
  last_status text,
  last_location text,
  last_event_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  twilio_message_sid text unique,
  recipient_phone text not null,
  event_status text not null,
  event_location text,
  event_time timestamptz,
  delivery_status text,
  error_code text,
  error_message text,
  raw_event jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  container_number text,
  event_type text,
  payload jsonb not null,
  processed boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists shipments_container_idx on public.shipments(container_number);
create index if not exists notifications_shipment_idx on public.notifications(shipment_id);
create index if not exists notifications_event_idx on public.notifications(shipment_id,event_status,event_time);

alter table public.clients enable row level security;
alter table public.shipments enable row level security;
alter table public.notifications enable row level security;
alter table public.webhook_events enable row level security;

-- No public policies are created. The Vercel backend uses the Supabase service-role key.
