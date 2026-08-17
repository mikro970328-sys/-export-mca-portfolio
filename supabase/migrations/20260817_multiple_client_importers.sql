create table if not exists public.importers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text null,
  country text not null default 'Cuba',
  email text null,
  phone text null,
  address text null,
  contact_name text null,
  notes text null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.importers
  add column if not exists normalized_name text null;

update public.importers
set normalized_name = upper(btrim(name))
where normalized_name is null or btrim(normalized_name) = '';

alter table public.importers
  alter column normalized_name set not null;

create unique index if not exists importers_normalized_name_uidx
  on public.importers(normalized_name);

create table if not exists public.client_importers (
  client_id uuid not null references public.clients(id) on delete cascade,
  importer_id uuid not null references public.importers(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (client_id, importer_id)
);

create index if not exists client_importers_importer_id_idx
  on public.client_importers(importer_id);

alter table public.shipments
  add column if not exists importer_id uuid null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'shipments_importer_id_fkey'
  ) then
    alter table public.shipments
      add constraint shipments_importer_id_fkey
      foreign key (importer_id) references public.importers(id) on delete set null;
  end if;
end $$;

create index if not exists shipments_importer_id_idx
  on public.shipments(importer_id);

insert into public.importers (name, normalized_name)
select min(btrim(importer_name)), upper(btrim(importer_name))
from public.clients
where nullif(btrim(importer_name), '') is not null
group by upper(btrim(importer_name))
on conflict (normalized_name) do nothing;

insert into public.client_importers (client_id, importer_id)
select c.id, i.id
from public.clients c
join public.importers i
  on i.normalized_name = upper(btrim(c.importer_name))
where nullif(btrim(c.importer_name), '') is not null
on conflict do nothing;

update public.shipments s
set importer_id = ci.importer_id
from public.client_importers ci
where s.importer_id is null
  and s.client_id = ci.client_id
  and 1 = (
    select count(*)
    from public.client_importers ci2
    where ci2.client_id = s.client_id
  );
