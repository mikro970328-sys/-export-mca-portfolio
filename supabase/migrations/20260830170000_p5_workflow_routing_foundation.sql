-- P5 · Routing y reconciliador genérico de handoffs operativos.

create table if not exists public.workflow_task_routes (
  workflow_key text primary key,
  label text not null,
  description text,
  enabled boolean not null default true,
  default_priority text not null default 'normal' check (default_priority in ('low','normal','high','critical')),
  default_due_hours integer check (default_due_hours is null or default_due_hours between 1 and 8760),
  assigned_team_id uuid references public.teams(id) on delete restrict,
  assigned_admin_id uuid references public.admin_users(id) on delete restrict,
  activated_at timestamptz not null default now(),
  is_system boolean not null default true,
  updated_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workflow_task_routes_key_not_blank check (btrim(workflow_key) <> ''),
  constraint workflow_task_routes_label_not_blank check (btrim(label) <> '')
);

comment on table public.workflow_task_routes is 'Configuration of system workflow handoffs. Assignment may remain null until a real team/user is configured.';

create index if not exists workflow_task_routes_team_idx on public.workflow_task_routes(assigned_team_id) where assigned_team_id is not null;
create index if not exists workflow_task_routes_admin_idx on public.workflow_task_routes(assigned_admin_id) where assigned_admin_id is not null;
create index if not exists workflow_task_routes_updated_by_idx on public.workflow_task_routes(updated_by) where updated_by is not null;

create or replace function public.validate_workflow_task_route_assignment()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_team_active boolean;
  v_admin_active boolean;
begin
  if new.assigned_team_id is not null then
    select is_active into v_team_active from public.teams where id=new.assigned_team_id;
    if not found or v_team_active is not true then raise exception 'WORKFLOW_ROUTE_TEAM_INVALID'; end if;
  end if;
  if new.assigned_admin_id is not null then
    select is_active into v_admin_active from public.admin_users where id=new.assigned_admin_id;
    if not found or v_admin_active is not true then raise exception 'WORKFLOW_ROUTE_ASSIGNEE_INVALID'; end if;
  end if;
  if new.assigned_team_id is not null and new.assigned_admin_id is not null and not exists (
    select 1 from public.team_memberships tm
    where tm.team_id=new.assigned_team_id and tm.admin_user_id=new.assigned_admin_id
  ) then
    raise exception 'WORKFLOW_ROUTE_ASSIGNEE_NOT_TEAM_MEMBER';
  end if;
  new.updated_at=now();
  return new;
end;
$$;

drop trigger if exists workflow_task_routes_validate_assignment on public.workflow_task_routes;
create trigger workflow_task_routes_validate_assignment
before insert or update on public.workflow_task_routes
for each row execute function public.validate_workflow_task_route_assignment();

insert into public.workflow_task_routes(workflow_key,label,description,default_priority,default_due_hours,is_system)
values
  ('sales_supply_planning','Planificar abastecimiento','Venta confirmada con abastecimiento sin planificar o parcialmente planificado.','high',8,true),
  ('sales_procurement_linkage','Vincular compra','Abastecimiento por compra que todavía no está vinculado explícitamente a una orden de compra.','high',8,true),
  ('purchase_receipt','Recibir compra','Orden de compra destinada a almacén con recepción pendiente o parcial.','high',24,true),
  ('direct_fulfillment','Coordinar Direct Ship','Compra directa vinculada a venta que todavía requiere contenedor y/o despacho físico.','high',12,true),
  ('prepare_load','Preparar Cargue','Mercancía no-directa lista para logística y todavía pendiente de despacho.','high',12,true),
  ('shipment_cuba_documents','Completar documentos Cuba','Contenedor que requiere documentos oficiales Cuba y todavía no está READY.','critical',4,true),
  ('sales_invoice','Emitir factura','Venta totalmente despachada que todavía tiene importe pendiente de facturar.','high',8,true),
  ('invoice_collection','Cobrar saldo','Factura emitida con saldo pendiente de cobro.','high',24,true),
  ('supplier_bill_payment','Pagar factura proveedor','Factura de proveedor contabilizada con saldo pendiente.','high',24,true)
on conflict (workflow_key) do update set
  label=excluded.label,
  description=excluded.description,
  is_system=true;

alter table public.workflow_task_routes enable row level security;
revoke all on public.workflow_task_routes from public,anon,authenticated;
grant select,insert,update on public.workflow_task_routes to service_role;

create or replace view public.workflow_task_route_directory
with (security_invoker=true)
as
select
  r.workflow_key,
  r.label,
  r.description,
  r.enabled,
  r.default_priority,
  r.default_due_hours,
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
  count(ot.id) filter (where ot.status in ('pending','in_progress','blocked'))::integer as active_task_count
from public.workflow_task_routes r
left join public.teams t on t.id=r.assigned_team_id
left join public.admin_users a on a.id=r.assigned_admin_id
left join public.operational_tasks ot on ot.origin='workflow' and ot.workflow_key=r.workflow_key
group by r.workflow_key,r.label,r.description,r.enabled,r.default_priority,r.default_due_hours,r.assigned_team_id,t.name,r.assigned_admin_id,a.username,a.full_name,r.activated_at,r.is_system,r.updated_by,r.created_at,r.updated_at;

