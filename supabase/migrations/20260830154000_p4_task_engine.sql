-- P4 · Motor de tareas, asignaciones y cola operativa

insert into public.access_permissions(permission_key,module,action,label,description,sort_order)
values
  ('tasks.read','tasks','read','Ver tareas','Consultar la cola de trabajo visible para el usuario o sus equipos.',95),
  ('tasks.write','tasks','write','Trabajar tareas','Comentar y transicionar tareas visibles.',96),
  ('tasks.manage','tasks','manage','Gestionar tareas','Crear, asignar, reasignar, priorizar, cancelar y administrar la cola global.',97)
on conflict (permission_key) do update
set module=excluded.module,
    action=excluded.action,
    label=excluded.label,
    description=excluded.description,
    sort_order=excluded.sort_order,
    is_active=true;

insert into public.access_role_permissions(access_role_id,permission_key)
select r.id,p.permission_key
from public.access_roles r
join public.access_permissions p on p.permission_key in ('tasks.read','tasks.write','tasks.manage') and p.is_active=true
where r.is_system=true and r.is_active=true
on conflict (access_role_id,permission_key) do nothing;

create table public.operational_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  status text not null default 'pending',
  priority text not null default 'normal',
  due_at timestamptz,
  assigned_team_id uuid references public.teams(id) on delete restrict,
  assigned_admin_id uuid references public.admin_users(id) on delete restrict,
  created_by uuid references public.admin_users(id) on delete set null,
  origin text not null default 'manual',
  workflow_key text,
  source_event_key text,
  dedupe_key text,
  entity_type text,
  entity_id uuid,
  blocked_reason text,
  cancelled_reason text,
  started_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint operational_tasks_title_not_blank check (btrim(title) <> ''),
  constraint operational_tasks_status_check check (status in ('pending','in_progress','blocked','completed','cancelled')),
  constraint operational_tasks_priority_check check (priority in ('low','normal','high','critical')),
  constraint operational_tasks_origin_check check (origin in ('manual','workflow')),
  constraint operational_tasks_entity_pair_check check ((entity_type is null) = (entity_id is null)),
  constraint operational_tasks_entity_type_check check (entity_type is null or entity_type in ('client','sales_order','purchase_order','warehouse_receipt','load','shipment','invoice','supplier_bill','document','customer_advance','proforma')),
  constraint operational_tasks_workflow_fields_check check (
    (origin='manual' and workflow_key is null and source_event_key is null and dedupe_key is null)
    or
    (origin='workflow' and btrim(coalesce(workflow_key,''))<>'' and btrim(coalesce(source_event_key,''))<>'' and btrim(coalesce(dedupe_key,''))<>'')
  ),
  constraint operational_tasks_blocked_consistency check (
    (status='blocked' and btrim(coalesce(blocked_reason,''))<>'')
    or (status<>'blocked' and blocked_reason is null)
  ),
  constraint operational_tasks_completed_consistency check (
    (status='completed' and completed_at is not null)
    or (status<>'completed' and completed_at is null)
  ),
  constraint operational_tasks_cancelled_consistency check (
    (status='cancelled' and cancelled_at is not null and btrim(coalesce(cancelled_reason,''))<>'')
    or (status<>'cancelled' and cancelled_at is null and cancelled_reason is null)
  )
);

create unique index operational_tasks_dedupe_key_uidx on public.operational_tasks(dedupe_key) where dedupe_key is not null;
create index operational_tasks_status_idx on public.operational_tasks(status);
create index operational_tasks_due_at_idx on public.operational_tasks(due_at) where due_at is not null;
create index operational_tasks_priority_idx on public.operational_tasks(priority);
create index operational_tasks_assigned_team_idx on public.operational_tasks(assigned_team_id) where assigned_team_id is not null;
create index operational_tasks_assigned_admin_idx on public.operational_tasks(assigned_admin_id) where assigned_admin_id is not null;
create index operational_tasks_created_by_idx on public.operational_tasks(created_by) where created_by is not null;
create index operational_tasks_entity_idx on public.operational_tasks(entity_type,entity_id) where entity_id is not null;

