-- P8 · Colas operativas, SLA y atención derivada sobre P4/P5.

alter table public.operational_tasks
  add column if not exists blocked_at timestamptz,
  add column if not exists assignment_state_changed_at timestamptz;

update public.operational_tasks t
set blocked_at=coalesce((
  select max(h.created_at)
  from public.operational_task_history h
  where h.task_id=t.id and h.to_status='blocked'
),t.updated_at,t.created_at)
where t.status='blocked' and t.blocked_at is null;

update public.operational_tasks
set blocked_at=null
where status<>'blocked' and blocked_at is not null;

update public.operational_tasks
set assignment_state_changed_at=created_at
where assignment_state_changed_at is null;

alter table public.operational_tasks
  alter column assignment_state_changed_at set default now(),
  alter column assignment_state_changed_at set not null;

alter table public.operational_tasks drop constraint if exists operational_tasks_blocked_at_consistency;
alter table public.operational_tasks add constraint operational_tasks_blocked_at_consistency check (
  (status='blocked' and blocked_at is not null)
  or (status<>'blocked' and blocked_at is null)
);

create index if not exists operational_tasks_blocked_at_idx
  on public.operational_tasks(blocked_at) where blocked_at is not null;
create index if not exists operational_tasks_assignment_state_changed_idx
  on public.operational_tasks(assignment_state_changed_at);

create or replace function public.track_operational_task_attention_timestamps()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='INSERT' then
    new.assignment_state_changed_at=coalesce(new.assignment_state_changed_at,new.created_at,now());
    if new.status='blocked' then
      new.blocked_at=coalesce(new.blocked_at,now());
    else
      new.blocked_at=null;
    end if;
    return new;
  end if;

  if new.assigned_team_id is distinct from old.assigned_team_id
     or new.assigned_admin_id is distinct from old.assigned_admin_id then
    new.assignment_state_changed_at=now();
  end if;

  if new.status='blocked' and old.status is distinct from 'blocked' then
    new.blocked_at=now();
  elsif new.status<>'blocked' then
    new.blocked_at=null;
  end if;
  return new;
end;
$$;

drop trigger if exists operational_tasks_attention_timestamps on public.operational_tasks;
create trigger operational_tasks_attention_timestamps
before insert or update of status,assigned_team_id,assigned_admin_id on public.operational_tasks
for each row execute function public.track_operational_task_attention_timestamps();

revoke execute on function public.track_operational_task_attention_timestamps() from public,anon,authenticated;

alter table public.workflow_task_routes
  add column if not exists required_permissions text[] not null default '{}'::text[],
  add column if not exists due_soon_minutes integer not null default 120;

alter table public.workflow_task_routes drop constraint if exists workflow_task_routes_due_soon_minutes_check;
alter table public.workflow_task_routes add constraint workflow_task_routes_due_soon_minutes_check
  check (due_soon_minutes between 5 and 10080);

update public.workflow_task_routes
set required_permissions=case workflow_key
  when 'sales_supply_planning' then array['sales.read','sales.write']::text[]
  when 'sales_procurement_linkage' then array['sales.read','sales.write']::text[]
  when 'purchase_receipt' then array['procurement.read','warehouse.write']::text[]
  when 'direct_fulfillment' then array['sales.read','sales.write']::text[]
  when 'prepare_load' then array['sales.read','logistics.write']::text[]
  when 'shipment_cuba_documents' then array['logistics.read','documents.read','documents.write']::text[]
  when 'sales_invoice' then array['finance.read','finance.write']::text[]
  when 'invoice_collection' then array['finance.read','finance.write']::text[]
  when 'supplier_bill_payment' then array['finance.read','finance.write']::text[]
  else required_permissions
end,
due_soon_minutes=case
  when default_due_hours is null then 120
  when default_due_hours<=4 then 60
  when default_due_hours<=12 then 120
  else 180
end;

create or replace function public.validate_workflow_route_required_permissions()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_invalid text;
begin
  if exists(select 1 from unnest(coalesce(new.required_permissions,'{}'::text[])) p where btrim(coalesce(p,''))='') then
    raise exception 'WORKFLOW_ROUTE_PERMISSION_INVALID';
  end if;

  select p into v_invalid
  from unnest(coalesce(new.required_permissions,'{}'::text[])) p
  left join public.access_permissions ap on ap.permission_key=p and ap.is_active=true
  where ap.permission_key is null
  limit 1;
  if v_invalid is not null then raise exception 'WORKFLOW_ROUTE_PERMISSION_INVALID'; end if;
  return new;
end;
$$;

drop trigger if exists workflow_task_routes_validate_permissions on public.workflow_task_routes;
create trigger workflow_task_routes_validate_permissions
before insert or update of required_permissions on public.workflow_task_routes
for each row execute function public.validate_workflow_route_required_permissions();

revoke execute on function public.validate_workflow_route_required_permissions() from public,anon,authenticated;

