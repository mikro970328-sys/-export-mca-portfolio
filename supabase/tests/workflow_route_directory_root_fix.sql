\set ON_ERROR_STOP on

create role anon nologin;
create role authenticated nologin;
create role service_role nologin;

create table public.teams(id uuid primary key,name text not null);
create table public.admin_users(
  id uuid primary key,
  username text not null,
  full_name text,
  role text not null,
  is_active boolean not null default true
);
create table public.admin_effective_permissions(
  admin_user_id uuid not null,
  permission_key text not null,
  primary key(admin_user_id,permission_key)
);
create table public.team_memberships(
  team_id uuid not null,
  admin_user_id uuid not null,
  primary key(team_id,admin_user_id)
);
create table public.workflow_task_routes(
  workflow_key text primary key,
  label text not null,
  description text,
  enabled boolean not null default true,
  default_priority text not null default 'normal',
  default_due_hours integer,
  due_soon_minutes integer,
  required_permissions text[] not null default '{}',
  assigned_team_id uuid,
  assigned_admin_id uuid,
  activated_at timestamptz not null default now(),
  is_system boolean not null default true,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.operational_tasks(
  id uuid primary key,
  origin text not null,
  workflow_key text,
  status text not null
);

insert into public.teams values ('10000000-0000-0000-0000-000000000001','Finance');
insert into public.admin_users(id,username,full_name,role) values
  ('20000000-0000-0000-0000-000000000001','partial','Partial Admin','admin'),
  ('20000000-0000-0000-0000-000000000002','complete','Complete Admin','admin'),
  ('20000000-0000-0000-0000-000000000003','master','Master Admin','master_admin');
insert into public.admin_effective_permissions values
  ('20000000-0000-0000-0000-000000000001','sales.read'),
  ('20000000-0000-0000-0000-000000000002','finance.read'),
  ('20000000-0000-0000-0000-000000000002','finance.write');
insert into public.team_memberships values
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),
  ('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002');
insert into public.workflow_task_routes(
  workflow_key,label,required_permissions,assigned_team_id,assigned_admin_id
) values
  ('partial_admin','Partial admin',array['sales.read','sales.write'],null,'20000000-0000-0000-0000-000000000001'),
  ('master_admin','Master admin',array['unknown.permission'],null,'20000000-0000-0000-0000-000000000003'),
  ('finance_team','Finance team',array['finance.read','finance.write'],'10000000-0000-0000-0000-000000000001',null),
  ('unassigned','Unassigned','{}',null,null),
  ('empty_requirements','Empty requirements','{}',null,'20000000-0000-0000-0000-000000000001');
insert into public.operational_tasks values
  ('30000000-0000-0000-0000-000000000001','workflow','partial_admin','pending'),
  ('30000000-0000-0000-0000-000000000002','workflow','partial_admin','completed'),
  ('30000000-0000-0000-0000-000000000003','manual','partial_admin','pending');

\ir ../migrations/20261016193000_workflow_route_directory_root_fix.sql

analyze public.teams;
analyze public.admin_users;
analyze public.admin_effective_permissions;
analyze public.team_memberships;
analyze public.workflow_task_routes;
analyze public.operational_tasks;

do $$
declare
  row_data record;
  plan json;
begin
  select * into row_data from public.workflow_task_route_directory where workflow_key='partial_admin';
  if row_data.assigned_admin_access_compatible is not false or row_data.routing_access_compatible is not false then
    raise exception 'an admin missing a required permission was accepted';
  end if;
  if row_data.active_task_count <> 1 then
    raise exception 'active task aggregation counted %, expected 1',row_data.active_task_count;
  end if;

  select * into row_data from public.workflow_task_route_directory where workflow_key='master_admin';
  if row_data.assigned_admin_access_compatible is not true or row_data.routing_access_compatible is not true then
    raise exception 'master admin compatibility regressed';
  end if;

  select * into row_data from public.workflow_task_route_directory where workflow_key='finance_team';
  if row_data.team_member_count <> 2 or row_data.team_eligible_member_count <> 1 or row_data.routing_access_compatible is not true then
    raise exception 'team eligibility mismatch: members %, eligible %, compatible %',
      row_data.team_member_count,row_data.team_eligible_member_count,row_data.routing_access_compatible;
  end if;

  select * into row_data from public.workflow_task_route_directory where workflow_key='unassigned';
  if row_data.routing_access_compatible is not false then raise exception 'unassigned route accepted'; end if;

  select * into row_data from public.workflow_task_route_directory where workflow_key='empty_requirements';
  if row_data.assigned_admin_access_compatible is not true then raise exception 'empty requirements rejected'; end if;

  if position('effective.permission_key=required.permission_key' in replace(pg_get_viewdef('public.workflow_task_route_health'::regclass,true),' ',''))=0 then
    raise exception 'permission keys are not explicitly matched';
  end if;
  if position('ep.permission_key = ep.permission_key' in pg_get_viewdef('public.workflow_task_route_health'::regclass,true))>0 then
    raise exception 'tautological permission comparison returned';
  end if;
  if not exists (
    select 1 from pg_class where oid='public.workflow_task_route_directory'::regclass
      and 'security_invoker=true'=any(reloptions)
  ) then raise exception 'directory view lost security_invoker'; end if;
  if has_table_privilege('anon','public.workflow_task_route_directory','select')
     or has_table_privilege('authenticated','public.workflow_task_route_directory','select')
     or not has_table_privilege('service_role','public.workflow_task_route_directory','select') then
    raise exception 'backend-only privileges regressed';
  end if;

  execute 'explain (format json) select * from public.workflow_task_route_directory where enabled=true order by label' into plan;
  if (plan->0->'Plan'->>'Total Cost')::numeric >= 1000 then
    raise exception 'route directory plan cost is unexpectedly high: %',plan->0->'Plan'->>'Total Cost';
  end if;
  if plan::text like '%Subplan Name%' then raise exception 'correlated subplan returned to route directory'; end if;
end $$;

select 'workflow route directory regression passed' as result;