create table public.operational_task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.operational_tasks(id) on delete cascade,
  author_admin_id uuid references public.admin_users(id) on delete set null,
  author_username text not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint operational_task_comments_body_not_blank check (btrim(body) <> ''),
  constraint operational_task_comments_author_not_blank check (btrim(author_username) <> '')
);
create index operational_task_comments_task_idx on public.operational_task_comments(task_id,created_at);

create table public.operational_task_history (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.operational_tasks(id) on delete cascade,
  event_type text not null,
  actor_admin_id uuid references public.admin_users(id) on delete set null,
  actor_username text,
  from_status text,
  to_status text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint operational_task_history_event_not_blank check (btrim(event_type) <> ''),
  constraint operational_task_history_from_status_check check (from_status is null or from_status in ('pending','in_progress','blocked','completed','cancelled')),
  constraint operational_task_history_to_status_check check (to_status is null or to_status in ('pending','in_progress','blocked','completed','cancelled'))
);
create index operational_task_history_task_idx on public.operational_task_history(task_id,created_at);

create table public.operational_task_dependencies (
  task_id uuid not null references public.operational_tasks(id) on delete cascade,
  depends_on_task_id uuid not null references public.operational_tasks(id) on delete restrict,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (task_id,depends_on_task_id),
  constraint operational_task_dependencies_no_self check (task_id <> depends_on_task_id)
);
create index operational_task_dependencies_reverse_idx on public.operational_task_dependencies(depends_on_task_id);

create or replace function public.validate_operational_task_assignment()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.assigned_team_id is not null and not exists (
    select 1 from public.teams t where t.id=new.assigned_team_id and t.is_active=true
  ) then
    raise exception 'TASK_TEAM_INVALID';
  end if;

  if new.assigned_admin_id is not null and not exists (
    select 1 from public.admin_users au where au.id=new.assigned_admin_id and au.is_active=true
  ) then
    raise exception 'TASK_ASSIGNEE_INVALID';
  end if;

  if new.assigned_team_id is not null and new.assigned_admin_id is not null and not exists (
    select 1
    from public.team_memberships tm
    join public.teams t on t.id=tm.team_id and t.is_active=true
    join public.admin_users au on au.id=tm.admin_user_id and au.is_active=true
    where tm.team_id=new.assigned_team_id and tm.admin_user_id=new.assigned_admin_id
  ) then
    raise exception 'TASK_ASSIGNEE_NOT_TEAM_MEMBER';
  end if;

  return new;
end;
$$;

drop trigger if exists operational_tasks_validate_assignment on public.operational_tasks;
create trigger operational_tasks_validate_assignment
before insert or update of assigned_team_id,assigned_admin_id on public.operational_tasks
for each row execute function public.validate_operational_task_assignment();

create or replace function public.touch_operational_task_updated_at()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists operational_tasks_touch_updated_at on public.operational_tasks;
create trigger operational_tasks_touch_updated_at
before update on public.operational_tasks
for each row execute function public.touch_operational_task_updated_at();

create or replace function public.prevent_operational_task_delete()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  raise exception 'TASK_HARD_DELETE_FORBIDDEN';
end;
$$;

drop trigger if exists operational_tasks_no_delete on public.operational_tasks;
create trigger operational_tasks_no_delete
before delete on public.operational_tasks
for each row execute function public.prevent_operational_task_delete();

create or replace function public.prevent_operational_task_append_only_mutation()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  raise exception 'TASK_APPEND_ONLY_RECORD_IMMUTABLE';
end;
$$;

drop trigger if exists operational_task_comments_immutable on public.operational_task_comments;
create trigger operational_task_comments_immutable
before update or delete on public.operational_task_comments
for each row execute function public.prevent_operational_task_append_only_mutation();

drop trigger if exists operational_task_history_immutable on public.operational_task_history;
create trigger operational_task_history_immutable
before update or delete on public.operational_task_history
for each row execute function public.prevent_operational_task_append_only_mutation();

