-- P10 · Notificaciones por destinatario.
-- TASK y ALERT conservan su identidad; esta capa materializa entregas personales y estado de lectura.

create table public.notification_preferences (
  admin_user_id uuid primary key references public.admin_users(id) on delete cascade,
  in_app_enabled boolean not null default true,
  task_assignments_enabled boolean not null default true,
  operational_alerts_enabled boolean not null default true,
  escalations_enabled boolean not null default true,
  whatsapp_enabled boolean not null default false,
  whatsapp_recipient text,
  email_enabled boolean not null default false,
  email_recipient text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_preferences_whatsapp_format check (
    whatsapp_recipient is null or whatsapp_recipient ~ '^\+[1-9][0-9]{7,14}$'
  ),
  constraint notification_preferences_email_format check (
    email_recipient is null or email_recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  )
);

create table public.notification_inbox_items (
  id uuid primary key default gen_random_uuid(),
  recipient_admin_id uuid not null references public.admin_users(id) on delete restrict,
  source_type text not null,
  source_id uuid not null,
  source_version text not null,
  source_event_type text not null,
  target_type text not null,
  target_id uuid,
  title text not null,
  message text,
  severity text not null default 'info',
  entity_type text,
  entity_id uuid,
  action_key text not null default 'open_work',
  action_payload jsonb not null default '{}'::jsonb,
  escalation_level integer not null default 0,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_inbox_source_type_check check (source_type in ('task','alert','system')),
  constraint notification_inbox_target_type_check check (target_type in ('user','team','permission','system')),
  constraint notification_inbox_severity_check check (severity in ('info','warning','critical')),
  constraint notification_inbox_source_version_not_blank check (btrim(source_version)<>''),
  constraint notification_inbox_source_event_not_blank check (btrim(source_event_type)<>''),
  constraint notification_inbox_title_not_blank check (btrim(title)<>''),
  constraint notification_inbox_escalation_nonnegative check (escalation_level>=0),
  constraint notification_inbox_entity_pair check ((entity_type is null)=(entity_id is null)),
  constraint notification_inbox_target_pair check (
    (target_type='permission' and target_id is null)
    or (target_type='system' and target_id is null)
    or (target_type in ('user','team') and target_id is not null)
  ),
  constraint notification_inbox_semantic_unique unique (
    recipient_admin_id,source_type,source_id,source_version,escalation_level
  )
);

create index notification_inbox_recipient_unread_idx
  on public.notification_inbox_items(recipient_admin_id,created_at desc)
  where read_at is null and dismissed_at is null;
create index notification_inbox_recipient_created_idx
  on public.notification_inbox_items(recipient_admin_id,created_at desc);
create index notification_inbox_source_idx
  on public.notification_inbox_items(source_type,source_id,source_version);

-- Reserva el estado de entrega por canal externo sin mezclarlo con el inbox semántico.
-- P18 podrá activar proveedores; P10 no depende de un proveedor nuevo de email.
create table public.notification_channel_deliveries (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references public.notification_inbox_items(id) on delete restrict,
  channel text not null,
  recipient text not null,
  status text not null default 'pending',
  provider_message_id text,
  attempt_count integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint notification_channel_type_check check (channel in ('whatsapp','email')),
  constraint notification_channel_status_check check (status in ('pending','queued','sent','delivered','failed','suppressed')),
  constraint notification_channel_attempt_nonnegative check (attempt_count>=0),
  constraint notification_channel_unique unique(inbox_item_id,channel)
);

create index notification_channel_pending_idx
  on public.notification_channel_deliveries(channel,status,created_at)
  where status in ('pending','failed');

create or replace function public.notification_user_eligible(
  p_admin_user_id uuid,
  p_required_permissions text[] default '{}'::text[]
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.admin_users u
    where u.id=p_admin_user_id
      and u.is_active=true
      and (
        u.role='master_admin'
        or (
          exists (
            select 1 from public.admin_effective_permissions ep
            where ep.admin_user_id=u.id and ep.permission_key='notifications.read'
          )
          and not exists (
            select 1
            from unnest(coalesce(p_required_permissions,'{}'::text[])) required(permission_key)
            where not exists (
              select 1 from public.admin_effective_permissions ep2
              where ep2.admin_user_id=u.id and ep2.permission_key=required.permission_key
            )
          )
        )
      )
  );
$$;

