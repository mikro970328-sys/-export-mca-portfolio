-- P19: ShipsGo is retired from active runtime. Historical provider data is preserved.
-- Shipment WhatsApp delivery claims are now limited to DEPA and RELEASE.

create or replace function public.tracking_notification_delivery_key(p_event_status text)
returns text
language sql
immutable
set search_path to 'public','pg_temp'
as $$
  select case lower(btrim(coalesce(p_event_status,'')))
    when 'salió del puerto' then 'tracking:DEPA'
    when 'salio del puerto' then 'tracking:DEPA'
    when 'liberado' then 'tracking:RELEASE'
    else null
  end;
$$;

revoke all on function public.tracking_notification_delivery_key(text) from public, anon, authenticated, service_role;

create or replace function public.claim_notification_dispatch(
  p_shipment_id uuid,
  p_delivery_key text,
  p_event_status text,
  p_source text
)
returns boolean
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_id uuid;
  v_key text := btrim(coalesce(p_delivery_key,''));
begin
  if v_key='' then raise exception 'NOTIFICATION_DELIVERY_KEY_REQUIRED'; end if;
  if v_key not in ('tracking:DEPA','tracking:RELEASE') then
    raise exception 'NOTIFICATION_DELIVERY_KEY_NOT_ALLOWED';
  end if;
  if btrim(coalesce(p_event_status,''))='' then raise exception 'NOTIFICATION_EVENT_STATUS_REQUIRED'; end if;
  if btrim(coalesce(p_source,''))='' then raise exception 'NOTIFICATION_SOURCE_REQUIRED'; end if;

  insert into public.notification_dispatch_claims(shipment_id,event_status,source,delivery_key)
  values(p_shipment_id,btrim(p_event_status),btrim(p_source),v_key)
  on conflict(shipment_id,delivery_key) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

revoke all on function public.claim_notification_dispatch(uuid,text,text,text) from public, anon, authenticated;
grant execute on function public.claim_notification_dispatch(uuid,text,text,text) to service_role;

-- Close only active alert-condition cycles tied to the retired external tracking model.
-- The notification rows and condition history remain intact for auditability.
do $$
declare
  r record;
begin
  for r in
    select
      c.dedupe_key,c.event_type,c.client_id,c.shipment_id,c.entity_type,c.entity_id,
      coalesce(n.severity,'warning') as severity,
      coalesce(n.title,'Alerta operativa') as title,
      coalesce(n.message,'') as message,
      n.due_at,coalesce(n.payload,'{}'::jsonb) as payload
    from public.operational_alert_conditions c
    join public.notifications n on n.id=c.notification_id
    where c.condition_active=true
      and c.event_type in ('shipment_stale_tracking','tracking_stale','shipsgo_tracking_failed')
  loop
    perform public.reconcile_operational_alert_condition(
      r.dedupe_key,false,r.event_type,r.client_id,r.shipment_id,r.entity_type,r.entity_id,
      r.severity,r.title,r.message,r.due_at,r.payload,false,'external_tracking_retired',now()
    );
  end loop;
end;
$$;
