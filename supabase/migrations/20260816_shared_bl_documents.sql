alter table public.documents
  add column if not exists shared_bl boolean not null default false;

create index if not exists documents_shared_bl_bol_idx
  on public.documents (bol_number)
  where shared_bl = true and bol_number is not null;

create index if not exists shipments_bol_number_idx
  on public.shipments (bol_number)
  where bol_number is not null;
