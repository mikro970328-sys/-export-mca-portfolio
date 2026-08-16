-- Expedientes de exportación: archivo documental por contenedor.
-- Additive only: preserves existing operations, shipments and documents.

alter table public.documents
  add column if not exists uploaded_by_admin_id uuid references public.admin_users(id) on delete set null,
  add column if not exists uploaded_by_username text;

create index if not exists idx_documents_shipment_created
  on public.documents(shipment_id, created_at desc);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'erp-documents',
  'erp-documents',
  false,
  26214400,
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
    'image/webp',
    'text/plain'
  ]::text[]
)
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
