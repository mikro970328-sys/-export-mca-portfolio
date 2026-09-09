-- Only for the disposable PGlite database. Never apply this file to Supabase.
-- Legacy master tables predate the versioned ERP migrations. Only the columns
-- needed by this acceptance slice are represented here; this is not a schema dump.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create extension if not exists pgcrypto;
create table public.admin_users(id uuid primary key default gen_random_uuid(), username text, role text);
create table public.audit_log(
  id uuid primary key default gen_random_uuid(), action text, entity_type text,
  entity_id uuid, details jsonb, created_at timestamptz default now()
);
create table public.suppliers(
  id uuid primary key default gen_random_uuid(), name text not null, legal_name text,
  country text, active boolean not null default true
);
create table public.products(
  id uuid primary key default gen_random_uuid(), sku text, name text not null,
  brand text, category text, unit text, active boolean not null default true
);
create table public.clients(
  id uuid primary key default gen_random_uuid(), name text not null,
  company text, active boolean not null default true
);
create table public.importers(
  id uuid primary key default gen_random_uuid(), name text not null, active boolean not null default true
);
create table public.client_importers(
  client_id uuid references public.clients(id), importer_id uuid references public.importers(id),
  primary key(client_id,importer_id)
);
create table public.shipments(
  id uuid primary key default gen_random_uuid(), container_number text not null unique,
  client_id uuid references public.clients(id), importer_id uuid references public.importers(id),
  active boolean not null default true, operational_status text not null default 'En tránsito',
  last_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
-- Same body as the live helper inspected on 2026-09-09.
create function public.set_erp_updated_at() returns trigger language plpgsql
set search_path to 'public','pg_temp' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
