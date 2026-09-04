-- B10.2 · Aviso inmediato cuando un contenedor queda vinculado a un Cargue/Tracking.
-- Versión alineada con el historial aplicado en Supabase.
-- La notificación usa la categoría existente de cambios de tracking para respetar
-- las preferencias in-app y Web Push de cada usuario.

create or replace function public.notify_load_container_assignment(
  p_load_id uuid,
  p_shipment_id uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_load_number text;
  v_linked_shipment_id uuid;
  v_assignment_at timestamptz;
  v_container_number text;
  v_source_version text;
  v_created integer:=0;
begin
  select l.load_number,l.shipment_id,l.updated_at,s.container_number
    into v_load_number,v_linked_shipment_id,v_assignment_at,v_container_number
  from public.loads l
  join public.shipments s on s.id=p_shipment_id
  where l.id=p_load_id;

  if not found then raise exception 'LOAD_OR_SHIPMENT_NOT_FOUND'; end if;
  if v_linked_shipment_id is distinct from p_shipment_id then
    raise exception 'LOAD_SHIPMENT_NOTIFICATION_MISMATCH';
  end if;

  v_source_version:='container_assignment:'||p_shipment_id::text||':'||
    to_char(v_assignment_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"');

  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,
    target_type,target_id,title,message,severity,entity_type,entity_id,
    action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    u.id,'system',p_load_id,v_source_version,'tracking_status_changed',
    'permission',null,'Contenedor asignado a Tracking',
    'El contenedor '||v_container_number||' fue asignado al cargue '||v_load_number||
      ' y ya está disponible en Tracking.',
    'info','shipment',p_shipment_id,'open_work',
    jsonb_build_object(
      'entity_type','shipment','entity_id',p_shipment_id,
      'load_id',p_load_id,'load_number',v_load_number
    ),0,clock_timestamp(),clock_timestamp()
  from public.admin_users u
  left join public.notification_preferences pref on pref.admin_user_id=u.id
  where public.notification_user_eligible(u.id,array['logistics.read']::text[])
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.tracking_updates_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;

  get diagnostics v_created=row_count;
  return v_created;
end;
$$;

revoke all on function public.notify_load_container_assignment(uuid,uuid)
  from public,anon,authenticated,service_role;

create or replace function public.assign_load_shipment_canonical(p_load_id uuid,p_shipment_id uuid)
returns public.loads
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_load public.loads;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  perform public.assert_load_action(v_load.id,'assign_container');
  select * into v_load from public.assign_load_shipment(v_load.id,p_shipment_id);
  perform public.notify_load_container_assignment(v_load.id,p_shipment_id);
  return v_load;
end;
$$;

revoke all on function public.assign_load_shipment_canonical(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_load_shipment_canonical(uuid,uuid) to service_role;

create or replace function public.create_load_shipment_canonical(
  p_load_id uuid,
  p_container_number text,
  p_client_id uuid default null,
  p_importer_id uuid default null,
  p_booking_number text default null,
  p_bol_number text default null,
  p_carrier text default null,
  p_departure_date date default null
)
returns public.shipments
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_load public.loads;
  v_shipment public.shipments;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  perform public.assert_load_action(v_load.id,'create_container');
  select * into v_shipment from public.create_load_shipment(
    v_load.id,p_container_number,p_client_id,p_importer_id,p_booking_number,p_bol_number,p_carrier,p_departure_date
  );
  perform public.notify_load_container_assignment(v_load.id,v_shipment.id);
  return v_shipment;
end;
$$;

revoke all on function public.create_load_shipment_canonical(uuid,text,uuid,uuid,text,text,text,date)
  from public,anon,authenticated;
grant execute on function public.create_load_shipment_canonical(uuid,text,uuid,uuid,text,text,text,date)
  to service_role;

comment on function public.notify_load_container_assignment(uuid,uuid) is
  'Crea de forma idempotente el aviso personal de Tracking al vincular un contenedor con un Cargue.';