revoke all on public.workflow_task_route_directory from public,anon,authenticated;
grant select on public.workflow_task_route_directory to service_role;

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
      set status='cancelled',
          blocked_reason=null,
          cancelled_reason='Ruta de handoff desactivada',
          completed_at=null,
          cancelled_at=now(),
          source_event_key=p_source_event_key
      where id=v_task.id;
      insert into public.operational_task_history(task_id,event_type,actor_username,from_status,to_status,details)
      values(v_task.id,'workflow_cancelled','Sistema',v_task.status,'cancelled',jsonb_build_object('workflow_key',p_workflow_key,'reason','route_disabled'));
    end if;
    return case when found then v_task.id else null end;
  end if;

  if p_should_open then
    if not found then
      v_due_at := coalesce(p_due_at, case when v_route.default_due_hours is not null then now()+make_interval(hours=>v_route.default_due_hours) end);
      insert into public.operational_tasks(
        title,description,status,priority,due_at,assigned_team_id,assigned_admin_id,created_by,
        origin,workflow_key,source_event_key,dedupe_key,entity_type,entity_id
      ) values(
        btrim(p_title),nullif(btrim(coalesce(p_description,'')),''),'pending',v_route.default_priority,v_due_at,
        v_route.assigned_team_id,v_route.assigned_admin_id,null,
        'workflow',p_workflow_key,p_source_event_key,v_dedupe,p_entity_type,p_entity_id
      ) returning * into v_task;
      insert into public.operational_task_history(task_id,event_type,actor_username,to_status,details)
      values(v_task.id,'workflow_created','Sistema','pending',jsonb_build_object('workflow_key',p_workflow_key,'source_event_key',p_source_event_key));
      return v_task.id;
    end if;

    if v_task.status in ('completed','cancelled') then
      v_due_at := coalesce(p_due_at, case when v_route.default_due_hours is not null then now()+make_interval(hours=>v_route.default_due_hours) end);
      update public.operational_tasks
      set title=btrim(p_title),
          description=nullif(btrim(coalesce(p_description,'')),''),
          status='pending',
          priority=v_route.default_priority,
          due_at=v_due_at,
          assigned_team_id=v_route.assigned_team_id,
          assigned_admin_id=v_route.assigned_admin_id,
          source_event_key=p_source_event_key,
          blocked_reason=null,
          cancelled_reason=null,
          completed_at=null,
          cancelled_at=null
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
    set title=btrim(p_title),
        description=nullif(btrim(coalesce(p_description,'')),''),
        due_at=v_due_at,
        assigned_team_id=v_route.assigned_team_id,
        assigned_admin_id=v_route.assigned_admin_id,
        source_event_key=p_source_event_key
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

create or replace function public.update_workflow_task_route(
  p_workflow_key text,
  p_actor uuid,
  p_enabled boolean,
  p_default_priority text,
  p_default_due_hours integer,
  p_assigned_team_id uuid,
  p_assigned_admin_id uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_username text;
begin
  select username into v_username from public.admin_users where id=p_actor and is_active=true;
  if not found then raise exception 'WORKFLOW_ROUTE_ACTOR_INVALID'; end if;
  if p_default_priority not in ('low','normal','high','critical') then raise exception 'WORKFLOW_ROUTE_PRIORITY_INVALID'; end if;
  if p_default_due_hours is not null and (p_default_due_hours<1 or p_default_due_hours>8760) then raise exception 'WORKFLOW_ROUTE_DUE_INVALID'; end if;

  update public.workflow_task_routes
  set enabled=p_enabled,
      default_priority=p_default_priority,
      default_due_hours=p_default_due_hours,
      assigned_team_id=p_assigned_team_id,
      assigned_admin_id=p_assigned_admin_id,
      updated_by=p_actor
  where workflow_key=p_workflow_key;
  if not found then raise exception 'WORKFLOW_ROUTE_NOT_FOUND'; end if;

  if p_enabled then
    update public.operational_tasks
    set assigned_team_id=p_assigned_team_id,
        assigned_admin_id=p_assigned_admin_id,
        priority=p_default_priority
    where origin='workflow' and workflow_key=p_workflow_key and status in ('pending','in_progress','blocked');
  else
    with affected as (
      select id,status from public.operational_tasks
      where origin='workflow' and workflow_key=p_workflow_key and status in ('pending','in_progress','blocked')
      for update
    ), changed as (
      update public.operational_tasks t
      set status='cancelled',blocked_reason=null,cancelled_reason='Ruta de handoff desactivada',completed_at=null,cancelled_at=now()
      from affected a where t.id=a.id
      returning t.id,a.status
    )
    insert into public.operational_task_history(task_id,event_type,actor_admin_id,actor_username,from_status,to_status,details)
    select id,'workflow_cancelled',p_actor,v_username,status,'cancelled',jsonb_build_object('workflow_key',p_workflow_key,'reason','route_disabled') from changed;
  end if;
end;
$$;

revoke execute on function public.sync_workflow_task(text,text,uuid,boolean,text,text,text,timestamptz,text) from public,anon,authenticated;
revoke execute on function public.update_workflow_task_route(text,uuid,boolean,text,integer,uuid,uuid) from public,anon,authenticated;
grant execute on function public.sync_workflow_task(text,text,uuid,boolean,text,text,text,timestamptz,text) to service_role;
grant execute on function public.update_workflow_task_route(text,uuid,boolean,text,integer,uuid,uuid) to service_role;
