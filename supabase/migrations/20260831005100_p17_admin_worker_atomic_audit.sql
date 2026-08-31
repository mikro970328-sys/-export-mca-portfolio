-- P17 · B9.3 · Atomic administration mutations for users and workers.

create or replace function public.create_admin_account_with_audit(
  p_actor uuid,
  p_full_name text,
  p_username text,
  p_password_salt text,
  p_password_hash text,
  p_access_role_id uuid,
  p_team_ids uuid[] default array[]::uuid[]
)
returns table(
  id uuid,
  full_name text,
  username text,
  role text,
  access_role_id uuid,
  is_active boolean,
  session_version integer
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_role_name text;
  v_invalid integer;
  v_created public.admin_users%rowtype;
begin
  if not public.admin_actor_has_permission(p_actor,'administration.users.manage') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username into v_actor_username
  from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;

  if length(btrim(coalesce(p_full_name,''))) < 3 then raise exception 'ADMIN_FULL_NAME_INVALID'; end if;
  if coalesce(p_username,'') !~ '^[A-Za-z0-9._-]{4,32}$' then raise exception 'USERNAME_INVALID'; end if;
  if btrim(coalesce(p_password_salt,''))='' or btrim(coalesce(p_password_hash,''))='' then
    raise exception 'PASSWORD_STATE_INVALID';
  end if;

  select ar.name into v_role_name
  from public.access_roles ar
  where ar.id=p_access_role_id and ar.is_active=true;
  if not found then raise exception 'ACCESS_ROLE_INVALID'; end if;

  select count(*) into v_invalid
  from unnest(coalesce(p_team_ids,array[]::uuid[])) x(team_id)
  left join public.teams t on t.id=x.team_id and t.is_active=true
  where t.id is null;
  if v_invalid>0 then raise exception 'TEAM_INVALID'; end if;

  insert into public.admin_users(
    full_name,username,password_salt,password_hash,role,access_role_id,is_active,created_by
  ) values(
    btrim(p_full_name),btrim(p_username),p_password_salt,p_password_hash,'admin',p_access_role_id,true,p_actor
  )
  returning * into v_created;

  insert into public.team_memberships(team_id,admin_user_id,created_by)
  select distinct x.team_id,v_created.id,p_actor
  from unnest(coalesce(p_team_ids,array[]::uuid[])) x(team_id);

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(
    p_actor,v_actor_username,'create_admin','admin_user',v_created.id,
    jsonb_build_object(
      'username',v_created.username,
      'access_role_id',p_access_role_id,
      'access_role_name',v_role_name,
      'team_ids',to_jsonb(coalesce(p_team_ids,array[]::uuid[])),
      'session_version',v_created.session_version
    )
  );

  return query
  select v_created.id,v_created.full_name,v_created.username,v_created.role,
         v_created.access_role_id,v_created.is_active,v_created.session_version;
end;
$$;

create or replace function public.update_admin_account_with_audit(
  p_admin_user_id uuid,
  p_actor uuid,
  p_patch jsonb,
  p_set_teams boolean default false,
  p_team_ids uuid[] default null
)
returns table(
  id uuid,
  full_name text,
  username text,
  role text,
  access_role_id uuid,
  is_active boolean,
  session_version integer
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_actor_role text;
  v_current public.admin_users%rowtype;
  v_updated public.admin_users%rowtype;
  v_invalid integer;
  v_access_role uuid;
  v_full_name text;
  v_username text;
  v_is_active boolean;
  v_password_salt text;
  v_password_hash text;
  v_has_password boolean;
  v_bump_session boolean := false;
  v_fields text[] := array[]::text[];
begin
  if not public.admin_actor_has_permission(p_actor,'administration.users.manage') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username,au.role into v_actor_username,v_actor_role
  from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;

  select au.* into v_current
  from public.admin_users au
  where au.id=p_admin_user_id
  for update;
  if not found then raise exception 'ADMIN_USER_NOT_FOUND'; end if;

  if v_current.role='master_admin' and v_actor_role<>'master_admin' then
    raise exception 'MASTER_ADMIN_CHANGE_FORBIDDEN';
  end if;

  p_patch := coalesce(p_patch,'{}'::jsonb);
  if exists(
    select 1 from jsonb_object_keys(p_patch) k(key)
    where k.key not in ('full_name','username','is_active','access_role_id','password_salt','password_hash')
  ) then raise exception 'ADMIN_PATCH_FIELD_INVALID'; end if;
  if p_patch='{}'::jsonb and not p_set_teams then raise exception 'NO_CHANGES'; end if;

  v_full_name := v_current.full_name;
  if p_patch ? 'full_name' then
    v_full_name := btrim(coalesce(p_patch->>'full_name',''));
    if length(v_full_name)<3 then raise exception 'ADMIN_FULL_NAME_INVALID'; end if;
    v_fields := array_append(v_fields,'full_name');
  end if;

  v_username := v_current.username;
  if p_patch ? 'username' then
    v_username := btrim(coalesce(p_patch->>'username',''));
    if v_username !~ '^[A-Za-z0-9._-]{4,32}$' then raise exception 'USERNAME_INVALID'; end if;
    v_fields := array_append(v_fields,'username');
  end if;

  v_is_active := v_current.is_active;
  if p_patch ? 'is_active' then
    if jsonb_typeof(p_patch->'is_active') <> 'boolean' then raise exception 'ADMIN_ACTIVE_INVALID'; end if;
    v_is_active := (p_patch->>'is_active')::boolean;
    if p_admin_user_id=p_actor and v_is_active=false then raise exception 'SELF_DEACTIVATION_FORBIDDEN'; end if;
    if v_is_active is distinct from v_current.is_active then v_bump_session:=true; end if;
    v_fields := array_append(v_fields,'is_active');
  end if;

  v_access_role := v_current.access_role_id;
  if p_patch ? 'access_role_id' then
    if v_current.role='master_admin' then raise exception 'MASTER_ADMIN_ACCESS_ROLE_FORBIDDEN'; end if;
    begin
      v_access_role := nullif(p_patch->>'access_role_id','')::uuid;
    exception when others then
      raise exception 'ACCESS_ROLE_INVALID';
    end;
    if v_access_role is null or not exists(
      select 1 from public.access_roles ar where ar.id=v_access_role and ar.is_active=true
    ) then raise exception 'ACCESS_ROLE_INVALID'; end if;
    if v_access_role is distinct from v_current.access_role_id then v_bump_session:=true; end if;
    v_fields := array_append(v_fields,'access_role_id');
  end if;

  v_has_password := (p_patch ? 'password_salt') or (p_patch ? 'password_hash');
  if v_has_password then
    if not (p_patch ? 'password_salt') or not (p_patch ? 'password_hash') then
      raise exception 'PASSWORD_STATE_INVALID';
    end if;
    v_password_salt := p_patch->>'password_salt';
    v_password_hash := p_patch->>'password_hash';
    if btrim(coalesce(v_password_salt,''))='' or btrim(coalesce(v_password_hash,''))='' then
      raise exception 'PASSWORD_STATE_INVALID';
    end if;
    v_bump_session:=true;
    v_fields := array_append(v_fields,'password');
  else
    v_password_salt := v_current.password_salt;
    v_password_hash := v_current.password_hash;
  end if;

  if p_set_teams then
    select count(*) into v_invalid
    from unnest(coalesce(p_team_ids,array[]::uuid[])) x(team_id)
    left join public.teams t on t.id=x.team_id and t.is_active=true
    where t.id is null;
    if v_invalid>0 then raise exception 'TEAM_INVALID'; end if;
  end if;

  update public.admin_users au
  set full_name=v_full_name,
      username=v_username,
      is_active=v_is_active,
      access_role_id=v_access_role,
      password_salt=v_password_salt,
      password_hash=v_password_hash,
      password_changed_at=case when v_has_password then now() else au.password_changed_at end,
      failed_attempts=case when v_has_password then 0 else au.failed_attempts end,
      locked_until=case when v_has_password then null else au.locked_until end,
      session_version=au.session_version + case when v_bump_session then 1 else 0 end,
      updated_at=now()
  where au.id=p_admin_user_id
  returning * into v_updated;

  if p_set_teams then
    delete from public.team_memberships tm where tm.admin_user_id=p_admin_user_id;
    insert into public.team_memberships(team_id,admin_user_id,created_by)
    select distinct x.team_id,p_admin_user_id,p_actor
    from unnest(coalesce(p_team_ids,array[]::uuid[])) x(team_id);
    v_fields := array_append(v_fields,'team_ids');
  end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(
    p_actor,v_actor_username,'update_admin','admin_user',p_admin_user_id,
    jsonb_build_object(
      'fields',to_jsonb(v_fields),
      'team_ids',case when p_set_teams then to_jsonb(coalesce(p_team_ids,array[]::uuid[])) else null end,
      'previous_sessions_invalidated',v_bump_session,
      'session_version',v_updated.session_version
    )
  );

  return query
  select v_updated.id,v_updated.full_name,v_updated.username,v_updated.role,
         v_updated.access_role_id,v_updated.is_active,v_updated.session_version;
end;
$$;

create or replace function public.create_worker_with_audit(
  p_actor uuid,
  p_full_name text,
  p_phone text,
  p_position text default null
)
returns table(id uuid,full_name text,phone text,"position" text,is_active boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_worker public.workers%rowtype;
begin
  if not public.admin_actor_has_permission(p_actor,'administration.workers.write') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username into v_actor_username from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;
  if length(btrim(coalesce(p_full_name,'')))<3 then raise exception 'WORKER_NAME_INVALID'; end if;
  if length(btrim(coalesce(p_phone,'')))<8 then raise exception 'WORKER_PHONE_INVALID'; end if;

  insert into public.workers(full_name,phone,position,is_active,created_by)
  values(btrim(p_full_name),btrim(p_phone),nullif(btrim(coalesce(p_position,'')),''),true,p_actor)
  returning * into v_worker;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,v_actor_username,'create_worker','worker',v_worker.id,
         jsonb_build_object('full_name',v_worker.full_name,'phone',v_worker.phone,'position',v_worker.position));

  return query select v_worker.id,v_worker.full_name,v_worker.phone,v_worker.position,v_worker.is_active;
end;
$$;

create or replace function public.update_worker_with_audit(
  p_worker_id uuid,
  p_actor uuid,
  p_patch jsonb
)
returns table(id uuid,full_name text,phone text,"position" text,is_active boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_current public.workers%rowtype;
  v_updated public.workers%rowtype;
  v_full_name text;
  v_phone text;
  v_position text;
  v_is_active boolean;
  v_reason text;
  v_status_action text;
  v_fields text[] := array[]::text[];
begin
  if not public.admin_actor_has_permission(p_actor,'administration.workers.write') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username into v_actor_username from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;

  select w.* into v_current from public.workers w where w.id=p_worker_id for update;
  if not found then raise exception 'WORKER_NOT_FOUND'; end if;

  p_patch:=coalesce(p_patch,'{}'::jsonb);
  if p_patch='{}'::jsonb then raise exception 'NO_CHANGES'; end if;
  if exists(
    select 1 from jsonb_object_keys(p_patch) k(key)
    where k.key not in ('full_name','phone','position','is_active','deactivation_reason','reactivation_reason')
  ) then raise exception 'WORKER_PATCH_FIELD_INVALID'; end if;

  v_full_name:=v_current.full_name;
  if p_patch ? 'full_name' then
    v_full_name:=btrim(coalesce(p_patch->>'full_name',''));
    if length(v_full_name)<3 then raise exception 'WORKER_NAME_INVALID'; end if;
    v_fields:=array_append(v_fields,'full_name');
  end if;

  v_phone:=v_current.phone;
  if p_patch ? 'phone' then
    v_phone:=btrim(coalesce(p_patch->>'phone',''));
    if length(v_phone)<8 then raise exception 'WORKER_PHONE_INVALID'; end if;
    v_fields:=array_append(v_fields,'phone');
  end if;

  v_position:=v_current.position;
  if p_patch ? 'position' then
    v_position:=nullif(btrim(coalesce(p_patch->>'position','')),'');
    v_fields:=array_append(v_fields,'position');
  end if;

  v_is_active:=v_current.is_active;
  if p_patch ? 'is_active' then
    if jsonb_typeof(p_patch->'is_active')<>'boolean' then raise exception 'WORKER_ACTIVE_INVALID'; end if;
    v_is_active:=(p_patch->>'is_active')::boolean;
    if v_is_active is distinct from v_current.is_active then
      if v_is_active=false then
        v_reason:=nullif(btrim(coalesce(p_patch->>'deactivation_reason','')),'');
        if v_reason is null or length(v_reason)<3 then raise exception 'WORKER_DEACTIVATION_REASON_REQUIRED'; end if;
        v_status_action:='deactivated';
      else
        v_reason:=nullif(btrim(coalesce(p_patch->>'reactivation_reason','')),'');
        v_status_action:='reactivated';
      end if;
    end if;
    v_fields:=array_append(v_fields,'is_active');
  end if;

  update public.workers w
  set full_name=v_full_name,
      phone=v_phone,
      position=v_position,
      is_active=v_is_active,
      deactivation_reason=case when v_status_action='deactivated' then v_reason when v_status_action='reactivated' then null else w.deactivation_reason end,
      deactivated_at=case when v_status_action='deactivated' then now() when v_status_action='reactivated' then null else w.deactivated_at end,
      updated_at=now()
  where w.id=p_worker_id
  returning * into v_updated;

  if v_status_action is not null then
    insert into public.worker_status_history(worker_id,action,reason,changed_by)
    values(p_worker_id,v_status_action,v_reason,p_actor);
  end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(
    p_actor,v_actor_username,
    case when v_status_action='deactivated' then 'deactivate_worker'
         when v_status_action='reactivated' then 'reactivate_worker'
         else 'update_worker' end,
    'worker',p_worker_id,
    jsonb_build_object('fields',to_jsonb(v_fields),'reason',v_reason)
  );

  return query select v_updated.id,v_updated.full_name,v_updated.phone,v_updated.position,v_updated.is_active;
end;
$$;

revoke all on function public.create_admin_account_with_audit(uuid,text,text,text,text,uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.update_admin_account_with_audit(uuid,uuid,jsonb,boolean,uuid[]) from public,anon,authenticated;
revoke all on function public.create_worker_with_audit(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.update_worker_with_audit(uuid,uuid,jsonb) from public,anon,authenticated;

grant execute on function public.create_admin_account_with_audit(uuid,text,text,text,text,uuid,uuid[]) to service_role;
grant execute on function public.update_admin_account_with_audit(uuid,uuid,jsonb,boolean,uuid[]) to service_role;
grant execute on function public.create_worker_with_audit(uuid,text,text,text) to service_role;
grant execute on function public.update_worker_with_audit(uuid,uuid,jsonb) to service_role;
