-- Export Platform — Architecture 1.0 core
-- Compatibility-first foundation for the existing CRM.
-- Keeps current production tables (clients, shipments, shipment_history, audit_log)
-- as the source of truth while adding multi-company auth, roles and assignments.

create extension if not exists pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'record_status') THEN
    CREATE TYPE public.record_status AS ENUM ('active', 'inactive', 'archived');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'assignment_scope') THEN
    CREATE TYPE public.assignment_scope AS ENUM ('general', 'commercial', 'logistics', 'finance', 'cuba_operations', 'delivery');
  END IF;
END $$;

create table if not exists public.companies (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  trade_name text,
  ein text,
  email text,
  phone text,
  website text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country_code text not null default 'US',
  currency_code text not null default 'USD',
  locale text not null default 'es-US',
  timezone text not null default 'America/New_York',
  logo_url text,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  company_id uuid not null references public.companies(id),
  first_name text not null,
  last_name text,
  display_name text,
  phone text,
  job_title text,
  status public.record_status not null default 'active',
  last_seen_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  name text not null,
  slug text not null,
  description text,
  is_system boolean not null default false,
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, slug)
);

create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  module text not null,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

create table if not exists public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role_id uuid not null references public.roles(id) on delete cascade,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role_id)
);

create table if not exists public.user_permission_overrides (
  user_id uuid not null references auth.users(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  allowed boolean not null,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (user_id, permission_id)
);

-- Compatibility layer: enrich the existing clients table instead of creating customers.
DO $$
BEGIN
  IF to_regclass('public.clients') IS NOT NULL THEN
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS status public.record_status NOT NULL DEFAULT 'active';
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS legal_name text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS trade_name text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS tax_id text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS customer_type text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS whatsapp text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS address_line1 text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS address_line2 text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS city text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS state_region text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS postal_code text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS country_code text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS notes text;
    ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id);
  END IF;
END $$;

create table if not exists public.client_contacts (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.clients(id) on delete cascade,
  first_name text not null,
  last_name text,
  job_title text,
  email text,
  phone text,
  whatsapp text,
  is_primary boolean not null default false,
  portal_user_id uuid references auth.users(id),
  status public.record_status not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.client_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  client_id uuid not null references public.clients(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  scope public.assignment_scope not null default 'general',
  is_primary boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (client_id, user_id, scope, starts_at)
);

-- Keep the current audit_log table as the single audit source.
DO $$
BEGIN
  IF to_regclass('public.audit_log') IS NOT NULL THEN
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS company_id uuid REFERENCES public.companies(id);
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS actor_user_id uuid REFERENCES auth.users(id);
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS old_data jsonb;
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS new_data jsonb;
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS ip_address inet;
    ALTER TABLE public.audit_log ADD COLUMN IF NOT EXISTS user_agent text;
  END IF;
END $$;

create table if not exists public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_company on public.profiles(company_id);
create index if not exists idx_roles_company on public.roles(company_id);
create index if not exists idx_clients_company_status on public.clients(company_id, status);
create index if not exists idx_client_contacts_client on public.client_contacts(client_id);
create index if not exists idx_client_assignments_client_scope on public.client_assignments(client_id, scope);
create index if not exists idx_client_assignments_user on public.client_assignments(user_id);
create index if not exists idx_audit_log_company_created on public.audit_log(company_id, created_at desc);
create index if not exists idx_audit_log_entity on public.audit_log(entity_type, entity_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

DROP TRIGGER IF EXISTS companies_set_updated_at ON public.companies;
create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

DROP TRIGGER IF EXISTS roles_set_updated_at ON public.roles;
create trigger roles_set_updated_at
before update on public.roles
for each row execute function public.set_updated_at();

DROP TRIGGER IF EXISTS client_contacts_set_updated_at ON public.client_contacts;
create trigger client_contacts_set_updated_at
before update on public.client_contacts
for each row execute function public.set_updated_at();

insert into public.permissions (key, module, description) values
  ('customers.create', 'customers', 'Crear clientes'),
  ('customers.read', 'customers', 'Ver clientes'),
  ('customers.update', 'customers', 'Editar clientes'),
  ('customers.archive', 'customers', 'Archivar clientes'),
  ('products.create', 'products', 'Crear productos'),
  ('products.update', 'products', 'Editar productos'),
  ('products.publish', 'products', 'Publicar productos'),
  ('products.notify', 'products', 'Notificar una publicación'),
  ('products.renotify', 'products', 'Renotificar una publicación'),
  ('operations.create', 'operations', 'Crear operaciones'),
  ('operations.authorize', 'operations', 'Autorizar operaciones'),
  ('operations.assign', 'operations', 'Asignar responsables'),
  ('containers.create', 'containers', 'Crear contenedores'),
  ('containers.release', 'containers', 'Marcar contenedores liberados'),
  ('deliveries.confirm', 'deliveries', 'Confirmar entregas'),
  ('finance.read', 'finance', 'Ver finanzas'),
  ('finance.write', 'finance', 'Modificar finanzas'),
  ('users.create', 'users', 'Crear usuarios'),
  ('users.assign_roles', 'users', 'Asignar roles'),
  ('settings.manage', 'settings', 'Administrar configuración'),
  ('audit.read', 'audit', 'Ver auditoría')
on conflict (key) do nothing;

alter table public.companies enable row level security;
alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
alter table public.user_roles enable row level security;
alter table public.user_permission_overrides enable row level security;
alter table public.client_contacts enable row level security;
alter table public.client_assignments enable row level security;
alter table public.company_settings enable row level security;

create or replace function public.current_company_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select company_id from public.profiles where id = auth.uid();
$$;

DROP POLICY IF EXISTS profiles_same_company_read ON public.profiles;
create policy profiles_same_company_read
on public.profiles for select
using (company_id = public.current_company_id());

DROP POLICY IF EXISTS companies_same_company_read ON public.companies;
create policy companies_same_company_read
on public.companies for select
using (id = public.current_company_id());

DROP POLICY IF EXISTS roles_same_company_read ON public.roles;
create policy roles_same_company_read
on public.roles for select
using (company_id = public.current_company_id());

DROP POLICY IF EXISTS permissions_authenticated_read ON public.permissions;
create policy permissions_authenticated_read
on public.permissions for select
to authenticated
using (true);

DROP POLICY IF EXISTS client_contacts_same_company_all ON public.client_contacts;
create policy client_contacts_same_company_all
on public.client_contacts for all
using (
  exists (
    select 1 from public.clients c
    where c.id = client_contacts.client_id
      and c.company_id = public.current_company_id()
  )
)
with check (
  exists (
    select 1 from public.clients c
    where c.id = client_contacts.client_id
      and c.company_id = public.current_company_id()
  )
);

DROP POLICY IF EXISTS client_assignments_same_company_all ON public.client_assignments;
create policy client_assignments_same_company_all
on public.client_assignments for all
using (company_id = public.current_company_id())
with check (company_id = public.current_company_id());

DROP POLICY IF EXISTS company_settings_same_company_all ON public.company_settings;
create policy company_settings_same_company_all
on public.company_settings for all
using (company_id = public.current_company_id())
with check (company_id = public.current_company_id());

-- Deliberately do not enable or modify RLS on clients, shipments, shipment_history
-- or audit_log in this migration. The current backend continues to own those paths
-- until each endpoint is migrated to Supabase Auth and permission checks.
