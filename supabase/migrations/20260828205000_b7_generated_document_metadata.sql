-- B7.1 · Metadata e integridad de documentos comerciales generados
-- Reutiliza public.documents y erp-documents; no crea un repositorio paralelo.

alter table public.documents
  add column if not exists generated boolean not null default false,
  add column if not exists source_type text,
  add column if not exists source_id uuid,
  add column if not exists content_sha256 text,
  add column if not exists generated_at timestamptz;

alter table public.documents
  drop constraint if exists documents_generated_source_check;

alter table public.documents
  add constraint documents_generated_source_check check (
    (
      generated = false
      and source_type is null
      and source_id is null
      and content_sha256 is null
      and generated_at is null
    )
    or
    (
      generated = true
      and source_type in ('invoice','load')
      and source_id is not null
      and content_sha256 ~ '^[0-9a-f]{64}$'
      and generated_at is not null
    )
  );

create index if not exists documents_generated_source_idx
  on public.documents(source_type, source_id, created_at desc)
  where generated = true;

create unique index if not exists documents_generated_source_version_uidx
  on public.documents(source_type, source_id, document_type, version)
  where generated = true;

create or replace function public.guard_generated_document_integrity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_load public.loads;
  v_shipment public.shipments;
  v_client_id uuid;
begin
  if tg_op = 'DELETE' then
    if old.generated then
      raise exception 'GENERATED_DOCUMENT_IMMUTABLE';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.generated then
    raise exception 'GENERATED_DOCUMENT_IMMUTABLE';
  end if;

  if not new.generated then
    return new;
  end if;

  if new.source_type = 'invoice' then
    select * into v_invoice from public.invoices where id = new.source_id;
    if not found then raise exception 'GENERATED_DOCUMENT_INVOICE_NOT_FOUND'; end if;
    if v_invoice.status <> 'issued' then raise exception 'GENERATED_DOCUMENT_INVOICE_NOT_ISSUED'; end if;
    if new.document_type <> 'Factura comercial' then raise exception 'GENERATED_DOCUMENT_INVOICE_TYPE_INVALID'; end if;
    if new.client_id is distinct from v_invoice.client_id then raise exception 'GENERATED_DOCUMENT_CLIENT_MISMATCH'; end if;
    if new.operation_id is distinct from v_invoice.operation_id then raise exception 'GENERATED_DOCUMENT_OPERATION_MISMATCH'; end if;
    if new.load_id is not null or new.shipment_id is not null or new.bol_number is not null then
      raise exception 'GENERATED_DOCUMENT_INVOICE_SCOPE_INVALID';
    end if;

  elsif new.source_type = 'load' then
    select * into v_load from public.loads where id = new.source_id;
    if not found then raise exception 'GENERATED_DOCUMENT_LOAD_NOT_FOUND'; end if;
    if v_load.status not in ('loaded','dispatched') then raise exception 'GENERATED_DOCUMENT_LOAD_NOT_FINAL'; end if;
    if v_load.shipment_id is null then raise exception 'GENERATED_DOCUMENT_LOAD_SHIPMENT_REQUIRED'; end if;
    if new.document_type <> 'Packing List' then raise exception 'GENERATED_DOCUMENT_LOAD_TYPE_INVALID'; end if;
    if new.load_id is distinct from v_load.id then raise exception 'GENERATED_DOCUMENT_LOAD_SCOPE_INVALID'; end if;

    select * into v_shipment from public.shipments where id = v_load.shipment_id;
    if not found then raise exception 'GENERATED_DOCUMENT_SHIPMENT_NOT_FOUND'; end if;

    v_client_id := coalesce(v_load.client_id, v_shipment.client_id);
    if new.client_id is distinct from v_client_id then raise exception 'GENERATED_DOCUMENT_CLIENT_MISMATCH'; end if;
    if new.shipment_id is distinct from v_shipment.id then raise exception 'GENERATED_DOCUMENT_SHIPMENT_MISMATCH'; end if;
    if new.operation_id is distinct from v_shipment.operation_id then raise exception 'GENERATED_DOCUMENT_OPERATION_MISMATCH'; end if;
    if new.bol_number is distinct from v_shipment.bol_number then raise exception 'GENERATED_DOCUMENT_BOL_MISMATCH'; end if;
  else
    raise exception 'GENERATED_DOCUMENT_SOURCE_TYPE_INVALID';
  end if;

  return new;
end;
$$;

drop trigger if exists documents_guard_generated_integrity on public.documents;
create trigger documents_guard_generated_integrity
before insert or update or delete on public.documents
for each row execute function public.guard_generated_document_integrity();

revoke all on function public.guard_generated_document_integrity() from public, anon, authenticated;
