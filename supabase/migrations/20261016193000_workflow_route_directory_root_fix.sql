-- Root-cause fix for intermittent workflow route directory failures.
-- Compute permission coverage, team eligibility, and active task counts once per set.

create index if not exists operational_tasks_active_workflow_idx
  on public.operational_tasks(workflow_key)
  where origin='workflow' and status in ('pending','in_progress','blocked');

create or replace view public.workflow_task_route_health
with (security_invoker=true)
as
with route_base as (
  select
    r.*,
    coalesce(cardinality(r.required_permissions),0)::integer as required_permission_count
  from public.workflow_task_routes r
),
route_required_permissions as (
  select rb.workflow_key, required.permission_key
  from route_base rb
  cross join lateral unnest(coalesce(rb.required_permissions,'{}'::text[])) as required(permission_key)
  group by rb.workflow_key, required.permission_key
),
route_requirement_counts as (
  select workflow_key, count(*)::integer as distinct_required_permission_count
  from route_required_permissions
  group by workflow_key
),
permission_matches as (
  select
    required.workflow_key,
    effective.admin_user_id,
    count(*)::integer as matched_permission_count
  from route_required_permissions required
  join public.admin_effective_permissions effective
    on effective.permission_key=required.permission_key
  group by required.workflow_key,effective.admin_user_id
),
team_stats as (
  select
    rb.workflow_key,
    count(member.id)::integer as team_member_count,
    count(member.id) filter (
      where member.role='master_admin'
         or coalesce(matches.matched_permission_count,0)=coalesce(requirements.distinct_required_permission_count,0)
    )::integer as team_eligible_member_count
  from route_base rb
  left join public.team_memberships membership
    on membership.team_id=rb.assigned_team_id
  left join public.admin_users member
    on member.id=membership.admin_user_id and member.is_active=true
  left join route_requirement_counts requirements
    on requirements.workflow_key=rb.workflow_key
  left join permission_matches matches
    on matches.workflow_key=rb.workflow_key and matches.admin_user_id=member.id
  where rb.assigned_team_id is not null
  group by rb.workflow_key,requirements.distinct_required_permission_count
)
select
  rb.workflow_key,
  rb.label,
  rb.description,
  rb.enabled,
  rb.default_priority,
  rb.default_due_hours,
  rb.due_soon_minutes,
  rb.required_permissions,
  rb.assigned_team_id,
  team.name as assigned_team_name,
  rb.assigned_admin_id,
  assigned.username as assigned_admin_username,
  assigned.full_name as assigned_admin_name,
  rb.activated_at,
  rb.is_system,
  rb.updated_by,
  rb.created_at,
  rb.updated_at,
  rb.required_permission_count,
  case
    when rb.assigned_admin_id is null then null::boolean
    when assigned.role='master_admin' then true
    else coalesce(assigned_matches.matched_permission_count,0)=coalesce(requirements.distinct_required_permission_count,0)
  end as assigned_admin_access_compatible,
  case when rb.assigned_team_id is null then null::integer else coalesce(stats.team_member_count,0) end as team_member_count,
  case when rb.assigned_team_id is null then null::integer else coalesce(stats.team_eligible_member_count,0) end as team_eligible_member_count,
  case
    when rb.assigned_team_id is null and rb.assigned_admin_id is null then false
    when rb.assigned_admin_id is not null then
      case
        when assigned.role='master_admin' then true
        else coalesce(assigned_matches.matched_permission_count,0)=coalesce(requirements.distinct_required_permission_count,0)
      end
    else coalesce(stats.team_eligible_member_count,0)>0
  end as routing_access_compatible
from route_base rb
left join public.teams team on team.id=rb.assigned_team_id
left join public.admin_users assigned on assigned.id=rb.assigned_admin_id
left join route_requirement_counts requirements on requirements.workflow_key=rb.workflow_key
left join permission_matches assigned_matches
  on assigned_matches.workflow_key=rb.workflow_key and assigned_matches.admin_user_id=rb.assigned_admin_id
left join team_stats stats on stats.workflow_key=rb.workflow_key;

create or replace view public.workflow_task_route_directory
with (security_invoker=true)
as
with active_task_counts as (
  select ot.workflow_key,count(*)::integer as active_task_count
  from public.operational_tasks ot
  where ot.origin='workflow' and ot.status in ('pending','in_progress','blocked')
  group by ot.workflow_key
)
select
  health.workflow_key,
  health.label,
  health.description,
  health.enabled,
  health.default_priority,
  health.default_due_hours,
  health.assigned_team_id,
  health.assigned_team_name,
  health.assigned_admin_id,
  health.assigned_admin_username,
  health.assigned_admin_name,
  health.activated_at,
  health.is_system,
  health.updated_by,
  health.created_at,
  health.updated_at,
  coalesce(tasks.active_task_count,0)::integer as active_task_count,
  health.due_soon_minutes,
  health.required_permissions,
  health.required_permission_count,
  health.assigned_admin_access_compatible,
  health.team_member_count,
  health.team_eligible_member_count,
  health.routing_access_compatible
from public.workflow_task_route_health health
left join active_task_counts tasks on tasks.workflow_key=health.workflow_key;

revoke all on public.workflow_task_route_health from public,anon,authenticated;
revoke all on public.workflow_task_route_directory from public,anon,authenticated;
grant select on public.workflow_task_route_health to service_role;
grant select on public.workflow_task_route_directory to service_role;

comment on view public.workflow_task_route_health is
  'Set-based workflow routing health. Permission coverage is matched by key; no per-route correlated permission expansion.';
comment on view public.workflow_task_route_directory is
  'Backend-only workflow route directory with set-based active-task aggregation.';
