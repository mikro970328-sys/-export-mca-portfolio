-- P9 · Corrección estructural del reconciliador: calificar columnas que colisionan con RETURNS TABLE.
-- occurrence_count es también un parámetro OUT implícito de la función; todas las referencias a la columna
-- de notifications se califican explícitamente para eliminar ambigüedad PL/pgSQL.

create or replace function public.reconcile_operational_alert_condition(
  p_dedupe_key text,
  p_condition_active boolean,
  p_event_type text,
  p_client_id uuid,
  p_shipment_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_severity text,
  p_title text,
  p_message text,
  p_due_at timestamptz,
  p_payload jsonb,
  p_trigger boolean default false,
  p_resolution_reason text default 'condition_cleared',
  p_now timestamptz default now()
)
returns table(notification_id uuid,action text,alert_status text,condition_active boolean,occurrence_count integer)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_condition public.operational_alert_conditions%rowtype;
  v_notification public.notifications%rowtype;
  v_notification_id uuid;
  v_action text:='noop';
  v_snoozed_future boolean:=false;
  v_manual_resolved boolean:=false;
begin
  if btrim(coalesce(p_dedupe_key,''))='' then raise exception 'ALERT_DEDUPE_REQUIRED'; end if;
  if btrim(coalesce(p_event_type,''))='' then raise exception 'ALERT_EVENT_TYPE_REQUIRED'; end if;
  if p_severity not in ('info','warning','critical') then raise exception 'ALERT_SEVERITY_INVALID'; end if;
  if (p_entity_type is null) <> (p_entity_id is null) then raise exception 'ALERT_ENTITY_PAIR_INVALID'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_dedupe_key,0));
  select * into v_condition from public.operational_alert_conditions where dedupe_key=p_dedupe_key for update;

  if not found then
    if not p_condition_active then
      return query select null::uuid,'noop'::text,null::text,false,0;
      return;
    end if;

    insert into public.notifications(
      client_id,shipment_id,event_type,event_status,channel,status,delivery_status,
      notification_scope,entity_type,entity_id,alert_status,severity,title,message,dedupe_key,due_at,
      first_triggered_at,last_triggered_at,occurrence_count,payload,attempt_count,last_attempt_at,
      resolved_source,updated_at
    ) values (
      p_client_id,p_shipment_id,p_event_type,p_severity,'internal','pending','pending',
      'operational',p_entity_type,p_entity_id,'pending',p_severity,p_title,p_message,p_dedupe_key,p_due_at,
      p_now,p_now,1,coalesce(p_payload,'{}'::jsonb),0,null,null,p_now
    ) returning id into v_notification_id;

    insert into public.operational_alert_conditions(
      dedupe_key,notification_id,event_type,entity_type,entity_id,client_id,shipment_id,
      condition_active,condition_opened_at,condition_closed_at,condition_cycle_count,last_evaluated_at,created_at,updated_at
    ) values (
      p_dedupe_key,v_notification_id,p_event_type,p_entity_type,p_entity_id,p_client_id,p_shipment_id,
      true,p_now,null,1,p_now,p_now,p_now
    );

    return query select v_notification_id,'created'::text,'pending'::text,true,1;
    return;
  end if;

  select * into v_notification from public.notifications where id=v_condition.notification_id for update;
  if not found then raise exception 'ALERT_CANONICAL_NOTIFICATION_MISSING'; end if;

  update public.operational_alert_conditions
  set event_type=p_event_type,entity_type=p_entity_type,entity_id=p_entity_id,
      client_id=p_client_id,shipment_id=p_shipment_id,last_evaluated_at=p_now,updated_at=p_now
  where dedupe_key=p_dedupe_key;

  if not p_condition_active then
    if v_condition.condition_active then
      update public.operational_alert_conditions
      set condition_active=false,condition_opened_at=null,condition_closed_at=p_now,last_evaluated_at=p_now,updated_at=p_now
      where dedupe_key=p_dedupe_key;

      if coalesce(v_notification.alert_status,'pending') in ('pending','snoozed') then
        update public.notifications n
        set alert_status='resolved',status='resolved',delivery_status='resolved',
            resolved_at=p_now,resolved_by=null,resolved_reason=coalesce(nullif(btrim(p_resolution_reason),''),'condition_cleared'),
            resolved_source='condition',snoozed_until=null,updated_at=p_now
        where n.id=v_notification.id;
        v_action:='auto_resolved';
      else
        v_action:='condition_closed';
      end if;
    end if;

    select * into v_notification from public.notifications where id=v_condition.notification_id;
    return query select v_notification.id,v_action,v_notification.alert_status,false,v_notification.occurrence_count;
    return;
  end if;

  v_snoozed_future := coalesce(v_notification.alert_status,'pending')='snoozed'
    and v_notification.snoozed_until is not null and v_notification.snoozed_until>p_now;
  v_manual_resolved := coalesce(v_notification.alert_status,'pending')='resolved'
    and (v_notification.resolved_source='manual' or v_notification.resolved_by is not null or lower(coalesce(v_notification.resolved_reason,''))='manual');

  if not v_condition.condition_active then
    update public.operational_alert_conditions
    set condition_active=true,condition_opened_at=p_now,condition_closed_at=null,
        condition_cycle_count=condition_cycle_count+1,last_evaluated_at=p_now,updated_at=p_now
    where dedupe_key=p_dedupe_key;

    update public.notifications n
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),alert_status='pending',status='pending',delivery_status='pending',
        resolved_at=null,resolved_by=null,resolved_reason=null,resolved_source=null,snoozed_until=null,read_at=null,
        last_triggered_at=p_now,occurrence_count=greatest(1,coalesce(n.occurrence_count,0))+1,updated_at=p_now
    where n.id=v_notification.id;
    v_action:='rearmed';
  elsif v_manual_resolved then
    update public.notifications n
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),updated_at=p_now
    where n.id=v_notification.id;
    v_action:='suppressed_manual';
  elsif v_snoozed_future then
    update public.notifications n
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),updated_at=p_now
    where n.id=v_notification.id;
    v_action:='snoozed';
  elsif coalesce(v_notification.alert_status,'pending')='snoozed' then
    update public.notifications n
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),alert_status='pending',status='pending',delivery_status='pending',
        snoozed_until=null,read_at=null,last_triggered_at=p_now,
        occurrence_count=greatest(1,coalesce(n.occurrence_count,0))+1,updated_at=p_now
    where n.id=v_notification.id;
    v_action:='snooze_expired';
  elsif coalesce(v_notification.alert_status,'pending')='resolved' then
    update public.notifications n
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),alert_status='pending',status='pending',delivery_status='pending',
        resolved_at=null,resolved_by=null,resolved_reason=null,resolved_source=null,snoozed_until=null,read_at=null,
        last_triggered_at=p_now,occurrence_count=greatest(1,coalesce(n.occurrence_count,0))+1,updated_at=p_now
    where n.id=v_notification.id;
    v_action:='recovered_inconsistent';
  else
    update public.notifications n
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),
        last_triggered_at=case when p_trigger then p_now else n.last_triggered_at end,
        occurrence_count=case when p_trigger then greatest(1,coalesce(n.occurrence_count,0))+1 else n.occurrence_count end,
        read_at=case when p_trigger then null else n.read_at end,
        updated_at=p_now
    where n.id=v_notification.id;
    v_action:=case when p_trigger then 'triggered' else 'refreshed' end;
  end if;

  select * into v_notification from public.notifications where id=v_condition.notification_id;
  return query select v_notification.id,v_action,v_notification.alert_status,true,v_notification.occurrence_count;
end;
$$;

revoke execute on function public.reconcile_operational_alert_condition(text,boolean,text,uuid,uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_operational_alert_condition(text,boolean,text,uuid,uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean,text,timestamptz) to service_role;