create or replace function public.notification_task_recipients(p_task_id uuid)
returns table(admin_user_id uuid,target_type text,target_id uuid)
language sql
stable
security definer
set search_path=public
as $$
  with task_source as (
    select t.id,t.assigned_admin_id,t.assigned_team_id,
           coalesce(r.required_permissions,'{}'::text[]) as required_permissions
    from public.operational_tasks t
    left join public.workflow_task_routes r on r.workflow_key=t.workflow_key and r.enabled=true
    where t.id=p_task_id
  ), candidates as (
    select s.assigned_admin_id as admin_user_id,'user'::text as target_type,s.assigned_admin_id as target_id,0 as priority,
           s.required_permissions
    from task_source s
    where s.assigned_admin_id is not null
    union all
    select tm.admin_user_id,'team'::text,s.assigned_team_id,1,s.required_permissions
    from task_source s
    join public.teams t on t.id=s.assigned_team_id and t.is_active=true
    join public.team_memberships tm on tm.team_id=t.id
    where s.assigned_team_id is not null
  )
  select distinct on (c.admin_user_id)
         c.admin_user_id,c.target_type,c.target_id
  from candidates c
  where public.notification_user_eligible(c.admin_user_id,c.required_permissions)
  order by c.admin_user_id,c.priority;
$$;

