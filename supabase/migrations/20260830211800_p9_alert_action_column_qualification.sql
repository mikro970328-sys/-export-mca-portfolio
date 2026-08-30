-- P9 · Corrección estructural del RPC de acciones: calificar notification_id frente al OUT parameter homónimo.

create or replace function public.act_on_operational_alert(
  p_notification_id uuid,
  p_actor uuid,
  p_action text,
  p_reason text default null,
  p_snoozed_until timestamptz default null,
  p_now timestamptz default now()
)
returns table(notification_id uuid,action text,alert_status text,condition_active boolean)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_condition public.operational_alert_conditions%rowtype;
  v_notification public.notifications%rowtype;
  v_username text;
begin
  select username into v_username from public.admin_users where id=p_actor and is_active=true;
  if not found then raise exception 'ALERT_ACTOR_INVALID'; end if;

  select c.* into v_condition
  from public.operational_alert_conditions c
  where c.notification_id=p_notification_id
  for update;
  if not found then raise exception 'ALERT_NOT_CANONICAL'; end if;

  select n.* into v_notification
  from public.notifications n
  where n.id=p_notification_id
  for update;
  if not found then raise exception 'ALERT_NOT_FOUND'; end if;

  if p_action='mark_read' then
    update public.notifications n set read_at=coalesce(n.read_at,p_now),updated_at=p_now where n.id=p_notification_id;
  elsif p_action='resolve' then
    update public.notifications n
    set alert_status='resolved',status='resolved',delivery_status='resolved',resolved_at=p_now,resolved_by=p_actor,
        resolved_reason=coalesce(nullif(btrim(p_reason),''),'Revisada manualmente'),resolved_source='manual',snoozed_until=null,updated_at=p_now
    where n.id=p_notification_id;
  elsif p_action='snooze' then
    if not v_condition.condition_active then raise exception 'ALERT_CONDITION_CLOSED'; end if;
    if p_snoozed_until is null or p_snoozed_until<=p_now then raise exception 'ALERT_SNOOZE_INVALID'; end if;
    update public.notifications n
    set alert_status='snoozed',status='pending',delivery_status='pending',snoozed_until=p_snoozed_until,
        resolved_at=null,resolved_by=null,resolved_reason=null,resolved_source=null,updated_at=p_now
    where n.id=p_notification_id;
  elsif p_action='reopen' then
    if not v_condition.condition_active then raise exception 'ALERT_CONDITION_CLOSED'; end if;
    update public.notifications n
    set alert_status='pending',status='pending',delivery_status='pending',resolved_at=null,resolved_by=null,
        resolved_reason=null,resolved_source=null,snoozed_until=null,read_at=null,updated_at=p_now
    where n.id=p_notification_id;
  else
    raise exception 'ALERT_ACTION_INVALID';
  end if;

  select n.* into v_notification from public.notifications n where n.id=p_notification_id;
  return query select v_notification.id,p_action,v_notification.alert_status,v_condition.condition_active;
end;
$$;

revoke execute on function public.act_on_operational_alert(uuid,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.act_on_operational_alert(uuid,uuid,text,text,timestamptz,timestamptz) to service_role;