create or replace function public.prevent_operational_task_dependency_cycle()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_cycle boolean;
begin
  if new.task_id=new.depends_on_task_id then
    raise exception 'TASK_DEPENDENCY_SELF_FORBIDDEN';
  end if;

  with recursive dependency_chain(id) as (
    select new.depends_on_task_id
    union
    select d.depends_on_task_id
    from public.operational_task_dependencies d
    join dependency_chain c on c.id=d.task_id
  )
  select exists(select 1 from dependency_chain where id=new.task_id) into v_cycle;

  if v_cycle then
    raise exception 'TASK_DEPENDENCY_CYCLE';
  end if;
  return new;
end;
$$;

drop trigger if exists operational_task_dependencies_no_cycle on public.operational_task_dependencies;
create trigger operational_task_dependencies_no_cycle
before insert on public.operational_task_dependencies
for each row execute function public.prevent_operational_task_dependency_cycle();

create or replace view public.operational_task_workspace
with (security_invoker=true)
as
select t.*,
       (t.due_at is not null and t.due_at < now() and t.status not in ('completed','cancelled')) as is_overdue,
       team.name as assigned_team_name,
       assignee.full_name as assigned_admin_name,
       assignee.username as assigned_admin_username,
       creator.full_name as created_by_name,
       creator.username as created_by_username,
       (select count(*) from public.operational_task_dependencies d where d.task_id=t.id) as dependency_count,
       (select count(*)
          from public.operational_task_dependencies d
          join public.operational_tasks dependency on dependency.id=d.depends_on_task_id
         where d.task_id=t.id and dependency.status<>'completed') as open_dependency_count
from public.operational_tasks t
left join public.teams team on team.id=t.assigned_team_id
left join public.admin_users assignee on assignee.id=t.assigned_admin_id
left join public.admin_users creator on creator.id=t.created_by;

