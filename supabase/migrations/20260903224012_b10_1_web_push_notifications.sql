-- B10.1 · Web Push PWA seguro por usuario, dispositivo y sesión.
-- El inbox P10 conserva la identidad del evento. Esta capa solo administra opt-in,
-- dispositivos y entrega sin copiar payloads sensibles a la cola ni a auditoría.

alter table public.notification_preferences
  add column if not exists push_enabled boolean not null default false,
  add column if not exists tracking_updates_enabled boolean not null default true,
  add column if not exists document_updates_enabled boolean not null default true,
  add column if not exists integration_failures_enabled boolean not null default true;

create table public.web_push_runtime_state (
  singleton boolean primary key default true,
  source_epoch timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint web_push_runtime_singleton_check check (singleton=true)
);

insert into public.web_push_runtime_state(singleton)
values(true)
on conflict(singleton) do nothing;

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  endpoint text not null,
  endpoint_hash text not null,
  p256dh text not null,
  auth_secret text not null,
  expiration_time timestamptz,
  device_label text not null,
  user_agent text,
  session_version integer not null,
  status text not null default 'active',
  activated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_delivery_at timestamptz,
  revoked_at timestamptz,
  failure_count integer not null default 0,
  last_error_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_https_check check (
    length(endpoint) between 12 and 4096 and endpoint ~ '^https://[^[:space:]]+$'
  ),
  constraint push_subscriptions_endpoint_hash_check check (endpoint_hash ~ '^[0-9a-f]{64}$'),
  constraint push_subscriptions_p256dh_check check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  constraint push_subscriptions_auth_check check (auth_secret ~ '^[A-Za-z0-9_-]{22}$'),
  constraint push_subscriptions_device_label_check check (length(btrim(device_label)) between 1 and 80),
  constraint push_subscriptions_session_version_check check (session_version>=1),
  constraint push_subscriptions_status_check check (status in ('active','revoked','expired')),
  constraint push_subscriptions_failure_count_check check (failure_count>=0),
  constraint push_subscriptions_error_code_check check (
    last_error_code is null or (length(last_error_code)<=80 and last_error_code ~ '^[a-z0-9_.:-]+$')
  ),
  constraint push_subscriptions_endpoint_unique unique(endpoint_hash)
);

create index push_subscriptions_admin_status_idx
  on public.push_subscriptions(admin_user_id,status,activated_at desc);

create table public.push_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  inbox_item_id uuid not null references public.notification_inbox_items(id) on delete restrict,
  subscription_id uuid not null references public.push_subscriptions(id) on delete restrict,
  recipient_admin_id uuid not null references public.admin_users(id) on delete restrict,
  status text not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  lease_token uuid,
  lease_expires_at timestamptz,
  provider_status_code integer,
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_delivery_status_check check (
    status in ('pending','processing','retry','sent','failed','expired','suppressed')
  ),
  constraint push_delivery_attempt_count_check check (attempt_count>=0),
  constraint push_delivery_status_code_check check (
    provider_status_code is null or provider_status_code between 100 and 599
  ),
  constraint push_delivery_error_code_check check (
    last_error_code is null or (length(last_error_code)<=80 and last_error_code ~ '^[a-z0-9_.:-]+$')
  ),
  constraint push_delivery_recipient_match_unique unique(inbox_item_id,subscription_id)
);

create index push_delivery_due_idx
  on public.push_delivery_queue(next_attempt_at,created_at)
  where status in ('pending','retry','processing');
create index push_delivery_subscription_active_idx
  on public.push_delivery_queue(subscription_id,status,created_at);
create index push_delivery_processing_lease_idx
  on public.push_delivery_queue(lease_expires_at)
  where status='processing';
create index push_delivery_recipient_idx
  on public.push_delivery_queue(recipient_admin_id,created_at desc);

create index if not exists shipments_push_last_event_idx
  on public.shipments(last_event_at,id)
  where last_event_at is not null;
create index if not exists documents_push_available_idx
  on public.documents(created_at,id)
  where deleted_at is null and superseded_at is null;
create index if not exists notifications_push_failure_idx
  on public.notifications(updated_at,id)
  where notification_scope='message'
    and (lower(coalesce(delivery_status,'')) in ('failed','undelivered')
      or lower(coalesce(status,'')) in ('failed','undelivered'));
create index if not exists webhook_events_push_failure_idx
  on public.webhook_events(created_at,id)
  where processed=false and error_message is not null;

create or replace view public.push_subscription_workspace
with (security_invoker=true)
as
select
  s.id,
  s.admin_user_id,
  s.device_label,
  s.user_agent,
  s.expiration_time,
  s.status,
  s.activated_at,
  s.last_seen_at,
  s.last_delivery_at,
  s.revoked_at,
  s.failure_count,
  s.last_error_code,
  s.created_at,
  s.updated_at,
  (s.status='active' and s.session_version=u.session_version and u.is_active=true) as session_valid
from public.push_subscriptions s
join public.admin_users u on u.id=s.admin_user_id;

