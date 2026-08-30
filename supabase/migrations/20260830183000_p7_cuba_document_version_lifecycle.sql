-- P7 · Documentación Cuba: versión vigente, histórico y eliminación lógica.

alter table public.documents
  add column if not exists superseded_at timestamptz,
  add column if not exists superseded_by_document_id uuid references public.documents(id) on delete set null,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by_admin_id uuid references public.admin_users(id) on delete set null,
  add column if not exists deleted_by_username text;

create index if not exists documents_superseded_by_document_id_idx
  on public.documents(superseded_by_document_id)
  where superseded_by_document_id is not null;
create index if not exists documents_deleted_by_admin_id_idx
  on public.documents(deleted_by_admin_id)
  where deleted_by_admin_id is not null;
create index if not exists documents_shipment_type_version_idx
  on public.documents(shipment_id,document_type,version desc)
  where shipment_id is not null;

create or replace function public.canonical_cuba_document_type(p_document_type text)
returns text
language sql
immutable
set search_path=public
as $$
  select case lower(btrim(coalesce(p_document_type,'')))
    when 'packing list cuba' then 'Packing List Cuba'
    when 'commercial invoice cuba' then 'Commercial Invoice Cuba'
    when 'factura comercial cuba' then 'Commercial Invoice Cuba'
    else null
  end;
$$;

-- Si otra instalación ya tenía varias versiones, solo la más nueva queda vigente.
with ranked as (
  select d.id,
    first_value(d.id) over (
      partition by d.shipment_id,public.canonical_cuba_document_type(d.document_type)
      order by d.version desc,d.created_at desc,d.id desc
    ) as current_id,
    row_number() over (
      partition by d.shipment_id,public.canonical_cuba_document_type(d.document_type)
      order by d.version desc,d.created_at desc,d.id desc
    ) as rn
  from public.documents d
  where d.shipment_id is not null
    and d.generated=false
    and d.deleted_at is null
    and d.superseded_at is null
    and public.canonical_cuba_document_type(d.document_type) is not null
)
update public.documents d
set superseded_at=now(),superseded_by_document_id=r.current_id
from ranked r
where d.id=r.id and r.rn>1;

create unique index if not exists documents_one_current_cuba_type_idx
  on public.documents(shipment_id,public.canonical_cuba_document_type(document_type))
  where shipment_id is not null
    and generated=false
    and deleted_at is null
    and superseded_at is null
    and public.canonical_cuba_document_type(document_type) is not null;

create or replace view public.shipment_customs_document_readiness
with (security_invoker=true)
as
with load_state as (
  select l.shipment_id,bool_or(l.status='dispatched') as has_dispatched_load
  from public.loads l
  where l.shipment_id is not null
  group by l.shipment_id
), direct_state as (
  select d.shipment_id,true as has_direct_dispatch
  from public.direct_shipment_dispatches d
), document_state as (
  select d.shipment_id,
    bool_or(
      d.generated=false and d.deleted_at is null and d.superseded_at is null
      and public.canonical_cuba_document_type(d.document_type)='Packing List Cuba'
    ) as has_packing_list_cuba,
    bool_or(
      d.generated=false and d.deleted_at is null and d.superseded_at is null
      and public.canonical_cuba_document_type(d.document_type)='Commercial Invoice Cuba'
    ) as has_commercial_invoice_cuba,
    count(*) filter (where d.generated=false) as manual_document_count,
    count(*) filter (
      where d.generated=false and d.deleted_at is null and d.superseded_at is null
        and public.canonical_cuba_document_type(d.document_type) is not null
    ) as current_official_document_count
  from public.documents d
  where d.shipment_id is not null
  group by d.shipment_id
), base as (
  select s.id as shipment_id,s.container_number,s.client_id,s.active,s.operational_status,s.last_status,s.departure_date,s.delivered_at,
    coalesce(ls.has_dispatched_load,false)
      or coalesce(ds.has_direct_dispatch,false)
      or s.departure_date is not null
      or s.delivered_at is not null
      or s.active=false as documentation_required,
    coalesce(docs.has_packing_list_cuba,false) as has_packing_list_cuba,
    coalesce(docs.has_commercial_invoice_cuba,false) as has_commercial_invoice_cuba,
    coalesce(docs.manual_document_count,0) as manual_document_count,
    coalesce(docs.current_official_document_count,0) as current_official_document_count
  from public.shipments s
  left join load_state ls on ls.shipment_id=s.id
  left join direct_state ds on ds.shipment_id=s.id
  left join document_state docs on docs.shipment_id=s.id
)
select shipment_id,container_number,client_id,active,operational_status,last_status,departure_date,delivered_at,
  documentation_required,has_packing_list_cuba,has_commercial_invoice_cuba,manual_document_count,
  case
    when not documentation_required then 'not_required'
    when has_packing_list_cuba and has_commercial_invoice_cuba then 'ready'
    else 'pending'
  end as document_status,
  case
    when not documentation_required then array[]::text[]
    else array_remove(array[
      case when not has_packing_list_cuba then 'Packing List Cuba' end,
      case when not has_commercial_invoice_cuba then 'Commercial Invoice Cuba' end
    ],null)
  end as missing_documents,
  current_official_document_count
