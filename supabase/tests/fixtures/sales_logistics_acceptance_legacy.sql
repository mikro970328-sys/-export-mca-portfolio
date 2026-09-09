-- Disposable PGlite scaffold only. Never apply to Supabase.
-- Complements purchase_acceptance_legacy.sql with legacy tables/columns needed
-- by the real sales, invoice, load and document migrations. No business routines.
alter table public.importers add column legal_name text;
create table public.operations (
  id uuid primary key default gen_random_uuid(), operation_code text not null unique,
  client_id uuid not null references public.clients(id), supplier_id uuid references public.suppliers(id),
  importer_id uuid references public.importers(id), status text not null default 'draft',
  currency text not null default 'USD', container_number text, bol_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.shipments
  alter column operational_status set default 'Registrado',
  add column operation_id uuid references public.operations(id),
  add column booking_number text, add column bol_number text, add column carrier text,
  add column product text, add column quantity numeric, add column quantity_unit text,
  add column departure_date date, add column released_at timestamptz,
  add column delivered_at timestamptz, add column discharged_at timestamptz,
  add column last_location text, add column last_event_at timestamptz,
  add column shipsgo_status text;
create table public.shipment_history (
  id uuid primary key default gen_random_uuid(), shipment_id uuid not null references public.shipments(id),
  client_id uuid references public.clients(id), event_type text not null, title text not null,
  details text, source text not null default 'admin', created_at timestamptz not null default now()
);
create table public.invoices (
  id uuid primary key default gen_random_uuid(), operation_id uuid not null references public.operations(id),
  client_id uuid not null references public.clients(id), invoice_number text unique,
  issue_date date not null default current_date, due_date date, currency text not null default 'USD',
  status text not null default 'draft', subtotal numeric, tax_total numeric, total numeric, paid_amount numeric,
  notes text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.payments (
  id uuid primary key default gen_random_uuid(), operation_id uuid references public.operations(id),
  invoice_id uuid not null references public.invoices(id), client_id uuid not null references public.clients(id),
  amount numeric not null, currency text not null default 'USD', payment_date date not null default current_date,
  method text, reference_number text, status text not null default 'posted', notes text,
  created_at timestamptz not null default now(), created_by uuid references public.admin_users(id)
);
create table public.documents (
  id uuid primary key default gen_random_uuid(), operation_id uuid references public.operations(id),
  client_id uuid references public.clients(id), shipment_id uuid references public.shipments(id),
  document_type text not null, file_name text not null, storage_bucket text not null default 'erp-documents',
  storage_path text not null, mime_type text, file_size_bytes bigint, version integer not null default 1,
  notes text, uploaded_by uuid, uploaded_by_admin_id uuid references public.admin_users(id),
  uploaded_by_username text, bol_number text, shared_bl boolean not null default false,
  created_at timestamptz not null default now()
);