create or replace function public.set_notification_preferences_v2(
  p_actor uuid,
  p_in_app_enabled boolean,
  p_task_assignments_enabled boolean,
  p_operational_alerts_enabled boolean,
  p_escalations_enabled boolean,
  p_whatsapp_enabled boolean,
  p_whatsapp_recipient text,
  p_email_enabled boolean,
  p_email_recipient text,
  p_push_enabled boolean,
  p_tracking_updates_enabled boolean,
  p_document_updates_enabled boolean,
  p_integration_failures_enabled boolean,
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
  if coalesce(p_push_enabled,false) and not exists (
    select 1 from public.push_subscriptions s
    join public.admin_users u on u.id=s.admin_user_id
    where s.admin_user_id=p_actor and s.status='active'
      and s.session_version=u.session_version and u.is_active=true
  ) then
    raise exception 'PUSH_ACTIVE_DEVICE_REQUIRED';
  end if;

  insert into public.notification_preferences(
    admin_user_id,in_app_enabled,task_assignments_enabled,operational_alerts_enabled,escalations_enabled,
    whatsapp_enabled,whatsapp_recipient,email_enabled,email_recipient,push_enabled,
    tracking_updates_enabled,document_updates_enabled,integration_failures_enabled,created_at,updated_at
  ) values (
    p_actor,coalesce(p_in_app_enabled,true),coalesce(p_task_assignments_enabled,true),
    coalesce(p_operational_alerts_enabled,true),coalesce(p_escalations_enabled,true),
    coalesce(p_whatsapp_enabled,false),v_phone,coalesce(p_email_enabled,false),v_email,
    coalesce(p_push_enabled,false),coalesce(p_tracking_updates_enabled,true),
    coalesce(p_document_updates_enabled,true),coalesce(p_integration_failures_enabled,true),p_now,p_now
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
    push_enabled=excluded.push_enabled,
    tracking_updates_enabled=excluded.tracking_updates_enabled,
    document_updates_enabled=excluded.document_updates_enabled,
    integration_failures_enabled=excluded.integration_failures_enabled,
    updated_at=p_now
  returning * into v_result;

  if not v_result.push_enabled then
    update public.push_delivery_queue q
    set status='suppressed',lease_token=null,lease_expires_at=null,updated_at=p_now
    where q.recipient_admin_id=p_actor and q.status in ('pending','retry','processing');
  end if;

  return v_result;
end;
$$;

create or replace function public.upsert_push_subscription(
  p_actor uuid,
  p_session_version integer,
  p_endpoint text,
  p_p256dh text,
  p_auth_secret text,
  p_expiration_time timestamptz,
  p_device_label text,
  p_user_agent text,
  p_now timestamptz default now()
)
returns table(subscription_id uuid,subscription_status text,subscription_activated_at timestamptz)
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_username text;
  v_current_session integer;
  v_endpoint text:=btrim(coalesce(p_endpoint,''));
  v_hash text;
  v_label text:=left(coalesce(nullif(btrim(p_device_label),''),'Este dispositivo'),80);
  v_previous_admin uuid;
  v_result public.push_subscriptions%rowtype;
begin
  select u.username,u.session_version into v_username,v_current_session
  from public.admin_users u
  where u.id=p_actor and u.is_active=true;
  if not found then raise exception 'PUSH_ACTOR_INVALID'; end if;
  if p_session_version is null or p_session_version<>v_current_session then raise exception 'PUSH_SESSION_INVALID'; end if;
  if length(v_endpoint) not between 12 and 4096 or v_endpoint !~ '^https://[^[:space:]]+$' then raise exception 'PUSH_ENDPOINT_INVALID'; end if;
  if coalesce(p_p256dh,'') !~ '^[A-Za-z0-9_-]{87}$' then raise exception 'PUSH_P256DH_INVALID'; end if;
  if coalesce(p_auth_secret,'') !~ '^[A-Za-z0-9_-]{22}$' then raise exception 'PUSH_AUTH_INVALID'; end if;
  if p_expiration_time is not null and p_expiration_time<=p_now then raise exception 'PUSH_SUBSCRIPTION_EXPIRED'; end if;

  v_hash:=encode(digest(v_endpoint,'sha256'),'hex');
  select s.admin_user_id into v_previous_admin
  from public.push_subscriptions s where s.endpoint_hash=v_hash;

  insert into public.push_subscriptions(
    admin_user_id,endpoint,endpoint_hash,p256dh,auth_secret,expiration_time,device_label,user_agent,
    session_version,status,activated_at,last_seen_at,revoked_at,failure_count,last_error_code,created_at,updated_at
  ) values (
    p_actor,v_endpoint,v_hash,p_p256dh,p_auth_secret,p_expiration_time,v_label,
    left(nullif(btrim(coalesce(p_user_agent,'')),''),512),p_session_version,'active',p_now,p_now,null,0,null,p_now,p_now
  )
  on conflict(endpoint_hash) do update set
    admin_user_id=excluded.admin_user_id,
    endpoint=excluded.endpoint,
    p256dh=excluded.p256dh,
    auth_secret=excluded.auth_secret,
    expiration_time=excluded.expiration_time,
    device_label=excluded.device_label,
    user_agent=excluded.user_agent,
    session_version=excluded.session_version,
    status='active',
    activated_at=p_now,
    last_seen_at=p_now,
    revoked_at=null,
    failure_count=0,
    last_error_code=null,
    updated_at=p_now
  returning * into v_result;

  insert into public.notification_preferences(admin_user_id,push_enabled,created_at,updated_at)
  values(p_actor,true,p_now,p_now)
  on conflict(admin_user_id) do update set push_enabled=true,updated_at=p_now;

  if v_previous_admin is not null and v_previous_admin<>p_actor then
    update public.push_delivery_queue q
    set status='suppressed',lease_token=null,lease_expires_at=null,last_error_code='subscription_transferred',updated_at=p_now
    where q.subscription_id=v_result.id and q.status in ('pending','retry','processing');
    update public.notification_preferences pref
    set push_enabled=false,updated_at=p_now
    where pref.admin_user_id=v_previous_admin
      and not exists (
        select 1 from public.push_subscriptions other
        where other.admin_user_id=v_previous_admin and other.status='active'
      );
    insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
    values(null,'Sistema','push.subscription.transferred','push_subscription',v_result.id,
      jsonb_build_object('previous_admin_id',v_previous_admin,'current_admin_id',p_actor));
  end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,v_username,'push.subscription.activated','push_subscription',v_result.id,
    jsonb_build_object('device_label',v_label,'session_version',p_session_version));

  return query select v_result.id,v_result.status,v_result.activated_at;
end;
$$;

create or replace function public.deactivate_push_subscription(
  p_actor uuid,
  p_session_version integer,
  p_subscription_id uuid default null,
  p_endpoint text default null,
  p_reason text default 'user',
  p_now timestamptz default now()
)
returns table(subscription_id uuid,subscription_status text)
language plpgsql
security definer
set search_path=public,extensions
as $$
declare
  v_username text;
  v_current_session integer;
  v_hash text;
  v_reason text:=left(lower(regexp_replace(coalesce(nullif(btrim(p_reason),''),'user'),'[^a-zA-Z0-9_.:-]+','_','g')),80);
  v_result public.push_subscriptions%rowtype;
begin
  select u.username,u.session_version into v_username,v_current_session
  from public.admin_users u where u.id=p_actor and u.is_active=true;
  if not found then raise exception 'PUSH_ACTOR_INVALID'; end if;
  if p_session_version is null or p_session_version<>v_current_session then raise exception 'PUSH_SESSION_INVALID'; end if;
  if p_subscription_id is null and nullif(btrim(coalesce(p_endpoint,'')),'') is null then raise exception 'PUSH_SUBSCRIPTION_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_endpoint,'')),'') is not null then
    v_hash:=encode(digest(btrim(p_endpoint),'sha256'),'hex');
  end if;

  select s.* into v_result
  from public.push_subscriptions s
  where s.admin_user_id=p_actor
    and (p_subscription_id is null or s.id=p_subscription_id)
    and (v_hash is null or s.endpoint_hash=v_hash)
  order by s.created_at desc
  limit 1
  for update;
  if not found then raise exception 'PUSH_SUBSCRIPTION_NOT_FOUND'; end if;

  update public.push_subscriptions s
  set status='revoked',revoked_at=coalesce(s.revoked_at,p_now),last_seen_at=p_now,
      last_error_code=v_reason,updated_at=p_now
  where s.id=v_result.id
  returning * into v_result;

  update public.push_delivery_queue q
  set status='suppressed',lease_token=null,lease_expires_at=null,last_error_code=v_reason,updated_at=p_now
  where q.subscription_id=v_result.id and q.status in ('pending','retry','processing');

  update public.notification_preferences pref
  set push_enabled=false,updated_at=p_now
  where pref.admin_user_id=p_actor
    and not exists (
      select 1 from public.push_subscriptions other
      where other.admin_user_id=p_actor and other.status='active'
    );

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,v_username,'push.subscription.deactivated','push_subscription',v_result.id,
    jsonb_build_object('reason',v_reason));

  return query select v_result.id,v_result.status;