from base;

revoke all on public.shipment_customs_document_readiness from public,anon,authenticated;
grant select on public.shipment_customs_document_readiness to service_role;

create or replace function public.create_shipment_customs_document(
  p_shipment_id uuid,
  p_client_id uuid,
  p_document_type text,
  p_file_name text,
  p_storage_bucket text,
  p_storage_path text,
  p_mime_type text,
  p_file_size_bytes bigint,
  p_notes text,
  p_uploaded_by_admin_id uuid,
  p_uploaded_by_username text
)
returns table(document_id uuid,document_version integer)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_type text;
  v_id uuid:=gen_random_uuid();
  v_version integer;
begin
  v_type:=public.canonical_cuba_document_type(p_document_type);
  if v_type is null then raise exception 'CUBA_DOCUMENT_TYPE_INVALID'; end if;
  if p_shipment_id is null then raise exception 'CUBA_DOCUMENT_SHIPMENT_REQUIRED'; end if;
  if btrim(coalesce(p_file_name,''))='' then raise exception 'CUBA_DOCUMENT_FILE_REQUIRED'; end if;
  if btrim(coalesce(p_storage_bucket,''))='' or btrim(coalesce(p_storage_path,''))='' then raise exception 'CUBA_DOCUMENT_STORAGE_REQUIRED'; end if;

  perform 1 from public.shipments where id=p_shipment_id for update;
  if not found then raise exception 'CUBA_DOCUMENT_SHIPMENT_NOT_FOUND'; end if;

  select coalesce(max(d.version),0)+1 into v_version
  from public.documents d
  where d.shipment_id=p_shipment_id
    and d.generated=false
    and public.canonical_cuba_document_type(d.document_type)=v_type;

  update public.documents d
  set superseded_at=now(),superseded_by_document_id=v_id
  where d.shipment_id=p_shipment_id
    and d.generated=false
    and d.deleted_at is null
    and d.superseded_at is null
    and public.canonical_cuba_document_type(d.document_type)=v_type;

  insert into public.documents(
    id,operation_id,client_id,shipment_id,load_id,bol_number,shared_bl,
    document_type,file_name,storage_bucket,storage_path,mime_type,file_size_bytes,version,notes,
    generated,source_type,source_id,content_sha256,generated_at,
    uploaded_by_admin_id,uploaded_by_username,
    superseded_at,superseded_by_document_id,deleted_at,deleted_by_admin_id,deleted_by_username
  ) values (
    v_id,null,p_client_id,p_shipment_id,null,null,false,
    v_type,p_file_name,p_storage_bucket,p_storage_path,p_mime_type,p_file_size_bytes,v_version,p_notes,
    false,null,null,null,null,
    p_uploaded_by_admin_id,p_uploaded_by_username,
    null,null,null,null,null
  );

  return query select v_id,v_version;
end;
$$;

create or replace function public.soft_delete_shipment_customs_document(
  p_document_id uuid,
  p_deleted_by_admin_id uuid,
  p_deleted_by_username text
)
returns table(
  document_id uuid,
  shipment_id uuid,
  document_type text,
  file_name text,
  storage_bucket text,
  storage_path text,
  document_version integer
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.documents%rowtype;
begin
  select * into v from public.documents where id=p_document_id for update;
  if not found or v.shipment_id is null then raise exception 'CUBA_DOCUMENT_NOT_FOUND'; end if;
  if v.generated then raise exception 'CUBA_DOCUMENT_GENERATED_DELETE_FORBIDDEN'; end if;
  if public.canonical_cuba_document_type(v.document_type) is null then raise exception 'CUBA_DOCUMENT_TYPE_INVALID'; end if;
  if v.deleted_at is not null then raise exception 'CUBA_DOCUMENT_ALREADY_DELETED'; end if;
  if v.superseded_at is not null then raise exception 'CUBA_DOCUMENT_HISTORICAL_DELETE_FORBIDDEN'; end if;

  update public.documents
  set deleted_at=now(),deleted_by_admin_id=p_deleted_by_admin_id,deleted_by_username=p_deleted_by_username
  where id=v.id;

  return query select v.id,v.shipment_id,public.canonical_cuba_document_type(v.document_type),v.file_name,v.storage_bucket,v.storage_path,v.version;
end;
$$;

revoke execute on function public.create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text) from public,anon,authenticated;
revoke execute on function public.soft_delete_shipment_customs_document(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text) to service_role;
grant execute on function public.soft_delete_shipment_customs_document(uuid,uuid,text) to service_role;
