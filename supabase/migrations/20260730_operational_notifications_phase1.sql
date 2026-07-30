-- Export MCA ERP
-- Operational notifications phase 1
-- Extends the existing notifications table without replacing WhatsApp history.

alter table public.notifications
  add column if not exists notification_scope text not null default 'message',
  add column if not exists entity_type text,
  add column if not exists entity_id uuid,
  add column if not exists alert_status text,
  add column if not exists severity text,
  add column if not exists title text,
  add column if not exists message text,
  add column if not exists dedupe_key text,
  add column if not exists due_at timestamptz,
  add column if not exists first_triggered_at timestamptz,
  add column if not exists last_triggered_at timestamptz,
  add column if not exists occurrence_count integer not null default 0,
  add column if not exists read_at timestamptz,
  add column if not exists snoozed_until timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists resolved_by uuid,
  add column if not exists resolved_reason text,
  add column if not exists updated_at timestamptz not null default now();

-- Keep legacy WhatsApp rows classified as message history.
update public.notifications
set
  notification_scope = coalesce(nullif(notification_scope, ''), 'message'),
  entity_type = coalesce(
    entity_type,
    case
      when shipment_id is not null then 'shipment'
      when client_id is not null then 'client'
      else null
    end
  ),
  entity_id = coalesce(entity_id, shipment_id, client_id),
  updated_at = coalesce(updated_at, created_at, now())
where
  notification_scope is null
  or notification_scope = ''
  or entity_type is null
  or entity_id is null
  or updated_at is null;

alter table public.notifications
  drop constraint if exists notifications_scope_check;
alter table public.notifications
  add constraint notifications_scope_check
  check (notification_scope in ('message', 'operational'));

alter table public.notifications
  drop constraint if exists notifications_alert_status_check;
alter table public.notifications
  add constraint notifications_alert_status_check
  check (alert_status is null or alert_status in ('pending', 'snoozed', 'resolved'));

alter table public.notifications
  drop constraint if exists notifications_severity_check;
alter table public.notifications
  add constraint notifications_severity_check
  check (severity is null or severity in ('info', 'warning', 'critical'));

alter table public.notifications
  drop constraint if exists notifications_occurrence_count_check;
alter table public.notifications
  add constraint notifications_occurrence_count_check
  check (occurrence_count >= 0);

create index if not exists idx_notifications_scope_status_created
  on public.notifications(notification_scope, alert_status, created_at desc);

create index if not exists idx_notifications_entity_active
  on public.notifications(entity_type, entity_id, alert_status, created_at desc)
  where notification_scope = 'operational';

create index if not exists idx_notifications_due_pending
  on public.notifications(due_at)
  where notification_scope = 'operational' and alert_status in ('pending', 'snoozed');

-- Only one unresolved operational alert may exist for the same problem.
create unique index if not exists idx_notifications_active_dedupe_unique
  on public.notifications(dedupe_key)
  where notification_scope = 'operational'
    and dedupe_key is not null
    and resolved_at is null;

comment on column public.notifications.status is
  'Provider delivery status for WhatsApp or another outbound channel.';
comment on column public.notifications.alert_status is
  'Operational lifecycle status: pending, snoozed or resolved.';
comment on column public.notifications.dedupe_key is
  'Stable key that prevents duplicate unresolved operational alerts.';