end;
$$;

create or replace function public.invalidate_push_subscriptions_on_admin_session_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer:=0;
  v_reason text;
begin
  if new.is_active=true and new.session_version is not distinct from old.session_version then return new; end if;
  v_reason:=case when new.is_active=false then 'account_deactivated' else 'session_rotated' end;

  update public.push_subscriptions s
  set status='revoked',revoked_at=now(),last_error_code=v_reason,updated_at=now()
  where s.admin_user_id=new.id and s.status='active';
  get diagnostics v_count=row_count;

  if v_count>0 then
    update public.push_delivery_queue q
    set status='suppressed',lease_token=null,lease_expires_at=null,last_error_code=v_reason,updated_at=now()
    where q.recipient_admin_id=new.id and q.status in ('pending','retry','processing');
    update public.notification_preferences pref
    set push_enabled=false,updated_at=now()
    where pref.admin_user_id=new.id;
    insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
    values(new.id,new.username,'push.subscriptions.invalidated','admin_user',new.id,
      jsonb_build_object('reason',v_reason,'subscription_count',v_count));
  end if;
  return new;
end;
$$;

drop trigger if exists admin_users_invalidate_push_subscriptions on public.admin_users;
create trigger admin_users_invalidate_push_subscriptions
after update of is_active,session_version on public.admin_users
for each row execute function public.invalidate_push_subscriptions_on_admin_session_change();

