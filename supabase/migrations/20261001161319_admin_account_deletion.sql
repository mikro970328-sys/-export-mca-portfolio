-- Delete login accounts while keeping credential-free references in business history.
set local lock_timeout = '8s';
set local statement_timeout = '45s';

create table private.admin_actor_identities (
  id uuid primary key
);
alter table private.admin_actor_identities enable row level security;
revoke all on table private.admin_actor_identities from public,anon,authenticated,service_role;
comment on table private.admin_actor_identities is
  'Credential-free UUID anchors for historical authors. Contains no profile, login, permissions or session state.';

insert into private.admin_actor_identities(id) select id from public.admin_users;

create function private.register_admin_actor_identity()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
begin
  if tg_table_schema <> 'public' or tg_table_name <> 'admin_users' or tg_op <> 'INSERT' then
    raise exception 'ADMIN_ACTOR_TRIGGER_INVALID';
  end if;
  insert into private.admin_actor_identities(id) values(new.id) on conflict(id) do nothing;
  return new;
end;
$$;
revoke all on function private.register_admin_actor_identity() from public,anon,authenticated,service_role;
create trigger admin_users_register_actor_identity
before insert on public.admin_users
for each row execute function private.register_admin_actor_identity();

alter table public.admin_users add constraint admin_users_actor_identity_fkey
foreign key(id) references private.admin_actor_identities(id);

-- Historical author references must not update append-only audit, payment or
-- credit-note rows when a credential row is deleted. Assignment/recipient FKs
-- continue to reference admin_users and therefore require a real account.
do $$
declare
  ref record;
  definition text;
begin
  for ref in
    select c.conname,c.conrelid,pg_get_constraintdef(c.oid) as definition,a.attname
    from pg_constraint c
    join pg_attribute a on a.attrelid=c.conrelid and a.attnum=c.conkey[1]
    where c.contype='f' and c.confrelid='public.admin_users'::regclass
      and array_length(c.conkey,1)=1
      and a.attname in ('created_by','updated_by','actor_admin_id','author_admin_id',
        'posted_by','voided_by','reversed_by','issued_by','dispatched_by',
        'deleted_by_admin_id','uploaded_by_admin_id')
    order by c.conrelid,c.conname
  loop
    definition := regexp_replace(ref.definition,
      'REFERENCES (public\.)?admin_users\(id\)',
      'REFERENCES private.admin_actor_identities(id)');
    if definition=ref.definition then raise exception 'ADMIN_ACTOR_REFERENCE_UNEXPECTED: %',ref.conname; end if;
    execute format('alter table %s drop constraint %I',ref.conrelid::regclass,ref.conname);
    execute format('alter table %s add constraint %I %s',ref.conrelid::regclass,ref.conname,definition);
  end loop;
end;
$$;

create function private.delete_admin_account_with_audit(
  p_admin_user_id uuid,
  p_actor uuid,
  p_confirm_username text
)
returns table(deleted_id uuid,deleted_username text,unassigned_tasks integer,unassigned_routes integer,removed_devices integer)
language plpgsql
security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  actor_username text;
  target public.admin_users%rowtype;
  task_count integer := 0;
  route_count integer := 0;
  device_count integer := 0;
  route_keys jsonb;
