-- P9 · Alertas operativas: identidad estable, condición separada y rearm explícito.

alter table public.notifications
  add column if not exists resolved_source text;

alter table public.notifications drop constraint if exists notifications_resolved_source_check;
alter table public.notifications add constraint notifications_resolved_source_check
  check (resolved_source is null or resolved_source in ('manual','condition','system'));

update public.notifications
set resolved_source=case
  when resolved_at is null then null
  when resolved_by is not null or lower(coalesce(resolved_reason,'')) in ('manual','revisada manualmente') then 'manual'
  else 'condition'
end
where notification_scope='operational' and resolved_source is null;

create table public.operational_alert_conditions (
  dedupe_key text primary key,
  notification_id uuid not null unique references public.notifications(id) on delete restrict,
  event_type text not null,
  entity_type text,
  entity_id uuid,
  client_id uuid references public.clients(id) on delete set null,
  shipment_id uuid references public.shipments(id) on delete set null,
  condition_active boolean not null default false,
  condition_opened_at timestamptz,
  condition_closed_at timestamptz,
  condition_cycle_count integer not null default 0,
  last_evaluated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_alert_conditions_dedupe_not_blank check (btrim(dedupe_key)<>''),
  constraint operational_alert_conditions_event_not_blank check (btrim(event_type)<>''),
  constraint operational_alert_conditions_entity_pair check ((entity_type is null)=(entity_id is null)),
  constraint operational_alert_conditions_cycle_nonnegative check (condition_cycle_count>=0),
  constraint operational_alert_conditions_time_consistency check (
    (condition_active and condition_opened_at is not null and condition_closed_at is null)
    or
    (not condition_active)
  )
);

create index operational_alert_conditions_event_idx on public.operational_alert_conditions(event_type,condition_active);
create index operational_alert_conditions_entity_idx on public.operational_alert_conditions(entity_type,entity_id) where entity_id is not null;
create index operational_alert_conditions_shipment_idx on public.operational_alert_conditions(shipment_id) where shipment_id is not null;
create index operational_alert_conditions_client_idx on public.operational_alert_conditions(client_id) where client_id is not null;

with ranked as (
  select
    n.*,
    row_number() over (
      partition by n.dedupe_key
      order by (n.resolved_at is null) desc,
               coalesce(n.last_triggered_at,n.updated_at,n.created_at) desc,
               n.created_at desc,
               n.id desc
    ) as rn
  from public.notifications n
  where n.notification_scope='operational' and n.dedupe_key is not null
), winners as (
  select * from ranked where rn=1
)
insert into public.operational_alert_conditions(
  dedupe_key,notification_id,event_type,entity_type,entity_id,client_id,shipment_id,
  condition_active,condition_opened_at,condition_closed_at,condition_cycle_count,
  last_evaluated_at,created_at,updated_at
)
select
  w.dedupe_key,w.id,coalesce(w.event_type,'operational_alert'),w.entity_type,w.entity_id,w.client_id,w.shipment_id,
  (w.resolved_at is null),
  case when w.resolved_at is null then coalesce(w.first_triggered_at,w.created_at) else null end,
  case when w.resolved_at is null then null else w.resolved_at end,
  greatest(1,coalesce(w.occurrence_count,1)),
  coalesce(w.updated_at,w.created_at),
  w.created_at,
  coalesce(w.updated_at,w.created_at)
from winners w;

-- Documentos Cuba es trabajo normal P5/P8; no debe seguir como alerta inmediata.
update public.notifications n
set alert_status='resolved',
    status='resolved',
    delivery_status='resolved',
    resolved_at=coalesce(n.resolved_at,now()),
    resolved_by=null,
    resolved_reason='superseded_by_task_workflow',
    resolved_source='system',
    snoozed_until=null,
    updated_at=now()
from public.operational_alert_conditions c
where c.notification_id=n.id
  and c.event_type='shipment_customs_documents_missing';

update public.operational_alert_conditions
set condition_active=false,
    condition_opened_at=null,
    condition_closed_at=coalesce(condition_closed_at,now()),
    last_evaluated_at=now(),
    updated_at=now()
where event_type='shipment_customs_documents_missing';

create or replace view public.operational_alert_condition_state
with (security_invoker=true)
as
select
  c.dedupe_key,
  c.notification_id,
  c.event_type,
  c.entity_type,
  c.entity_id,
  c.client_id,
  c.shipment_id,
  c.condition_active,
  c.condition_opened_at,
  c.condition_closed_at,
  c.condition_cycle_count,
  c.last_evaluated_at,
  c.created_at as condition_created_at,
  c.updated_at as condition_updated_at,
  n.event_status,
  n.status,
  n.delivery_status,
  n.alert_status,
  n.severity,
  n.title,
  n.message,
  n.due_at,
  n.first_triggered_at,
  n.last_triggered_at,
  n.occurrence_count,
  n.read_at,
  n.snoozed_until,
  n.resolved_at,
  n.resolved_by,
  n.resolved_reason,
  n.resolved_source,
  n.payload,
  n.created_at as notification_created_at,
  n.updated_at as notification_updated_at
from public.operational_alert_conditions c
join public.notifications n on n.id=c.notification_id;

