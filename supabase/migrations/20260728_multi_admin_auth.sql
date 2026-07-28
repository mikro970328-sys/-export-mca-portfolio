create extension if not exists pgcrypto;

create table if not exists public.admin_users (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  username text not null,
  username_normalized text generated always as (lower(trim(username))) stored,
  password_salt text not null,
  password_hash text not null,
  role text not null default 'admin' check (role in ('master_admin','admin')),
  is_active boolean not null default true,
  failed_attempts integer not null default 0,
  locked_until timestamptz,
  last_login_at timestamptz,
  password_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references public.admin_users(id) on delete set null
);

create unique index if not exists admin_users_username_unique
  on public.admin_users(username_normalized);

alter table public.admin_users enable row level security;

insert into public.admin_users (
  full_name,
  username,
  password_salt,
  password_hash,
  role,
  is_active
)
select
  'Daniel Cabrera',
  'Daniel97',
  'da8wFM25QKDBxxMvKKTMJA',
  'Om_Wo6AVKKerrknBXn17E3Dn3C5bShw9w4rG_9xjudp8CKcbTWJDDkMpOBcPhVlF8-_d1DllUFNVaSqyAQhEAg',
  'master_admin',
  true
where not exists (
  select 1 from public.admin_users where username_normalized = 'daniel97'
);

create or replace function public.touch_admin_users_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists admin_users_touch_updated_at on public.admin_users;
create trigger admin_users_touch_updated_at
before update on public.admin_users
for each row execute function public.touch_admin_users_updated_at();

alter table public.audit_log
  add column if not exists actor_admin_id uuid references public.admin_users(id) on delete set null,
  add column if not exists actor_username text;
