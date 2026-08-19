-- A5 · Expedientes de Cargue
-- Reutiliza public.documents como única fuente documental.
-- No duplica archivos ni registros para mostrar documentos heredados.

alter table public.documents
  add column if not exists load_id uuid references public.loads(id) on delete cascade;

create index if not exists documents_load_id_idx
  on public.documents(load_id)
  where load_id is not null;

create or replace function public.guard_load_document_scope()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_load public.loads;
  v_shipment public.shipments;
begin
  if new.load_id is null then
    return new;
  end if;

  select * into v_load
  from public.loads
  where id = new.load_id;

  if not found then
    raise exception 'LOAD_DOCUMENT_LOAD_NOT_FOUND';
  end if;

  if new.shipment_id is not null then
    if v_load.shipment_id is null or new.shipment_id <> v_load.shipment_id then
      raise exception 'LOAD_DOCUMENT_SHIPMENT_MISMATCH';
    end if;
  end if;

  if v_load.shipment_id is not null then
    select * into v_shipment
    from public.shipments
    where id = v_load.shipment_id;

    if new.operation_id is not null
       and v_shipment.operation_id is not null
       and new.operation_id <> v_shipment.operation_id then
      raise exception 'LOAD_DOCUMENT_OPERATION_MISMATCH';
    end if;

    if new.bol_number is not null
       and v_shipment.bol_number is not null
       and new.bol_number <> v_shipment.bol_number then
      raise exception 'LOAD_DOCUMENT_BOL_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

create trigger documents_guard_load_scope
before insert or update of load_id, shipment_id, operation_id, bol_number
on public.documents
for each row execute function public.guard_load_document_scope();

revoke all on function public.guard_load_document_scope() from public, anon, authenticated;

create or replace view public.load_expediente_documents
with (security_invoker = true)
as
select distinct on (x.load_id, x.document_id)
  x.load_id,
  x.document_id,
  x.scope,
  x.scope_priority,
  d.operation_id,
  d.client_id,
  d.shipment_id,
  d.load_id as document_load_id,
  d.bol_number,
  d.shared_bl,
  d.document_type,
  d.file_name,
  d.storage_bucket,
  d.storage_path,
  d.mime_type,
  d.file_size_bytes,
  d.version,
  d.notes,
  d.uploaded_by_admin_id,
  d.uploaded_by_username,
  d.created_at
from (
  -- Documento expresamente propio del cargue.
  select l.id as load_id, d.id as document_id, 'load'::text as scope, 1 as scope_priority
  from public.loads l
  join public.documents d on d.load_id = l.id

  union all

  -- Documento del contenedor asignado.
  select l.id, d.id, 'shipment'::text, 2
  from public.loads l
  join public.documents d on d.shipment_id = l.shipment_id
  where l.shipment_id is not null

  union all

  -- Documento general de la operación marítima/comercial del contenedor.
  select l.id, d.id, 'operation'::text, 4
  from public.loads l
  join public.shipments s on s.id = l.shipment_id
  join public.documents d on d.operation_id = s.operation_id
  where s.operation_id is not null
    and d.shipment_id is null
    and d.bol_number is null

  union all

  -- Documento por B/L del contenedor; incluye B/L compartidos sin copiar el archivo.
  select l.id, d.id, 'bol'::text, 3
  from public.loads l
  join public.shipments s on s.id = l.shipment_id
  join public.documents d on d.bol_number = s.bol_number
  where s.bol_number is not null
    and d.shipment_id is null
) x
join public.documents d on d.id = x.document_id
order by x.load_id, x.document_id, x.scope_priority;

comment on view public.load_expediente_documents is
  'Expediente documental efectivo de cada Cargue. Reutiliza documentos propios, del shipment, B/L y operación sin duplicarlos.';