create or replace function public.reconcile_user_notifications(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_task_count integer:=0;
  v_alert_count integer:=0;
  v_escalation_count integer:=0;
begin
  -- Tareas: una entrega por versión real de asignación y usuario elegible.
  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,
    target_type,target_id,title,message,severity,entity_type,entity_id,
    action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    r.admin_user_id,'task',t.id,
    to_char(t.assignment_state_changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'task_assignment',r.target_type,r.target_id,
    'Tarea asignada: '||t.title,
    coalesce(nullif(btrim(t.description),''),'Tienes trabajo operativo asignado en el ERP.'),
    case when t.priority='critical' then 'critical' when t.priority='high' then 'warning' else 'info' end,
    t.entity_type,t.entity_id,'open_work',
    jsonb_strip_nulls(jsonb_build_object(
      'task_id',t.id,'workflow_key',t.workflow_key,'entity_type',t.entity_type,'entity_id',t.entity_id
    )),
    0,p_now,p_now
  from public.operational_tasks t
  join lateral public.notification_task_recipients(t.id) r on true
  left join public.notification_preferences pref on pref.admin_user_id=r.admin_user_id
  where t.status in ('pending','in_progress','blocked')
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.task_assignments_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_task_count=row_count;

  -- Alertas P9: la identidad/ciclo pertenece a P9. P10 solo entrega ese ciclo a usuarios.
  with alert_sources as (
    select c.notification_id,c.event_type,c.entity_type,c.entity_id,c.condition_cycle_count,
           c.condition_opened_at,n.alert_status,n.severity,n.title,n.message,n.due_at,n.payload
    from public.operational_alert_conditions c
    join public.notifications n on n.id=c.notification_id
    where c.condition_active=true and n.alert_status='pending'
  ), task_alert_candidates as (
    select s.*,r.admin_user_id,r.target_type,r.target_id,0 as candidate_priority
    from alert_sources s
    join public.operational_tasks t on s.entity_type='operational_task' and t.id=s.entity_id
    join lateral public.notification_task_recipients(t.id) r on true
    where s.event_type in ('task_blocked','task_overdue')
  ), task_alert_fallback as (
    select s.*,u.id as admin_user_id,'permission'::text as target_type,null::uuid as target_id,2 as candidate_priority
    from alert_sources s
    join public.operational_tasks t on s.entity_type='operational_task' and t.id=s.entity_id
    cross join public.admin_users u
    where s.event_type in ('task_blocked','task_overdue')
      and public.notification_user_eligible(u.id,array['notifications.manage']::text[])
      and not exists (select 1 from public.notification_task_recipients(t.id))
  ), general_alert_candidates as (
    select s.*,u.id as admin_user_id,'permission'::text as target_type,null::uuid as target_id,2 as candidate_priority
    from alert_sources s
    cross join public.admin_users u
    where s.event_type not in ('task_blocked','task_overdue')
      and public.notification_user_eligible(u.id,array['notifications.manage']::text[])
  ), all_candidates as (
    select * from task_alert_candidates
    union all
    select * from task_alert_fallback
    union all
    select * from general_alert_candidates
  ), ranked as (
    select a.*,row_number() over(
      partition by a.notification_id,a.admin_user_id
      order by a.candidate_priority,a.target_type
    ) as rn
    from all_candidates a
  )
  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,
    target_type,target_id,title,message,severity,entity_type,entity_id,
    action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    r.admin_user_id,'alert',r.notification_id,r.condition_cycle_count::text,r.event_type,
    r.target_type,r.target_id,r.title,r.message,coalesce(r.severity,'warning'),r.entity_type,r.entity_id,
    'open_work',jsonb_strip_nulls(jsonb_build_object(
      'alert_notification_id',r.notification_id,'event_type',r.event_type,
      'entity_type',r.entity_type,'entity_id',r.entity_id
    )),0,p_now,p_now
  from ranked r
  left join public.notification_preferences pref on pref.admin_user_id=r.admin_user_id
  where r.rn=1
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.operational_alerts_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_alert_count=row_count;

  -- Escalación: task alerts críticas, vencidas o abiertas >=24h escalan una sola vez por ciclo.
  with sources as (
    select c.notification_id,c.event_type,c.entity_type,c.entity_id,c.condition_cycle_count,
           c.condition_opened_at,n.alert_status,n.severity,n.title,n.message,n.due_at
    from public.operational_alert_conditions c
    join public.notifications n on n.id=c.notification_id
    where c.condition_active=true
      and n.alert_status='pending'
      and c.event_type in ('task_blocked','task_overdue')
      and c.entity_type='operational_task'
      and (
        n.severity='critical'
        or n.due_at<=p_now
        or c.condition_opened_at<=p_now-interval '24 hours'
      )
  )
  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,
    target_type,target_id,title,message,severity,entity_type,entity_id,
    action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    u.id,'alert',s.notification_id,s.condition_cycle_count::text,s.event_type,
    'permission',null,'Escalación: '||s.title,s.message,coalesce(s.severity,'warning'),s.entity_type,s.entity_id,
    'open_work',jsonb_build_object(
      'alert_notification_id',s.notification_id,'event_type',s.event_type,
      'entity_type',s.entity_type,'entity_id',s.entity_id,'escalation',true
    ),1,p_now,p_now
  from sources s
  cross join public.admin_users u
  left join public.notification_preferences pref on pref.admin_user_id=u.id
  where public.notification_user_eligible(u.id,array['notifications.manage']::text[])
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.escalations_enabled,true)=true
    and not exists (
      select 1 from public.notification_inbox_items base
      where base.recipient_admin_id=u.id
        and base.source_type='alert'
        and base.source_id=s.notification_id
        and base.source_version=s.condition_cycle_count::text
        and base.escalation_level=0
    )
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_escalation_count=row_count;

  return jsonb_build_object(
    'task_notifications_created',v_task_count,
    'alert_notifications_created',v_alert_count,
    'escalations_created',v_escalation_count
  );
end;
$$;

create or replace view public.notification_inbox_workspace
with (security_invoker=true)
as
select
  i.*,
  case
    when i.source_type='task' then coalesce(t.status not in ('completed','cancelled'),false)
    when i.source_type='alert' then coalesce(c.condition_active and n.alert_status in ('pending','snoozed'),false)
    else true
  end as source_active,
  case
    when i.source_type='task' then t.status
    when i.source_type='alert' then n.alert_status
    else 'active'
  end as source_status,
  case when i.read_at is null and i.dismissed_at is null then true else false end as is_unread
from public.notification_inbox_items i
left join public.operational_tasks t on i.source_type='task' and t.id=i.source_id
left join public.operational_alert_conditions c on i.source_type='alert' and c.notification_id=i.source_id
left join public.notifications n on n.id=c.notification_id;

create or replace function public.act_on_notification_inbox(
  p_notification_id uuid,
  p_actor uuid,
  p_action text,
  p_now timestamptz default now()
)
returns table(notification_id uuid,read_at timestamptz,dismissed_at timestamptz)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_item public.notification_inbox_items%rowtype;
begin
  perform 1 from public.admin_users u where u.id=p_actor and u.is_active=true;
  if not found then raise exception 'NOTIFICATION_ACTOR_INVALID'; end if;

  select i.* into v_item
  from public.notification_inbox_items i
  where i.id=p_notification_id and i.recipient_admin_id=p_actor
  for update;
  if not found then raise exception 'NOTIFICATION_NOT_FOUND'; end if;

  if p_action='mark_read' then
    update public.notification_inbox_items i
    set read_at=coalesce(i.read_at,p_now),updated_at=p_now
    where i.id=p_notification_id;
  elsif p_action='mark_unread' then
    update public.notification_inbox_items i
    set read_at=null,dismissed_at=null,updated_at=p_now
    where i.id=p_notification_id;
  elsif p_action='dismiss' then
    update public.notification_inbox_items i
    set read_at=coalesce(i.read_at,p_now),dismissed_at=p_now,updated_at=p_now
    where i.id=p_notification_id;
  else
    raise exception 'NOTIFICATION_ACTION_INVALID';
  end if;

  return query
  select i.id,i.read_at,i.dismissed_at
  from public.notification_inbox_items i
  where i.id=p_notification_id;
end;
$$;

create or replace function public.mark_all_notification_inbox_read(
  p_actor uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer:=0;
begin
  perform 1 from public.admin_users u where u.id=p_actor and u.is_active=true;
  if not found then raise exception 'NOTIFICATION_ACTOR_INVALID'; end if;

  update public.notification_inbox_items i
  set read_at=p_now,updated_at=p_now
  where i.recipient_admin_id=p_actor and i.read_at is null and i.dismissed_at is null;
  get diagnostics v_count=row_count;
  return v_count;
end;
$$;

create or replace function public.set_notification_preferences(
  p_actor uuid,
  p_in_app_enabled boolean,
  p_task_assignments_enabled boolean,
  p_operational_alerts_enabled boolean,
  p_escalations_enabled boolean,
  p_whatsapp_enabled boolean,
  p_whatsapp_recipient text,
  p_email_enabled boolean,
  p_email_recipient text,
  p_now timestamptz default now()
)
returns public.notification_preferences
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result public.notification_preferences;
  v_phone text:=nullif(btrim(coalesce(p_whatsapp_recipient,'')),'');
  v_email text:=nullif(lower(btrim(coalesce(p_email_recipient,''))),'');
begin
  perform 1 from public.admin_users u where u.id=p_actor and u.is_active=true;
  if not found then raise exception 'NOTIFICATION_ACTOR_INVALID'; end if;
  if v_phone is not null and v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'NOTIFICATION_PHONE_INVALID'; end if;
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'NOTIFICATION_EMAIL_INVALID'; end if;
  if coalesce(p_whatsapp_enabled,false) and v_phone is null then raise exception 'NOTIFICATION_PHONE_REQUIRED'; end if;
  if coalesce(p_email_enabled,false) and v_email is null then raise exception 'NOTIFICATION_EMAIL_REQUIRED'; end if;

  insert into public.notification_preferences(
    admin_user_id,in_app_enabled,task_assignments_enabled,operational_alerts_enabled,escalations_enabled,
    whatsapp_enabled,whatsapp_recipient,email_enabled,email_recipient,created_at,updated_at
  ) values (
    p_actor,coalesce(p_in_app_enabled,true),coalesce(p_task_assignments_enabled,true),
    coalesce(p_operational_alerts_enabled,true),coalesce(p_escalations_enabled,true),
    coalesce(p_whatsapp_enabled,false),v_phone,coalesce(p_email_enabled,false),v_email,p_now,p_now
  )
  on conflict(admin_user_id) do update set
    in_app_enabled=excluded.in_app_enabled,
    task_assignments_enabled=excluded.task_assignments_enabled,
    operational_alerts_enabled=excluded.operational_alerts_enabled,
    escalations_enabled=excluded.escalations_enabled,
    whatsapp_enabled=excluded.whatsapp_enabled,
    whatsapp_recipient=excluded.whatsapp_recipient,
    email_enabled=excluded.email_enabled,
    email_recipient=excluded.email_recipient,
    updated_at=p_now
  returning * into v_result;

  return v_result;
end;
$$;

alter table public.notification_preferences enable row level security;
alter table public.notification_inbox_items enable row level security;
alter table public.notification_channel_deliveries enable row level security;

revoke all on public.notification_preferences from public,anon,authenticated;
revoke all on public.notification_inbox_items from public,anon,authenticated;
revoke all on public.notification_channel_deliveries from public,anon,authenticated;
revoke all on public.notification_inbox_workspace from public,anon,authenticated;

grant select,insert,update on public.notification_preferences to service_role;
grant select,insert,update on public.notification_inbox_items to service_role;
grant select,insert,update on public.notification_channel_deliveries to service_role;
grant select on public.notification_inbox_workspace to service_role;

revoke execute on function public.notification_user_eligible(uuid,text[]) from public,anon,authenticated;
revoke execute on function public.notification_task_recipients(uuid) from public,anon,authenticated;
revoke execute on function public.reconcile_user_notifications(timestamptz) from public,anon,authenticated;
revoke execute on function public.act_on_notification_inbox(uuid,uuid,text,timestamptz) from public,anon,authenticated;
revoke execute on function public.mark_all_notification_inbox_read(uuid,timestamptz) from public,anon,authenticated;
revoke execute on function public.set_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,text,boolean,text,timestamptz) from public,anon,authenticated;

grant execute on function public.notification_user_eligible(uuid,text[]) to service_role;
grant execute on function public.notification_task_recipients(uuid) to service_role;
grant execute on function public.reconcile_user_notifications(timestamptz) to service_role;
grant execute on function public.act_on_notification_inbox(uuid,uuid,text,timestamptz) to service_role;
grant execute on function public.mark_all_notification_inbox_read(uuid,timestamptz) to service_role;
grant execute on function public.set_notification_preferences(uuid,boolean,boolean,boolean,boolean,boolean,text,boolean,text,timestamptz) to service_role;
