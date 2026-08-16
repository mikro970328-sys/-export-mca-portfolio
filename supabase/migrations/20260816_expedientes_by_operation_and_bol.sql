alter table public.shipments
  add column if not exists operation_id uuid null references public.operations(id) on delete set null;

create index if not exists shipments_operation_id_idx
  on public.shipments(operation_id);

alter table public.documents
  add column if not exists bol_number text null;

create index if not exists documents_operation_id_idx
  on public.documents(operation_id);

create index if not exists documents_operation_bol_idx
  on public.documents(operation_id, bol_number);