create or replace function public.create_operational_task(
  p_actor uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_due_at timestamptz,
  p_assigned_team_id uuid,
  p_assigned_admin_id uuid,
  p_entity_type text,
  p_entity_id uuid,
  p_origin text,
  p_workflow_key text,
  p_source_event_key text,
  p_dedupe_key text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_username text;
begin
  if p_origin='manual' and p_actor is null then raise exception 'TASK_ACTOR_REQUIRED'; end if;
  if p_actor is not null then
    select username into v_username from public.admin_users where id=p_actor and is_active=true;
    if not found then raise exception 'TASK_ACTOR_INVALID'; end if;
  else
    v_username='Sistema';
  end if;

  if p_origin='workflow' and p_dedupe_key is not null then
    select id into v_id from public.operational_tasks where dedupe_key=p_dedupe_key limit 1;
    if found then return v_id; end if;
  end if;

  begin
    insert into public.operational_tasks(
      title,description,priority,due_at,assigned_team_id,assigned_admin_id,created_by,
      origin,workflow_key,source_event_key,dedupe_key,entity_type,entity_id
    ) values (
      p_title,p_description,coalesce(p_priority,'normal'),p_due_at,p_assigned_team_id,p_assigned_admin_id,p_actor,
      coalesce(p_origin,'manual'),p_workflow_key,p_source_event_key,p_dedupe_key,p_entity_type,p_entity_id
    ) returning id into v_id;
  exception when unique_violation then
    if p_dedupe_key is null then raise; end if;
    select id into v_id from public.operational_tasks where dedupe_key=p_dedupe_key limit 1;
    if v_id is null then raise; end if;
    return v_id;
  end;

  insert into public.operational_task_history(task_id,event_type,actor_admin_id,actor_username,to_status,details)
  values (v_id,'created',p_actor,v_username,'pending',jsonb_build_object(
    'priority',coalesce(p_priority,'normal'),
    'assigned_team_id',p_assigned_team_id,
    'assigned_admin_id',p_assigned_admin_id,
    'entity_type',p_entity_type,
    'entity_id',p_entity_id,
    'origin',coalesce(p_origin,'manual')
  ));
  return v_id;
end;
$$;

create or replace function public.update_operational_task(
  p_task_id uuid,
  p_actor uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_due_at timestamptz,
  p_assigned_team_id uuid,
  p_assigned_admin_id uuid,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.operational_tasks%rowtype;
  v_username text;
begin
  select username into v_username from public.admin_users where id=p_actor and is_active=true;
  if not found then raise exception 'TASK_ACTOR_INVALID'; end if;
  select * into v_old from public.operational_tasks where id=p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;

  update public.operational_tasks
  set title=p_title,
      description=p_description,
      priority=p_priority,
      due_at=p_due_at,
      assigned_team_id=p_assigned_team_id,
      assigned_admin_id=p_assigned_admin_id,
      entity_type=p_entity_type,
      entity_id=p_entity_id
  where id=p_task_id;

  insert into public.operational_task_history(task_id,event_type,actor_admin_id,actor_username,from_status,to_status,details)
  values (p_task_id,'updated',p_actor,v_username,v_old.status,v_old.status,jsonb_build_object(
    'previous',jsonb_build_object('title',v_old.title,'description',v_old.description,'priority',v_old.priority,'due_at',v_old.due_at,'assigned_team_id',v_old.assigned_team_id,'assigned_admin_id',v_old.assigned_admin_id,'entity_type',v_old.entity_type,'entity_id',v_old.entity_id),
    'current',jsonb_build_object('title',p_title,'description',p_description,'priority',p_priority,'due_at',p_due_at,'assigned_team_id',p_assigned_team_id,'assigned_admin_id',p_assigned_admin_id,'entity_type',p_entity_type,'entity_id',p_entity_id)
  ));
end;
$$;

create or replace function public.transition_operational_task(
  p_task_id uuid,
  p_actor uuid,
  p_to_status text,
  p_reason text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old public.operational_tasks%rowtype;
  v_username text;
  v_allowed boolean:=false;
begin
  select username into v_username from public.admin_users where id=p_actor and is_active=true;
  if not found then raise exception 'TASK_ACTOR_INVALID'; end if;
  select * into v_old from public.operational_tasks where id=p_task_id for update;
  if not found then raise exception 'TASK_NOT_FOUND'; end if;
  if p_to_status not in ('pending','in_progress','blocked','completed','cancelled') then raise exception 'TASK_STATUS_INVALID'; end if;
  if p_to_status=v_old.status then return; end if;

  v_allowed := case v_old.status
    when 'pending' then p_to_status in ('in_progress','blocked','completed','cancelled')
    when 'in_progress' then p_to_status in ('pending','blocked','completed','cancelled')
    when 'blocked' then p_to_status in ('pending','in_progress','completed','cancelled')
    when 'completed' then p_to_status='pending'
    when 'cancelled' then p_to_status='pending'
    else false end;
  if not v_allowed then raise exception 'TASK_TRANSITION_INVALID'; end if;
  if p_to_status in ('blocked','cancelled') and btrim(coalesce(p_reason,''))='' then raise exception 'TASK_REASON_REQUIRED'; end if;

  update public.operational_tasks
  set status=p_to_status,
      blocked_reason=case when p_to_status='blocked' then btrim(p_reason) else null end,
      cancelled_reason=case when p_to_status='cancelled' then btrim(p_reason) else null end,
      started_at=case when p_to_status='in_progress' then coalesce(started_at,now()) else started_at end,
      completed_at=case when p_to_status='completed' then now() else null end,
      cancelled_at=case when p_to_status='cancelled' then now() else null end
  where id=p_task_id;

  insert into public.operational_task_history(task_id,event_type,actor_admin_id,actor_username,from_status,to_status,details)
  values (p_task_id,'transitioned',p_actor,v_username,v_old.status,p_to_status,jsonb_build_object('reason',nullif(btrim(coalesce(p_reason,'')),'')));
end;
$$;

create or replace function public.add_operational_task_comment(
  p_task_id uuid,
  p_actor uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_comment_id uuid;
  v_username text;
begin
  if not exists(select 1 from public.operational_tasks where id=p_task_id) then raise exception 'TASK_NOT_FOUND'; end if;
  select username into v_username from public.admin_users where id=p_actor and is_active=true;
  if not found then raise exception 'TASK_ACTOR_INVALID'; end if;
  if btrim(coalesce(p_body,''))='' then raise exception 'TASK_COMMENT_REQUIRED'; end if;

  insert into public.operational_task_comments(task_id,author_admin_id,author_username,body)
  values (p_task_id,p_actor,v_username,btrim(p_body)) returning id into v_comment_id;
  insert into public.operational_task_history(task_id,event_type,actor_admin_id,actor_username,details)
  values (p_task_id,'commented',p_actor,v_username,jsonb_build_object('comment_id',v_comment_id));
  return v_comment_id;
end;
$$;

create or replace function public.set_operational_task_dependencies(
  p_task_id uuid,
  p_depends_on_task_ids uuid[],
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_username text;
  v_invalid integer;
begin
  if not exists(select 1 from public.operational_tasks where id=p_task_id) then raise exception 'TASK_NOT_FOUND'; end if;
  select username into v_username from public.admin_users where id=p_actor and is_active=true;
  if not found then raise exception 'TASK_ACTOR_INVALID'; end if;

  if p_task_id=any(coalesce(p_depends_on_task_ids,array[]::uuid[])) then raise exception 'TASK_DEPENDENCY_SELF_FORBIDDEN'; end if;
  select count(*) into v_invalid
  from unnest(coalesce(p_depends_on_task_ids,array[]::uuid[])) x(id)
  left join public.operational_tasks t on t.id=x.id
  where t.id is null;
  if v_invalid>0 then raise exception 'TASK_DEPENDENCY_INVALID'; end if;

  delete from public.operational_task_dependencies where task_id=p_task_id;
  insert into public.operational_task_dependencies(task_id,depends_on_task_id,created_by)
  select p_task_id,x.id,p_actor
  from (select distinct unnest(coalesce(p_depends_on_task_ids,array[]::uuid[])) as id) x;

  insert into public.operational_task_history(task_id,event_type,actor_admin_id,actor_username,details)
  values (p_task_id,'dependencies_changed',p_actor,v_username,jsonb_build_object('dependency_ids',coalesce(p_depends_on_task_ids,array[]::uuid[])));
end;
$$;

alter table public.operational_tasks enable row level security;
alter table public.operational_task_comments enable row level security;
alter table public.operational_task_history enable row level security;
alter table public.operational_task_dependencies enable row level security;

revoke all on table public.operational_tasks from public,anon,authenticated;
revoke all on table public.operational_task_comments from public,anon,authenticated;
revoke all on table public.operational_task_history from public,anon,authenticated;
revoke all on table public.operational_task_dependencies from public,anon,authenticated;
revoke all on table public.operational_task_workspace from public,anon,authenticated;

grant select,insert,update on table public.operational_tasks to service_role;
grant select,insert on table public.operational_task_comments to service_role;
grant select,insert on table public.operational_task_history to service_role;
grant select,insert,delete on table public.operational_task_dependencies to service_role;
grant select on table public.operational_task_workspace to service_role;

revoke execute on function public.validate_operational_task_assignment() from public,anon,authenticated;
revoke execute on function public.touch_operational_task_updated_at() from public,anon,authenticated;
revoke execute on function public.prevent_operational_task_delete() from public,anon,authenticated;
revoke execute on function public.prevent_operational_task_append_only_mutation() from public,anon,authenticated;
revoke execute on function public.prevent_operational_task_dependency_cycle() from public,anon,authenticated;

revoke execute on function public.create_operational_task(uuid,text,text,text,timestamptz,uuid,uuid,text,uuid,text,text,text,text) from public,anon,authenticated;
revoke execute on function public.update_operational_task(uuid,uuid,text,text,text,timestamptz,uuid,uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.transition_operational_task(uuid,uuid,text,text) from public,anon,authenticated;
revoke execute on function public.add_operational_task_comment(uuid,uuid,text) from public,anon,authenticated;
revoke execute on function public.set_operational_task_dependencies(uuid,uuid[],uuid) from public,anon,authenticated;

grant execute on function public.create_operational_task(uuid,text,text,text,timestamptz,uuid,uuid,text,uuid,text,text,text,text) to service_role;
grant execute on function public.update_operational_task(uuid,uuid,text,text,text,timestamptz,uuid,uuid,text,uuid) to service_role;
grant execute on function public.transition_operational_task(uuid,uuid,text,text) to service_role;
grant execute on function public.add_operational_task_comment(uuid,uuid,text) to service_role;
grant execute on function public.set_operational_task_dependencies(uuid,uuid[],uuid) to service_role;