begin
  select a.username into actor_username from public.admin_users a
  where a.id=p_actor and a.is_active and a.role='master_admin' for share;
  if not found then raise exception 'ADMIN_PERMISSION_DENIED'; end if;
  if p_admin_user_id=p_actor then raise exception 'SELF_DELETION_FORBIDDEN'; end if;
  select a.* into target from public.admin_users a where a.id=p_admin_user_id for update;
  if not found then raise exception 'ADMIN_USER_NOT_FOUND'; end if;
  if target.role='master_admin' then raise exception 'MASTER_ADMIN_DELETE_FORBIDDEN'; end if;
  if lower(btrim(coalesce(p_confirm_username,''))) <> lower(target.username) then
    raise exception 'ADMIN_DELETE_CONFIRMATION_REQUIRED';
  end if;

  perform public.revoke_admin_sessions(p_admin_user_id,p_actor,'Eliminación de cuenta');

  with affected as (
    select t.* from public.operational_tasks t where t.assigned_admin_id=p_admin_user_id for update
  ), changed as (
    update public.operational_tasks t
    set assigned_admin_id=null,
      assigned_team_id=case when exists(select 1 from public.teams g where g.id=t.assigned_team_id and g.is_active) then t.assigned_team_id else null end,
      workflow_assignment_manual=t.workflow_assignment_manual or t.origin='workflow'
    from affected old where t.id=old.id
    returning t.id,t.status,old.assigned_team_id as previous_team,t.assigned_team_id as current_team
  )
  insert into public.operational_task_history(task_id,event_type,actor_admin_id,actor_username,from_status,to_status,details)
  select c.id,'updated',p_actor,actor_username,c.status,c.status,jsonb_build_object(
    'reason','account_deleted',
    'previous',jsonb_build_object('assigned_admin_id',p_admin_user_id,'assigned_team_id',c.previous_team),
    'current',jsonb_build_object('assigned_admin_id',null,'assigned_team_id',c.current_team))
  from changed c;
  get diagnostics task_count=row_count;

  with changed as (
    update public.workflow_task_routes r
    set assigned_admin_id=null,
      assigned_team_id=case when exists(select 1 from public.teams g where g.id=r.assigned_team_id and g.is_active) then r.assigned_team_id else null end,
      updated_by=p_actor
    where r.assigned_admin_id=p_admin_user_id returning r.workflow_key
  ) select count(*)::integer,coalesce(jsonb_agg(workflow_key),'[]'::jsonb) into route_count,route_keys from changed;

  update public.commercial_publications set assigned_admin_id=null where assigned_admin_id=p_admin_user_id;

  -- Remove queued deliveries before their recipients, inbox entries and devices.
  delete from public.push_delivery_queue q where q.recipient_admin_id=p_admin_user_id
    or q.subscription_id in (select s.id from public.push_subscriptions s where s.admin_user_id=p_admin_user_id)
    or q.inbox_item_id in (select i.id from public.notification_inbox_items i where i.recipient_admin_id=p_admin_user_id);
  delete from public.notification_channel_deliveries d where d.inbox_item_id in
    (select i.id from public.notification_inbox_items i where i.recipient_admin_id=p_admin_user_id);
  delete from public.notification_inbox_items where recipient_admin_id=p_admin_user_id;
  delete from public.push_subscriptions where admin_user_id=p_admin_user_id;
  get diagnostics device_count=row_count;
  delete from public.notification_preferences where admin_user_id=p_admin_user_id;
  delete from public.team_memberships where admin_user_id=p_admin_user_id;
  delete from public.admin_users where id=p_admin_user_id;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,actor_username,'delete_admin','admin_user',p_admin_user_id,jsonb_build_object(
    'username',target.username,'sessions_revoked',true,'unassigned_tasks',task_count,
    'unassigned_routes',route_count,'workflow_keys',route_keys,'removed_devices',device_count));
  return query select p_admin_user_id,target.username,task_count,route_count,device_count;
end;
$$;
revoke all on function private.delete_admin_account_with_audit(uuid,uuid,text) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.delete_admin_account_with_audit(uuid,uuid,text) to service_role;

create function public.delete_admin_account_with_audit(
  p_admin_user_id uuid,
  p_actor uuid,
  p_confirm_username text
)
returns table(deleted_id uuid,deleted_username text,unassigned_tasks integer,unassigned_routes integer,removed_devices integer)
language sql
security invoker
set search_path=pg_catalog,public,pg_temp
as $$ select * from private.delete_admin_account_with_audit(p_admin_user_id,p_actor,p_confirm_username); $$;
revoke all on function public.delete_admin_account_with_audit(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.delete_admin_account_with_audit(uuid,uuid,text) to service_role;
