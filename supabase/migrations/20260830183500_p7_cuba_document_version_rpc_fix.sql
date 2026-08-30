-- P7 · Corrección incremental: la versión anterior se marca sustituida antes de insertar la nueva,
-- y el FK superseded_by_document_id se enlaza después de que exista la nueva fila.

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
  set superseded_at=now(),superseded_by_document_id=null
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

  update public.documents d
  set superseded_by_document_id=v_id
  where d.shipment_id=p_shipment_id
    and d.generated=false
    and d.deleted_at is null
    and d.superseded_at is not null
    and d.superseded_by_document_id is null
    and d.id<>v_id
    and public.canonical_cuba_document_type(d.document_type)=v_type;

  return query select v_id,v_version;
end;
$$;

revoke execute on function public.create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text) from public,anon,authenticated;
grant execute on function public.create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text) to service_role;
