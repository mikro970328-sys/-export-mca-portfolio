-- Preserve explicit task assignment across workflow reconciliation and reopening.
-- Existing RPC signatures, row locks, assignment validation and service-role boundary remain.
alter table public.operational_tasks
  add column workflow_assignment_manual boolean not null default false;
comment on column public.operational_tasks.workflow_assignment_manual is
  'An operator changed this workflow task assignment; reconciliation preserves it, including null assignments and reopening.';

-- Preserve an existing assignment only when its last recorded manual assignment
-- change matches the current row. Never restore an assignee already overwritten.
with latest_manual as (
  select distinct on (task_id) task_id, details
  from public.operational_task_history
  where event_type='updated' and actor_admin_id is not null
    and (details->'previous'->'assigned_admin_id' is distinct from details->'current'->'assigned_admin_id'
      or details->'previous'->'assigned_team_id' is distinct from details->'current'->'assigned_team_id')
  order by task_id,created_at desc,id desc
)
update public.operational_tasks t set workflow_assignment_manual=true
from latest_manual h
where t.id=h.task_id and t.origin='workflow'
  and (h.details->'current'->>'assigned_admin_id') is not distinct from t.assigned_admin_id::text
  and (h.details->'current'->>'assigned_team_id') is not distinct from t.assigned_team_id::text;

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
      workflow_assignment_manual=v_old.workflow_assignment_manual or (v_old.origin='workflow' and (v_old.assigned_team_id is distinct from p_assigned_team_id or v_old.assigned_admin_id is distinct from p_assigned_admin_id)),
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

-- P5 · El reconciliador respeta dependencias P4 y se reevalúa cuando una dependencia termina.