alter table public.operational_alert_conditions enable row level security;
revoke all on public.operational_alert_conditions from public,anon,authenticated;
grant select,insert,update on public.operational_alert_conditions to service_role;
revoke all on public.operational_alert_condition_state from public,anon,authenticated;
grant select on public.operational_alert_condition_state to service_role;

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

  -- Refresh identity/context even when a manual resolution suppresses resurfacing.
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
        update public.notifications
        set alert_status='resolved',status='resolved',delivery_status='resolved',
            resolved_at=p_now,resolved_by=null,resolved_reason=coalesce(nullif(btrim(p_resolution_reason),''),'condition_cleared'),
            resolved_source='condition',snoozed_until=null,updated_at=p_now
        where id=v_notification.id;
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

    update public.notifications
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),alert_status='pending',status='pending',delivery_status='pending',
        resolved_at=null,resolved_by=null,resolved_reason=null,resolved_source=null,snoozed_until=null,read_at=null,
        last_triggered_at=p_now,occurrence_count=greatest(1,coalesce(occurrence_count,0))+1,updated_at=p_now
    where id=v_notification.id;
    v_action:='rearmed';
  elsif v_manual_resolved then
    update public.notifications
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),updated_at=p_now
    where id=v_notification.id;
    v_action:='suppressed_manual';
  elsif v_snoozed_future then
    update public.notifications
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),updated_at=p_now
    where id=v_notification.id;
    v_action:='snoozed';
  elsif coalesce(v_notification.alert_status,'pending')='snoozed' then
    update public.notifications
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),alert_status='pending',status='pending',delivery_status='pending',
        snoozed_until=null,read_at=null,last_triggered_at=p_now,
        occurrence_count=greatest(1,coalesce(occurrence_count,0))+1,updated_at=p_now
    where id=v_notification.id;
    v_action:='snooze_expired';
  elsif coalesce(v_notification.alert_status,'pending')='resolved' then
    -- Non-manual resolved + active condition is an inconsistent legacy state; reopen safely.
    update public.notifications
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),alert_status='pending',status='pending',delivery_status='pending',
        resolved_at=null,resolved_by=null,resolved_reason=null,resolved_source=null,snoozed_until=null,read_at=null,
        last_triggered_at=p_now,occurrence_count=greatest(1,coalesce(occurrence_count,0))+1,updated_at=p_now
    where id=v_notification.id;
    v_action:='recovered_inconsistent';
  else
    update public.notifications
    set client_id=p_client_id,shipment_id=p_shipment_id,event_type=p_event_type,event_status=p_severity,
        entity_type=p_entity_type,entity_id=p_entity_id,severity=p_severity,title=p_title,message=p_message,due_at=p_due_at,
        payload=coalesce(p_payload,'{}'::jsonb),
        last_triggered_at=case when p_trigger then p_now else last_triggered_at end,
        occurrence_count=case when p_trigger then greatest(1,coalesce(occurrence_count,0))+1 else occurrence_count end,
        read_at=case when p_trigger then null else read_at end,
        updated_at=p_now
    where id=v_notification.id;
    v_action:=case when p_trigger then 'triggered' else 'refreshed' end;
  end if;

  select * into v_notification from public.notifications where id=v_condition.notification_id;
  return query select v_notification.id,v_action,v_notification.alert_status,true,v_notification.occurrence_count;
end;
$$;

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

  select * into v_condition from public.operational_alert_conditions where notification_id=p_notification_id for update;
  if not found then raise exception 'ALERT_NOT_CANONICAL'; end if;
  select * into v_notification from public.notifications where id=p_notification_id for update;
  if not found then raise exception 'ALERT_NOT_FOUND'; end if;

  if p_action='mark_read' then
    update public.notifications set read_at=coalesce(read_at,p_now),updated_at=p_now where id=p_notification_id;
  elsif p_action='resolve' then
    update public.notifications
    set alert_status='resolved',status='resolved',delivery_status='resolved',resolved_at=p_now,resolved_by=p_actor,
        resolved_reason=coalesce(nullif(btrim(p_reason),''),'Revisada manualmente'),resolved_source='manual',snoozed_until=null,updated_at=p_now
    where id=p_notification_id;
  elsif p_action='snooze' then
    if not v_condition.condition_active then raise exception 'ALERT_CONDITION_CLOSED'; end if;
    if p_snoozed_until is null or p_snoozed_until<=p_now then raise exception 'ALERT_SNOOZE_INVALID'; end if;
    update public.notifications
    set alert_status='snoozed',status='pending',delivery_status='pending',snoozed_until=p_snoozed_until,
        resolved_at=null,resolved_by=null,resolved_reason=null,resolved_source=null,updated_at=p_now
    where id=p_notification_id;
  elsif p_action='reopen' then
    if not v_condition.condition_active then raise exception 'ALERT_CONDITION_CLOSED'; end if;
    update public.notifications
    set alert_status='pending',status='pending',delivery_status='pending',resolved_at=null,resolved_by=null,
        resolved_reason=null,resolved_source=null,snoozed_until=null,read_at=null,updated_at=p_now
    where id=p_notification_id;
  else
    raise exception 'ALERT_ACTION_INVALID';
  end if;

  select * into v_notification from public.notifications where id=p_notification_id;
  return query select v_notification.id,p_action,v_notification.alert_status,v_condition.condition_active;
end;
$$;

revoke execute on function public.reconcile_operational_alert_condition(text,boolean,text,uuid,uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean,text,timestamptz) from public,anon,authenticated;
revoke execute on function public.act_on_operational_alert(uuid,uuid,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.reconcile_operational_alert_condition(text,boolean,text,uuid,uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean,text,timestamptz) to service_role;
grant execute on function public.act_on_operational_alert(uuid,uuid,text,text,timestamptz,timestamptz) to service_role;
