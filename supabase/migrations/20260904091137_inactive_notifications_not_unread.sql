-- Los avisos históricos permanecen visibles, pero no deben inflar la campana.
create or replace view public.notification_inbox_workspace
with (security_invoker=true)
as
with inbox_source_state as (
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
    end as source_status
  from public.notification_inbox_items i
  left join public.operational_tasks t on i.source_type='task' and t.id=i.source_id
  left join public.operational_alert_conditions c on i.source_type='alert' and c.notification_id=i.source_id
  left join public.notifications n on n.id=c.notification_id
)
select
  inbox_source_state.*,
  (
    inbox_source_state.source_active
    and inbox_source_state.read_at is null
    and inbox_source_state.dismissed_at is null
  ) as is_unread
from inbox_source_state;

revoke all on public.notification_inbox_workspace from public,anon,authenticated;
grant select on public.notification_inbox_workspace to service_role;

comment on view public.notification_inbox_workspace is
  'Inbox con estado derivado; solo fuentes activas y pendientes de lectura cuentan en la campana.';