create or replace view public.workflow_task_route_health
with (security_invoker=true)
as
select
  r.workflow_key,
  r.label,
  r.description,
  r.enabled,
  r.default_priority,
  r.default_due_hours,
  r.due_soon_minutes,
  r.required_permissions,
  r.assigned_team_id,
  t.name as assigned_team_name,
  r.assigned_admin_id,
  a.username as assigned_admin_username,
  a.full_name as assigned_admin_name,
  r.activated_at,
  r.is_system,
  r.updated_by,
  r.created_at,
  r.updated_at,
  coalesce(cardinality(r.required_permissions),0) as required_permission_count,
  case
    when r.assigned_admin_id is null then null
    when a.role='master_admin' then true
    else not exists (
      select 1 from unnest(r.required_permissions) permission_key
      where not exists (
        select 1 from public.admin_effective_permissions ep
        where ep.admin_user_id=r.assigned_admin_id and ep.permission_key=permission_key
      )
    )
  end as assigned_admin_access_compatible,
  case when r.assigned_team_id is null then null else (
    select count(*)::integer
    from public.team_memberships tm
    join public.admin_users member on member.id=tm.admin_user_id and member.is_active=true
    where tm.team_id=r.assigned_team_id
  ) end as team_member_count,
  case when r.assigned_team_id is null then null else (
    select count(*)::integer
    from public.team_memberships tm
    join public.admin_users member on member.id=tm.admin_user_id and member.is_active=true
    where tm.team_id=r.assigned_team_id
      and (
        member.role='master_admin'
        or not exists (
          select 1 from unnest(r.required_permissions) permission_key
          where not exists (
            select 1 from public.admin_effective_permissions ep
            where ep.admin_user_id=member.id and ep.permission_key=permission_key
          )
        )
      )
  ) end as team_eligible_member_count,
  case
    when r.assigned_team_id is null and r.assigned_admin_id is null then false
    when r.assigned_admin_id is not null then
      case when a.role='master_admin' then true else not exists (
        select 1 from unnest(r.required_permissions) permission_key
        where not exists (
          select 1 from public.admin_effective_permissions ep
          where ep.admin_user_id=r.assigned_admin_id and ep.permission_key=permission_key
        )
      ) end
    else exists (
      select 1
      from public.team_memberships tm
      join public.admin_users member on member.id=tm.admin_user_id and member.is_active=true
      where tm.team_id=r.assigned_team_id
        and (
          member.role='master_admin'
          or not exists (
            select 1 from unnest(r.required_permissions) permission_key
            where not exists (
              select 1 from public.admin_effective_permissions ep
              where ep.admin_user_id=member.id and ep.permission_key=permission_key
            )
          )
        )
    )
  end as routing_access_compatible
from public.workflow_task_routes r
left join public.teams t on t.id=r.assigned_team_id
left join public.admin_users a on a.id=r.assigned_admin_id;

revoke all on public.workflow_task_route_health from public,anon,authenticated;
grant select on public.workflow_task_route_health to service_role;

create or replace view public.workflow_task_route_directory
with (security_invoker=true)
as
select h.*,
       (select count(*) from public.operational_tasks ot
        where ot.origin='workflow' and ot.workflow_key=h.workflow_key
          and ot.status in ('pending','in_progress','blocked'))::integer as active_task_count
from public.workflow_task_route_health h;

revoke all on public.workflow_task_route_directory from public,anon,authenticated;
grant select on public.workflow_task_route_directory to service_role;

create or replace view public.operational_task_attention
with (security_invoker=true)
as
select
  w.*,
  route.label as workflow_label,
  route.default_due_hours as workflow_default_due_hours,
  coalesce(route.due_soon_minutes,120) as due_soon_minutes,
  coalesce(route.required_permissions,'{}'::text[]) as required_permissions,
  route.routing_access_compatible,
  route.assigned_admin_access_compatible as route_assigned_admin_access_compatible,
  route.team_member_count as route_team_member_count,
  route.team_eligible_member_count as route_team_eligible_member_count,
  (w.status in ('pending','in_progress','blocked')) as is_open,
  (w.status in ('pending','in_progress','blocked') and w.assigned_team_id is null and w.assigned_admin_id is null) as is_unassigned,
  (w.status in ('pending','in_progress','blocked') and w.due_at is not null and w.due_at<now()) as is_overdue_attention,
  (w.status in ('pending','in_progress','blocked') and w.due_at is not null and w.due_at>=now()
    and w.due_at<=now()+make_interval(mins=>coalesce(route.due_soon_minutes,120))) as is_due_soon,
  greatest(floor(extract(epoch from (now()-w.created_at))/60),0)::bigint as age_minutes,
  case when w.due_at is null then null else floor(extract(epoch from (w.due_at-now()))/60)::bigint end as due_in_minutes,
  case when w.blocked_at is null then null else greatest(floor(extract(epoch from (now()-w.blocked_at))/60),0)::bigint end as blocked_minutes,
  greatest(floor(extract(epoch from (now()-w.assignment_state_changed_at))/60),0)::bigint as assignment_state_minutes,
  case
    when w.status in ('completed','cancelled') then 'closed'
    when w.status='blocked' then 'blocked'
    when w.due_at is not null and w.due_at<now() then 'overdue'
    when w.assigned_team_id is null and w.assigned_admin_id is null then 'unassigned'
    when w.due_at is not null and w.due_at>=now()
      and w.due_at<=now()+make_interval(mins=>coalesce(route.due_soon_minutes,120)) then 'due_soon'
    else 'normal'
  end as attention_state,
  (w.origin='workflow' and (
     (w.assigned_team_id is null and w.assigned_admin_id is null)
     or route.routing_access_compatible is false
   )) as needs_routing_attention
from public.operational_task_workspace w
left join public.workflow_task_route_health route on route.workflow_key=w.workflow_key;

revoke all on public.operational_task_attention from public,anon,authenticated;
grant select on public.operational_task_attention to service_role;
