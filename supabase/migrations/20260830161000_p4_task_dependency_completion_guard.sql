-- P4 · Una tarea no puede completarse mientras existan dependencias sin completar.
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

  if p_to_status='completed' and exists (
    select 1
    from public.operational_task_dependencies d
    join public.operational_tasks dependency on dependency.id=d.depends_on_task_id
    where d.task_id=p_task_id and dependency.status<>'completed'
  ) then
    raise exception 'TASK_OPEN_DEPENDENCIES';
  end if;

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

revoke execute on function public.transition_operational_task(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.transition_operational_task(uuid,uuid,text,text) to service_role;
