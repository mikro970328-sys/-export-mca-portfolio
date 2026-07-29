create table if not exists public.workers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text not null,
  is_active boolean not null default true,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workers_phone_unique unique (phone)
);

create index if not exists workers_active_name_idx on public.workers(is_active, full_name);

alter table public.workers enable row level security;

-- No public policies are created. The Vercel backend uses the Supabase service-role key.

-- Future public product publications should reference workers with:
-- assigned_worker_id uuid references public.workers(id) on delete set null
