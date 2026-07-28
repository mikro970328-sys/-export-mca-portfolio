alter table public.clients add column if not exists welcome_status text not null default 'pending';
alter table public.clients add column if not exists welcome_sent_at timestamptz;
alter table public.clients add column if not exists welcome_error text;
alter table public.clients add column if not exists updated_at timestamptz not null default now();

alter table public.shipments add column if not exists operational_status text not null default 'Registrado';
alter table public.shipments add column if not exists released_at timestamptz;
alter table public.shipments add column if not exists delivered_at timestamptz;
alter table public.shipments add column if not exists release_notification_status text not null default 'pending';
alter table public.shipments add column if not exists release_notification_error text;
alter table public.shipments add column if not exists updated_at timestamptz not null default now();

create unique index if not exists shipments_container_number_unique on public.shipments (upper(container_number));

create table if not exists public.shipment_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.shipments(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  event_type text not null,
  title text not null,
  details text,
  source text not null default 'admin',
  created_at timestamptz not null default now()
);
create index if not exists shipment_history_shipment_idx on public.shipment_history(shipment_id, created_at desc);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  details jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

create table if not exists public.processed_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  created_at timestamptz not null default now()
);

update public.shipments set operational_status = coalesce(nullif(last_status,''),'Registrado') where operational_status is null or operational_status='Registrado';