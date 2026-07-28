create extension if not exists pgcrypto;

create schema if not exists auth;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select null::uuid;
$$;

create role authenticated;

create table if not exists auth.users (
  id uuid primary key
);

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  phone text,
  created_at timestamptz not null default now()
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  client_id uuid references public.clients(id),
  container_number text,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists public.shipment_history (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid references public.shipments(id) on delete cascade,
  status text,
  created_at timestamptz not null default now()
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text,
  entity_id uuid,
  action text,
  created_at timestamptz not null default now()
);