create or replace function public.sync_workflow_task(
  p_workflow_key text,
  p_entity_type text,
  p_entity_id uuid,
  p_should_open boolean,
  p_title text,
  p_description text,
  p_source_event_key text,
  p_due_at timestamptz default null,
  p_resolution text default 'complete'
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_route public.workflow_task_routes%rowtype;
  v_task public.operational_tasks%rowtype;
  v_dedupe text;
  v_due_at timestamptz;
  v_changed boolean:=false;
  v_assigned_team_id uuid;
  v_assigned_admin_id uuid;
  v_has_open_dependencies boolean:=false;
begin
  if btrim(coalesce(p_workflow_key,''))='' then raise exception 'WORKFLOW_KEY_REQUIRED'; end if;
  if p_entity_id is null or btrim(coalesce(p_entity_type,''))='' then raise exception 'WORKFLOW_ENTITY_REQUIRED'; end if;
  if btrim(coalesce(p_source_event_key,''))='' then raise exception 'WORKFLOW_SOURCE_EVENT_REQUIRED'; end if;
  if p_resolution not in ('complete','cancel') then raise exception 'WORKFLOW_RESOLUTION_INVALID'; end if;

  select * into v_route from public.workflow_task_routes where workflow_key=p_workflow_key for share;
  if not found then raise exception 'WORKFLOW_ROUTE_NOT_FOUND'; end if;

  v_dedupe := 'workflow:' || p_workflow_key || ':' || p_entity_type || ':' || p_entity_id::text;
  select * into v_task from public.operational_tasks where dedupe_key=v_dedupe for update;

  if v_route.enabled is not true then
    if found and v_task.status in ('pending','in_progress','blocked') then
      update public.operational_tasks
      set status='cancelled',blocked_reason=null,cancelled_reason='Ruta de handoff desactivada',completed_at=null,cancelled_at=now(),source_event_key=p_source_event_key
      where id=v_task.id;
      insert into public.operational_task_history(task_id,event_type,actor_username,from_status,to_status,details)
      values(v_task.id,'workflow_cancelled','Sistema',v_task.status,'cancelled',jsonb_build_object('workflow_key',p_workflow_key,'reason','route_disabled'));
    end if;
    return case when found then v_task.id else null end;
  end if;

  if p_should_open then
    if not found then
      v_due_at := coalesce(p_due_at, case when v_route.default_due_hours is not null then now()+make_interval(hours=>v_route.default_due_hours) end);
      insert into public.operational_tasks(title,description,status,priority,due_at,assigned_team_id,assigned_admin_id,created_by,origin,workflow_key,source_event_key,dedupe_key,entity_type,entity_id)
      values(btrim(p_title),nullif(btrim(coalesce(p_description,'')),''),'pending',v_route.default_priority,v_due_at,v_route.assigned_team_id,v_route.assigned_admin_id,null,'workflow',p_workflow_key,p_source_event_key,v_dedupe,p_entity_type,p_entity_id)
      returning * into v_task;
      insert into public.operational_task_history(task_id,event_type,actor_username,to_status,details)
      values(v_task.id,'workflow_created','Sistema','pending',jsonb_build_object('workflow_key',p_workflow_key,'source_event_key',p_source_event_key));
      return v_task.id;
    end if;

    -- Route defaults apply until an operator explicitly changes the assignment.
    v_assigned_team_id := case when v_task.workflow_assignment_manual then v_task.assigned_team_id else v_route.assigned_team_id end;
    v_assigned_admin_id := case when v_task.workflow_assignment_manual then v_task.assigned_admin_id else v_route.assigned_admin_id end;

    if v_task.status in ('completed','cancelled') then
      v_due_at := coalesce(p_due_at, case when v_route.default_due_hours is not null then now()+make_interval(hours=>v_route.default_due_hours) end);
      update public.operational_tasks
      set title=btrim(p_title),description=nullif(btrim(coalesce(p_description,'')),''),status='pending',priority=v_route.default_priority,due_at=v_due_at,
          assigned_team_id=v_assigned_team_id,assigned_admin_id=v_assigned_admin_id,source_event_key=p_source_event_key,
          blocked_reason=null,cancelled_reason=null,completed_at=null,cancelled_at=null
      where id=v_task.id;
      insert into public.operational_task_history(task_id,event_type,actor_username,from_status,to_status,details)
      values(v_task.id,'workflow_reopened','Sistema',v_task.status,'pending',jsonb_build_object('workflow_key',p_workflow_key,'source_event_key',p_source_event_key));
      return v_task.id;
    end if;

    v_due_at := coalesce(p_due_at,v_task.due_at);
    v_changed := v_task.title is distinct from btrim(p_title)
      or v_task.description is distinct from nullif(btrim(coalesce(p_description,'')),'')
      or v_task.due_at is distinct from v_due_at
      or v_task.assigned_team_id is distinct from v_assigned_team_id
      or v_task.assigned_admin_id is distinct from v_assigned_admin_id
      or v_task.source_event_key is distinct from p_source_event_key;
    update public.operational_tasks
    set title=btrim(p_title),description=nullif(btrim(coalesce(p_description,'')),''),due_at=v_due_at,
        assigned_team_id=v_assigned_team_id,assigned_admin_id=v_assigned_admin_id,source_event_key=p_source_event_key
    where id=v_task.id;
    if v_changed then
      insert into public.operational_task_history(task_id,event_type,actor_username,details)
      values(v_task.id,'workflow_updated','Sistema',jsonb_build_object('workflow_key',p_workflow_key,'source_event_key',p_source_event_key));
    end if;
    return v_task.id;
  end if;

  if found and v_task.status in ('pending','in_progress','blocked') then
    if p_resolution='cancel' then
      update public.operational_tasks
      set status='cancelled',blocked_reason=null,cancelled_reason='El trabajo dejó de ser aplicable',completed_at=null,cancelled_at=now(),source_event_key=p_source_event_key
      where id=v_task.id;
      insert into public.operational_task_history(task_id,event_type,actor_username,from_status,to_status,details)
      values(v_task.id,'workflow_cancelled','Sistema',v_task.status,'cancelled',jsonb_build_object('workflow_key',p_workflow_key,'source_event_key',p_source_event_key));
    else
      select exists(
        select 1
        from public.operational_task_dependencies d
        join public.operational_tasks dependency on dependency.id=d.depends_on_task_id
        where d.task_id=v_task.id and dependency.status<>'completed'
      ) into v_has_open_dependencies;
      if v_has_open_dependencies then
        if v_task.source_event_key is distinct from p_source_event_key then
          update public.operational_tasks set source_event_key=p_source_event_key where id=v_task.id;
          insert into public.operational_task_history(task_id,event_type,actor_username,details)
          values(v_task.id,'workflow_waiting_dependencies','Sistema',jsonb_build_object('workflow_key',p_workflow_key,'source_event_key',p_source_event_key));
        end if;
        return v_task.id;
      end if;
      update public.operational_tasks
      set status='completed',blocked_reason=null,cancelled_reason=null,completed_at=now(),cancelled_at=null,source_event_key=p_source_event_key
      where id=v_task.id;
      insert into public.operational_task_history(task_id,event_type,actor_username,from_status,to_status,details)
      values(v_task.id,'workflow_completed','Sistema',v_task.status,'completed',jsonb_build_object('workflow_key',p_workflow_key,'source_event_key',p_source_event_key));
    end if;
  end if;
  return case when found then v_task.id else null end;
end;
$$;


revoke execute on function public.sync_workflow_task(text,text,uuid,boolean,text,text,text,timestamptz,text) from public,anon,authenticated;
revoke execute on function public.update_operational_task(uuid,uuid,text,text,text,timestamptz,uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.sync_workflow_task(text,text,uuid,boolean,text,text,text,timestamptz,text) to service_role;
grant execute on function public.update_operational_task(uuid,uuid,text,text,text,timestamptz,uuid,uuid,text,uuid) to service_role;
