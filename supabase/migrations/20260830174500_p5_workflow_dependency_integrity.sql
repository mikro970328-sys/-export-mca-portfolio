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

    if v_task.status in ('completed','cancelled') then
      v_due_at := coalesce(p_due_at, case when v_route.default_due_hours is not null then now()+make_interval(hours=>v_route.default_due_hours) end);
      update public.operational_tasks
      set title=btrim(p_title),description=nullif(btrim(coalesce(p_description,'')),''),status='pending',priority=v_route.default_priority,due_at=v_due_at,
          assigned_team_id=v_route.assigned_team_id,assigned_admin_id=v_route.assigned_admin_id,source_event_key=p_source_event_key,
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
      or v_task.assigned_team_id is distinct from v_route.assigned_team_id
      or v_task.assigned_admin_id is distinct from v_route.assigned_admin_id
      or v_task.source_event_key is distinct from p_source_event_key;
    update public.operational_tasks
    set title=btrim(p_title),description=nullif(btrim(coalesce(p_description,'')),''),due_at=v_due_at,
        assigned_team_id=v_route.assigned_team_id,assigned_admin_id=v_route.assigned_admin_id,source_event_key=p_source_event_key
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

create or replace function public.reconcile_workflow_task_by_task_id(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.operational_tasks%rowtype;
begin
  select * into v from public.operational_tasks where id=p_task_id;
  if not found or v.origin<>'workflow' then return; end if;
  case v.entity_type
    when 'sales_order' then perform public.reconcile_sales_order_workflow_tasks(v.entity_id);
    when 'purchase_order' then perform public.reconcile_purchase_order_workflow_tasks(v.entity_id);
    when 'shipment' then perform public.reconcile_shipment_workflow_tasks(v.entity_id,true);
    when 'invoice' then perform public.reconcile_invoice_workflow_tasks(v.entity_id);
    when 'supplier_bill' then perform public.reconcile_supplier_bill_workflow_tasks(v.entity_id);
    else null;
  end case;
end;
$$;

create or replace function public.workflow_reconcile_dependents_after_task_completion()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  r record;
begin
  if new.status='completed' and old.status is distinct from new.status then
    for r in
      select dependent.id
      from public.operational_task_dependencies d
      join public.operational_tasks dependent on dependent.id=d.task_id
      where d.depends_on_task_id=new.id and dependent.origin='workflow' and dependent.status in ('pending','in_progress','blocked')
    loop
      perform public.reconcile_workflow_task_by_task_id(r.id);
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists workflow_tasks_reconcile_dependents on public.operational_tasks;
create trigger workflow_tasks_reconcile_dependents
after update of status on public.operational_tasks
for each row execute function public.workflow_reconcile_dependents_after_task_completion();

revoke execute on function public.sync_workflow_task(text,text,uuid,boolean,text,text,text,timestamptz,text) from public,anon,authenticated;
revoke execute on function public.reconcile_workflow_task_by_task_id(uuid) from public,anon,authenticated;
grant execute on function public.sync_workflow_task(text,text,uuid,boolean,text,text,text,timestamptz,text) to service_role;
grant execute on function public.reconcile_workflow_task_by_task_id(uuid) to service_role;