-- P10 compara la versión de una tarea con su última asignación. Los avisos de
-- vencimiento usan una versión independiente ligada a due_at y deben conservar
-- su actividad mientras la tarea siga abierta y la fecha no cambie.
create or replace view public.notification_inbox_workspace
with (security_invoker=true)
as
select
  i.*,
  case
    when i.source_type='task' and i.source_event_type='task_due' then coalesce(
      t.status not in ('completed','cancelled')
      and i.source_version='due:'||to_char(t.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      false
    )
    when i.source_type='task' then coalesce(
      t.status not in ('completed','cancelled')
      and i.source_version=to_char(t.assignment_state_changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      false
    )
    when i.source_type='alert' then coalesce(
      c.condition_active
      and n.alert_status in ('pending','snoozed')
      and i.source_version=c.condition_cycle_count::text,
      false
    )
    else true
  end as source_active,
  case
    when i.source_type='task' and i.source_event_type='task_due' then
      case
        when i.source_version='due:'||to_char(t.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') then t.status
        else 'superseded'
      end
    when i.source_type='task' then
      case
        when i.source_version=to_char(t.assignment_state_changed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') then t.status
        else 'superseded'
      end
    when i.source_type='alert' then
      case
        when i.source_version=c.condition_cycle_count::text then n.alert_status
        else 'superseded'
      end
    else 'active'
  end as source_status,
  case when i.read_at is null and i.dismissed_at is null then true else false end as is_unread
from public.notification_inbox_items i
left join public.operational_tasks t on i.source_type='task' and t.id=i.source_id
left join public.operational_alert_conditions c on i.source_type='alert' and c.notification_id=i.source_id
left join public.notifications n on n.id=c.notification_id;

create or replace function public.push_notification_recipient_eligible(
  p_inbox_item_id uuid,
  p_admin_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.notification_inbox_items item
    where item.id=p_inbox_item_id
      and item.recipient_admin_id=p_admin_id
      and case
        when item.source_type='task' then exists (
          select 1
          from public.notification_task_recipients(item.source_id) recipient
          where recipient.admin_user_id=p_admin_id
        )
        when item.source_type='alert' and item.escalation_level>0 then
          public.notification_user_eligible(p_admin_id,array['notifications.manage']::text[])
        when item.source_type='alert'
          and item.source_event_type in ('task_blocked','task_overdue')
          and item.entity_type='operational_task'
          and item.entity_id is not null then
          exists (
            select 1
            from public.notification_task_recipients(item.entity_id) recipient
            where recipient.admin_user_id=p_admin_id
          )
          or (
            not exists (select 1 from public.notification_task_recipients(item.entity_id))
            and public.notification_user_eligible(p_admin_id,array['notifications.manage']::text[])
          )
        when item.source_type='alert' then
          public.notification_user_eligible(p_admin_id,array['notifications.manage']::text[])
        when item.source_event_type='tracking_status_changed' then
          public.notification_user_eligible(p_admin_id,array['logistics.read']::text[])
        when item.source_event_type='document_available' then
          public.notification_user_eligible(p_admin_id,array['documents.read']::text[])
        when item.source_event_type='integration_failure' then
          public.notification_user_eligible(p_admin_id,array['notifications.manage']::text[])
        else public.notification_user_eligible(p_admin_id,array[]::text[])
      end
  );
$$;

create or replace function public.reconcile_web_push_notifications(p_now timestamptz default now())
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_epoch timestamptz;
  v_invalidated integer:=0;
  v_due_count integer:=0;
  v_tracking_count integer:=0;
  v_document_count integer:=0;
  v_integration_count integer:=0;
  v_webhook_count integer:=0;
  v_queued_count integer:=0;
begin
  select state.source_epoch into v_epoch
  from public.web_push_runtime_state state where state.singleton=true;
  v_epoch:=coalesce(v_epoch,p_now);

  update public.push_subscriptions s
  set status=case when s.expiration_time is not null and s.expiration_time<=p_now then 'expired' else 'revoked' end,
      revoked_at=coalesce(s.revoked_at,p_now),
      last_error_code=case
        when s.expiration_time is not null and s.expiration_time<=p_now then 'subscription_expired'
        when not public.notification_user_eligible(s.admin_user_id,array[]::text[]) then 'access_revoked'
        else 'session_invalidated'
      end,
      updated_at=p_now
  from public.admin_users u
  where u.id=s.admin_user_id and s.status='active'
    and (u.is_active=false or u.session_version<>s.session_version
      or not public.notification_user_eligible(s.admin_user_id,array[]::text[])
      or (s.expiration_time is not null and s.expiration_time<=p_now));
  get diagnostics v_invalidated=row_count;

  update public.notification_preferences pref
  set push_enabled=false,updated_at=p_now
  where pref.push_enabled=true
    and not exists (
      select 1 from public.push_subscriptions s
      join public.admin_users u on u.id=s.admin_user_id
      where s.admin_user_id=pref.admin_user_id and s.status='active'
        and s.session_version=u.session_version and u.is_active=true
    );

  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,target_type,target_id,
    title,message,severity,entity_type,entity_id,action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    recipients.admin_user_id,'task',task.id,
    'due:'||to_char(task.due_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'task_due',recipients.target_type,recipients.target_id,
    'Tarea próxima a vencer: '||task.title,
    'La tarea vence el '||to_char(task.due_at at time zone 'UTC','YYYY-MM-DD HH24:MI')||' UTC.',
    case when task.priority='critical' then 'critical' when task.priority='high' then 'warning' else 'info' end,
    task.entity_type,task.entity_id,'open_work',
    jsonb_strip_nulls(jsonb_build_object('task_id',task.id,'workflow_key',task.workflow_key,
      'entity_type',task.entity_type,'entity_id',task.entity_id)),0,p_now,p_now
  from public.operational_tasks task
  join lateral public.notification_task_recipients(task.id) recipients on true
  left join public.notification_preferences pref on pref.admin_user_id=recipients.admin_user_id
  where task.status in ('pending','in_progress','blocked')
    and task.due_at>p_now and task.due_at<=p_now+interval '24 hours'
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.task_assignments_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_due_count=row_count;

  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,target_type,target_id,
    title,message,severity,entity_type,entity_id,action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    u.id,'system',shipment.id,
    'tracking:'||to_char(shipment.last_event_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')||':'||coalesce(shipment.last_status,shipment.operational_status,'updated'),
    'tracking_status_changed','permission',null,
    'Tracking actualizado',
    'El contenedor '||shipment.container_number||' cambió a '||coalesce(shipment.last_status,shipment.operational_status,'estado actualizado')||'.',
    'info','shipment',shipment.id,'open_work',
    jsonb_build_object('entity_type','shipment','entity_id',shipment.id),0,p_now,p_now
  from public.shipments shipment
  cross join public.admin_users u
  left join public.notification_preferences pref on pref.admin_user_id=u.id
  where shipment.last_event_at is not null and shipment.last_event_at>=v_epoch
    and public.notification_user_eligible(u.id,array['logistics.read']::text[])
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.tracking_updates_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_tracking_count=row_count;

  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,target_type,target_id,
    title,message,severity,entity_type,entity_id,action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    u.id,'system',document.id,
    'document:'||document.version::text||':'||to_char(document.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'document_available','permission',null,
    'Documento disponible','Hay un documento nuevo disponible en el ERP.','info',
    case
      when document.shipment_id is not null then 'shipment'
      when document.load_id is not null then 'load'
      when document.source_type='invoice' and document.source_id is not null then 'invoice'
      else null
    end,
    case
      when document.shipment_id is not null then document.shipment_id
      when document.load_id is not null then document.load_id
      when document.source_type='invoice' and document.source_id is not null then document.source_id
      else null
    end,
    case
      when document.shipment_id is not null or document.load_id is not null
        or (document.source_type='invoice' and document.source_id is not null) then 'open_work'
      else 'open_inbox'
    end,
    jsonb_strip_nulls(jsonb_build_object('document_id',document.id,'document_type',document.document_type)),
    0,p_now,p_now
  from public.documents document
  cross join public.admin_users u
  left join public.notification_preferences pref on pref.admin_user_id=u.id
  where document.created_at>=v_epoch and document.deleted_at is null and document.superseded_at is null
    and public.notification_user_eligible(u.id,array['documents.read']::text[])
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.document_updates_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_document_count=row_count;

  with message_failures as (
    select n.id,n.updated_at,n.attempt_count,n.channel,n.shipment_id,n.entity_type,n.entity_id
    from public.notifications n
    where n.notification_scope='message' and n.updated_at>=v_epoch
      and (lower(coalesce(n.delivery_status,'')) in ('failed','undelivered')
        or lower(coalesce(n.status,'')) in ('failed','undelivered'))
  )
  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,target_type,target_id,
    title,message,severity,entity_type,entity_id,action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    u.id,'system',failure.id,
    'integration:message:'||failure.attempt_count::text||':'||to_char(failure.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'integration_failure','permission',null,
    'Fallo de integración','Una entrega externa requiere revisión en el ERP.','warning',
    coalesce(failure.entity_type,case when failure.shipment_id is not null then 'shipment' end),
    coalesce(failure.entity_id,failure.shipment_id),
    case when coalesce(failure.entity_id,failure.shipment_id) is null then 'open_alerts' else 'open_work' end,
    jsonb_strip_nulls(jsonb_build_object('channel',failure.channel)),0,p_now,p_now
  from message_failures failure
  cross join public.admin_users u
  left join public.notification_preferences pref on pref.admin_user_id=u.id
  where public.notification_user_eligible(u.id,array['notifications.manage']::text[])
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.integration_failures_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_integration_count=row_count;

  with webhook_failures as (
    select event.id,event.created_at,event.provider,event.container_number,shipment.id as shipment_id
    from public.webhook_events event
    left join lateral (
      select s.id from public.shipments s
      where upper(s.container_number)=upper(event.container_number)
      order by s.created_at desc limit 1
    ) shipment on true
    where event.created_at>=v_epoch and event.processed=false and event.error_message is not null
  )
  insert into public.notification_inbox_items(
    recipient_admin_id,source_type,source_id,source_version,source_event_type,target_type,target_id,
    title,message,severity,entity_type,entity_id,action_key,action_payload,escalation_level,created_at,updated_at
  )
  select
    u.id,'system',failure.id,
    'integration:webhook:'||to_char(failure.created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'integration_failure','permission',null,
    'Fallo de integración','Un evento externo requiere revisión en el ERP.','warning',
    case when failure.shipment_id is not null then 'shipment' end,failure.shipment_id,
    case when failure.shipment_id is not null then 'open_work' else 'open_alerts' end,
    jsonb_strip_nulls(jsonb_build_object('provider',failure.provider)),0,p_now,p_now
  from webhook_failures failure
  cross join public.admin_users u
  left join public.notification_preferences pref on pref.admin_user_id=u.id
  where public.notification_user_eligible(u.id,array['notifications.manage']::text[])
    and coalesce(pref.in_app_enabled,true)=true
    and coalesce(pref.integration_failures_enabled,true)=true
  on conflict on constraint notification_inbox_semantic_unique do nothing;
  get diagnostics v_webhook_count=row_count;
  v_integration_count:=v_integration_count+v_webhook_count;

  update public.push_delivery_queue q
  set status='suppressed',lease_token=null,lease_expires_at=null,last_error_code='subscription_inactive',updated_at=p_now
  where q.status in ('pending','retry','processing') and exists (
    select 1
    from public.push_subscriptions s
    left join public.notification_preferences pref on pref.admin_user_id=s.admin_user_id
    left join public.admin_users u on u.id=s.admin_user_id
    where s.id=q.subscription_id
      and (s.status<>'active' or u.is_active is distinct from true or s.session_version<>u.session_version
        or coalesce(pref.push_enabled,false)=false)
  );

  update public.push_delivery_queue q
  set status='suppressed',lease_token=null,lease_expires_at=null,last_error_code='preference_disabled',updated_at=p_now
  from public.notification_inbox_items item,public.notification_preferences pref
  where q.inbox_item_id=item.id and pref.admin_user_id=q.recipient_admin_id
    and q.status in ('pending','retry','processing')
    and not case
      when item.source_event_type in ('task_assignment','task_due') then pref.task_assignments_enabled
      when item.source_type='alert' and item.escalation_level>0 then pref.escalations_enabled
      when item.source_type='alert' then pref.operational_alerts_enabled
      when item.source_event_type='tracking_status_changed' then pref.tracking_updates_enabled
      when item.source_event_type='document_available' then pref.document_updates_enabled
      when item.source_event_type='integration_failure' then pref.integration_failures_enabled
      else true
    end;

  update public.push_delivery_queue q
  set status='suppressed',lease_token=null,lease_expires_at=null,
      last_error_code=case
        when item.source_active=false then 'source_inactive'
        when item.is_unread=false then 'already_seen'
        else 'access_revoked'
      end,
      updated_at=p_now
  from public.notification_inbox_workspace item
  where q.inbox_item_id=item.id and q.status in ('pending','retry','processing')
    and (item.source_active=false or item.is_unread=false
      or not public.push_notification_recipient_eligible(item.id,q.recipient_admin_id));

  insert into public.push_delivery_queue(inbox_item_id,subscription_id,recipient_admin_id,status,next_attempt_at,created_at,updated_at)
  select item.id,subscription.id,item.recipient_admin_id,'pending',p_now,p_now,p_now
  from public.notification_inbox_workspace item
  join public.push_subscriptions subscription
    on subscription.admin_user_id=item.recipient_admin_id and subscription.status='active'
  join public.admin_users u
    on u.id=subscription.admin_user_id and u.is_active=true and u.session_version=subscription.session_version
  join public.notification_preferences pref
    on pref.admin_user_id=item.recipient_admin_id and pref.push_enabled=true
  where item.dismissed_at is null and item.source_active=true and item.created_at>=subscription.activated_at
    and item.is_unread=true
    and public.push_notification_recipient_eligible(item.id,item.recipient_admin_id)
    and case
      when item.source_event_type in ('task_assignment','task_due') then pref.task_assignments_enabled
      when item.source_type='alert' and item.escalation_level>0 then pref.escalations_enabled
      when item.source_type='alert' then pref.operational_alerts_enabled
      when item.source_event_type='tracking_status_changed' then pref.tracking_updates_enabled
      when item.source_event_type='document_available' then pref.document_updates_enabled
      when item.source_event_type='integration_failure' then pref.integration_failures_enabled
      else true
    end
  on conflict on constraint push_delivery_recipient_match_unique do nothing;
  get diagnostics v_queued_count=row_count;

  -- Conserva una ventana de solapamiento para tolerar desfase de reloj y
  -- concurrencia; las claves semánticas hacen idempotente el reproceso.
  update public.web_push_runtime_state state
  set source_epoch=greatest(state.source_epoch,p_now-interval '5 minutes'),updated_at=p_now
  where state.singleton=true;

  return jsonb_build_object(
    'subscriptions_invalidated',v_invalidated,
    'task_due_notifications_created',v_due_count,
    'tracking_notifications_created',v_tracking_count,
    'document_notifications_created',v_document_count,
    'integration_notifications_created',v_integration_count,
    'push_deliveries_queued',v_queued_count
  );
end;
$$;

create or replace function public.claim_push_deliveries(
  p_batch_size integer,
  p_lease_token uuid,
  p_now timestamptz default now()
)
returns table(
  delivery_id uuid,
  subscription_id uuid,
  inbox_item_id uuid,
  recipient_admin_id uuid,
  endpoint text,
  p256dh text,
  auth_secret text,
  attempt_count integer,
  severity text,
  unread_count integer,
  deep_link text
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if p_lease_token is null then raise exception 'PUSH_LEASE_REQUIRED'; end if;

  update public.push_delivery_queue q
  set status='failed',lease_token=null,lease_expires_at=null,last_error_code='retry_limit_reached',updated_at=p_now
  where q.status in ('pending','retry','processing') and q.attempt_count>=5;

  return query
  with candidates as (
    select q.id
    from public.push_delivery_queue q
    join public.push_subscriptions s on s.id=q.subscription_id
    join public.admin_users u on u.id=s.admin_user_id
    join public.notification_preferences pref on pref.admin_user_id=s.admin_user_id
    join public.notification_inbox_workspace item on item.id=q.inbox_item_id
    where q.attempt_count<5
      and (
        (q.status in ('pending','retry') and q.next_attempt_at<=p_now)
        or (q.status='processing' and q.lease_expires_at<=p_now)
      )
      and s.status='active' and s.session_version=u.session_version and u.is_active=true
      and pref.push_enabled=true
      and item.source_active=true and item.is_unread=true
      and public.push_notification_recipient_eligible(item.id,q.recipient_admin_id)
      and case
        when item.source_event_type in ('task_assignment','task_due') then pref.task_assignments_enabled
        when item.source_type='alert' and item.escalation_level>0 then pref.escalations_enabled
        when item.source_type='alert' then pref.operational_alerts_enabled
        when item.source_event_type='tracking_status_changed' then pref.tracking_updates_enabled
        when item.source_event_type='document_available' then pref.document_updates_enabled
        when item.source_event_type='integration_failure' then pref.integration_failures_enabled
        else true
      end
    order by q.next_attempt_at,q.created_at
    for update of q skip locked
    limit greatest(1,least(coalesce(p_batch_size,25),100))
  ), claimed as (
    update public.push_delivery_queue q
    set status='processing',attempt_count=q.attempt_count+1,last_attempt_at=p_now,
        lease_token=p_lease_token,lease_expires_at=p_now+interval '5 minutes',updated_at=p_now
    from candidates c
    where q.id=c.id
    returning q.*
  )
  select
    claimed.id,subscription.id,item.id,claimed.recipient_admin_id,
    subscription.endpoint,subscription.p256dh,subscription.auth_secret,claimed.attempt_count,item.severity,
    (select count(*)::integer from public.notification_inbox_items unread
      where unread.recipient_admin_id=claimed.recipient_admin_id
        and unread.read_at is null and unread.dismissed_at is null),
    '/admin/pwa.html?notification='||item.id::text
  from claimed
  join public.push_subscriptions subscription on subscription.id=claimed.subscription_id
  join public.notification_inbox_items item on item.id=claimed.inbox_item_id;
end;
$$;

create or replace function public.complete_push_delivery(
  p_delivery_id uuid,
  p_lease_token uuid,
  p_status text,
  p_status_code integer,
  p_error_code text,
  p_next_attempt_at timestamptz,
  p_now timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_delivery public.push_delivery_queue%rowtype;
  v_status text:=lower(btrim(coalesce(p_status,'')));
  v_error text:=nullif(left(lower(regexp_replace(coalesce(p_error_code,''),'[^a-zA-Z0-9_.:-]+','_','g')),80),'');
begin
  if v_status not in ('sent','retry','failed','expired','suppressed') then raise exception 'PUSH_DELIVERY_STATUS_INVALID'; end if;
  if p_status_code is not null and p_status_code not between 100 and 599 then raise exception 'PUSH_STATUS_CODE_INVALID'; end if;

  select q.* into v_delivery
  from public.push_delivery_queue q
  where q.id=p_delivery_id and q.status='processing' and q.lease_token=p_lease_token
  for update;
  if not found then raise exception 'PUSH_DELIVERY_LEASE_INVALID'; end if;
  if v_status='retry' and v_delivery.attempt_count>=5 then
    v_status:='failed';
    v_error:=coalesce(v_error,'retry_limit_reached');
  end if;

  update public.push_delivery_queue q
  set status=v_status,provider_status_code=p_status_code,last_error_code=v_error,
      next_attempt_at=case when v_status='retry' then coalesce(p_next_attempt_at,p_now+interval '5 minutes') else q.next_attempt_at end,
      sent_at=case when v_status='sent' then p_now else q.sent_at end,
      lease_token=null,lease_expires_at=null,updated_at=p_now
  where q.id=v_delivery.id;

  if v_status='sent' then
    update public.push_subscriptions s
    set last_delivery_at=p_now,last_seen_at=p_now,failure_count=0,last_error_code=null,updated_at=p_now
    where s.id=v_delivery.subscription_id;
  elsif v_status in ('retry','failed') then
    update public.push_subscriptions s
    set failure_count=s.failure_count+1,last_error_code=v_error,updated_at=p_now
    where s.id=v_delivery.subscription_id;
  elsif v_status='expired' then
    update public.push_subscriptions s
    set status='expired',revoked_at=p_now,failure_count=s.failure_count+1,
        last_error_code=coalesce(v_error,'subscription_expired'),updated_at=p_now
    where s.id=v_delivery.subscription_id;
    update public.notification_preferences pref
    set push_enabled=false,updated_at=p_now
    where pref.admin_user_id=v_delivery.recipient_admin_id
      and not exists (
        select 1 from public.push_subscriptions active
        where active.admin_user_id=v_delivery.recipient_admin_id and active.status='active'
      );
  end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(null,'Sistema','push.delivery.'||v_status,'push_delivery',v_delivery.id,
    jsonb_strip_nulls(jsonb_build_object(
      'recipient_admin_id',v_delivery.recipient_admin_id,
      'subscription_id',v_delivery.subscription_id,
      'inbox_item_id',v_delivery.inbox_item_id,
      'attempt_count',v_delivery.attempt_count,
      'status_code',p_status_code,
      'error_code',v_error,
      'next_attempt_at',case when v_status='retry' then p_next_attempt_at end
    )));

  return jsonb_build_object('delivery_id',v_delivery.id,'status',v_status,'attempt_count',v_delivery.attempt_count);
end;
$$;

alter table public.web_push_runtime_state enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.push_delivery_queue enable row level security;

revoke all on public.web_push_runtime_state from public,anon,authenticated;
revoke all on public.push_subscriptions from public,anon,authenticated;
revoke all on public.push_delivery_queue from public,anon,authenticated;
revoke all on public.push_subscription_workspace from public,anon,authenticated;

grant select,insert,update on public.web_push_runtime_state to service_role;
grant select,insert,update on public.push_subscriptions to service_role;
grant select,insert,update on public.push_delivery_queue to service_role;
grant select on public.push_subscription_workspace to service_role;

revoke execute on function public.set_notification_preferences_v2(uuid,boolean,boolean,boolean,boolean,boolean,text,boolean,text,boolean,boolean,boolean,boolean,timestamptz) from public,anon,authenticated;
revoke execute on function public.upsert_push_subscription(uuid,integer,text,text,text,timestamptz,text,text,timestamptz) from public,anon,authenticated;
revoke execute on function public.deactivate_push_subscription(uuid,integer,uuid,text,text,timestamptz) from public,anon,authenticated;
revoke execute on function public.invalidate_push_subscriptions_on_admin_session_change() from public,anon,authenticated;
revoke execute on function public.push_notification_recipient_eligible(uuid,uuid) from public,anon,authenticated;
revoke execute on function public.reconcile_web_push_notifications(timestamptz) from public,anon,authenticated;
revoke execute on function public.claim_push_deliveries(integer,uuid,timestamptz) from public,anon,authenticated;
revoke execute on function public.complete_push_delivery(uuid,uuid,text,integer,text,timestamptz,timestamptz) from public,anon,authenticated;

grant execute on function public.set_notification_preferences_v2(uuid,boolean,boolean,boolean,boolean,boolean,text,boolean,text,boolean,boolean,boolean,boolean,timestamptz) to service_role;
grant execute on function public.upsert_push_subscription(uuid,integer,text,text,text,timestamptz,text,text,timestamptz) to service_role;
grant execute on function public.deactivate_push_subscription(uuid,integer,uuid,text,text,timestamptz) to service_role;
grant execute on function public.invalidate_push_subscriptions_on_admin_session_change() to service_role;
grant execute on function public.push_notification_recipient_eligible(uuid,uuid) to service_role;
grant execute on function public.reconcile_web_push_notifications(timestamptz) to service_role;
grant execute on function public.claim_push_deliveries(integer,uuid,timestamptz) to service_role;
grant execute on function public.complete_push_delivery(uuid,uuid,text,integer,text,timestamptz,timestamptz) to service_role;
