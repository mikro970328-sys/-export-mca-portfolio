-- Export Platform — Architecture 1.0 core
-- Safe foundation for multi-company auth, roles, customers, assignments and audit.

create extension if not exists pgcrypto;

create type public.record_status as enum ('active', 'inactive', 'archived');
create type public.assignment_scope as enum ('general', 'commercial', 'logistics', 'finance', 'cuba_operations', 'delivery');

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

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  legal_name text not null,
  trade_name text,
  tax_id text,
  customer_type text,
  email text,
  phone text,
  whatsapp text,
  address_line1 text,
  address_line2 text,
  city text,
  state_region text,
  postal_code text,
  country_code text,
  notes text,
  status public.record_status not null default 'active',
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
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

create table if not exists public.customer_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id),
  customer_id uuid not null references public.customers(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  scope public.assignment_scope not null default 'general',
  is_primary boolean not null default false,
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (customer_id, user_id, scope, starts_at)
);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  company_id uuid references public.companies(id),
  actor_user_id uuid references auth.users(id),
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  metadata jsonb not null default '{}'::jsonb,
  ip_address inet,
  user_agent text,
  created_at timestamptz not null default now()
);

create table if not exists public.company_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create index if not exists idx_profiles_company on public.profiles(company_id);
create index if not exists idx_roles_company on public.roles(company_id);
create index if not exists idx_customers_company_status on public.customers(company_id, status);
create index if not exists idx_customer_contacts_customer on public.customer_contacts(customer_id);
create index if not exists idx_customer_assignments_customer_scope on public.customer_assignments(customer_id, scope);
create index if not exists idx_customer_assignments_user on public.customer_assignments(user_id);
create index if not exists idx_audit_logs_company_created on public.audit_logs(company_id, created_at desc);
create index if not exists idx_audit_logs_entity on public.audit_logs(entity_type, entity_id);

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger companies_set_updated_at
before update on public.companies
for each row execute function public.set_updated_at();

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger roles_set_updated_at
before update on public.roles
for each row execute function public.set_updated_at();

create trigger customers_set_updated_at
before update on public.customers
for each row execute function public.set_updated_at();

create trigger customer_contacts_set_updated_at
before update on public.customer_contacts
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
alter table public.customers enable row level security;
alter table public.customer_contacts enable row level security;
alter table public.customer_assignments enable row level security;
alter table public.audit_logs enable row level security;
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

create policy "profiles_same_company_read"
on public.profiles for select
using (company_id = public.current_company_id());

create policy "companies_same_company_read"
on public.companies for select
using (id = public.current_company_id());

create policy "roles_same_company_read"
on public.roles for select
using (company_id = public.current_company_id());

create policy "permissions_authenticated_read"
on public.permissions for select
to authenticated
using (true);

create policy "customers_same_company_all"
on public.customers for all
using (company_id = public.current_company_id())
with check (company_id = public.current_company_id());

create policy "customer_contacts_same_company_all"
on public.customer_contacts for all
using (
  exists (
    select 1 from public.customers c
    where c.id = customer_contacts.customer_id
      and c.company_id = public.current_company_id()
  )
)
with check (
  exists (
    select 1 from public.customers c
    where c.id = customer_contacts.customer_id
      and c.company_id = public.current_company_id()
  )
);

create policy "customer_assignments_same_company_all"
on public.customer_assignments for all
using (company_id = public.current_company_id())
with check (company_id = public.current_company_id());

create policy "audit_logs_same_company_read"
on public.audit_logs for select
using (company_id = public.current_company_id());

create policy "company_settings_same_company_all"
on public.company_settings for all
using (company_id = public.current_company_id())
with check (company_id = public.current_company_id());
