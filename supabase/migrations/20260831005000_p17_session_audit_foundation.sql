-- P17 · B9.3 · Revocable admin sessions + append-only audit foundation

alter table public.admin_users
  add column if not exists session_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.admin_users'::regclass
      and conname='admin_users_session_version_positive'
  ) then
    alter table public.admin_users
      add constraint admin_users_session_version_positive
      check (session_version > 0) not valid;
  end if;
end $$;

alter table public.admin_users
  validate constraint admin_users_session_version_positive;

-- Audit is append-only. service_role may append/read but never rewrite history.
revoke all privileges on table public.audit_log from public, anon, authenticated;
revoke all privileges on table public.audit_log from service_role;
grant select, insert on table public.audit_log to service_role;

create or replace function public.guard_audit_log_append_only()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  raise exception 'AUDIT_LOG_APPEND_ONLY';
end;
$$;

revoke all on function public.guard_audit_log_append_only() from public,anon,authenticated,service_role;

drop trigger if exists audit_log_append_only_guard on public.audit_log;
create trigger audit_log_append_only_guard
before update or delete or truncate on public.audit_log
for each statement execute function public.guard_audit_log_append_only();

create or replace function public.validate_audit_log_insert()
returns trigger
language plpgsql
set search_path=public,pg_temp
as $$
begin
  if btrim(coalesce(new.action,''))='' then raise exception 'AUDIT_ACTION_REQUIRED'; end if;
  if btrim(coalesce(new.entity_type,''))='' then raise exception 'AUDIT_ENTITY_TYPE_REQUIRED'; end if;

  if new.action = any(array[
    'login','login_failed','change_own_password','revoke_admin_sessions',
    'create_admin','update_admin','create_access_role','update_access_role',
    'create_team','update_team','create_worker','update_worker','deactivate_worker','reactivate_worker'
  ]) and new.actor_admin_id is null then
    raise exception 'AUDIT_ACTOR_REQUIRED';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_audit_log_insert() from public,anon,authenticated,service_role;

drop trigger if exists audit_log_insert_validation on public.audit_log;
create trigger audit_log_insert_validation
before insert on public.audit_log
for each row execute function public.validate_audit_log_insert();

create or replace function public.admin_actor_has_permission(
  p_actor uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path=public,pg_temp
as $$
  select exists(
    select 1
    from public.admin_users au
    where au.id=p_actor
      and au.is_active=true
      and au.role in ('master_admin','admin')
      and (
        au.role='master_admin'
        or exists(
          select 1
          from public.admin_effective_permissions ep
          where ep.admin_user_id=au.id
            and ep.permission_key=p_permission
        )
      )
  );
$$;

revoke all on function public.admin_actor_has_permission(uuid,text) from public,anon,authenticated,service_role;

create or replace function public.register_admin_login_failure(
  p_admin_user_id uuid
)
returns table(locked boolean, locked_until timestamptz, failed_attempts integer)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user public.admin_users%rowtype;
  v_next integer;
  v_locked_until timestamptz;
begin
  select au.* into v_user
  from public.admin_users au
  where au.id=p_admin_user_id
  for update;

  if not found or v_user.is_active is distinct from true then
    raise exception 'ADMIN_USER_UNAVAILABLE';
  end if;
  if v_user.locked_until is not null and v_user.locked_until > now() then
    raise exception 'ACCOUNT_LOCKED';
  end if;

  v_next := coalesce(v_user.failed_attempts,0)+1;
  if v_next >= 5 then
    v_locked_until := now()+interval '15 minutes';
    update public.admin_users au
    set failed_attempts=0,
        locked_until=v_locked_until,
        updated_at=now()
    where au.id=p_admin_user_id;
  else
    update public.admin_users au
    set failed_attempts=v_next,
        locked_until=null,
        updated_at=now()
    where au.id=p_admin_user_id;
  end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(
    v_user.id,
    v_user.username,
    'login_failed',
    'admin_user',
    v_user.id,
    jsonb_build_object('locked',v_next>=5,'locked_until',v_locked_until)
  );

  return query select v_next>=5, v_locked_until, case when v_next>=5 then 0 else v_next end;
end;
$$;

create or replace function public.register_admin_login_success(
  p_admin_user_id uuid
)
returns table(session_version integer, last_login_at timestamptz)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_username text;
  v_version integer;
  v_login_at timestamptz := now();
begin
  update public.admin_users au
  set failed_attempts=0,
      locked_until=null,
      last_login_at=v_login_at,
      updated_at=v_login_at
  where au.id=p_admin_user_id
    and au.is_active=true
  returning au.username,au.session_version into v_username,v_version;

  if not found then raise exception 'ADMIN_USER_UNAVAILABLE'; end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(
    p_admin_user_id,
    v_username,
    'login',
    'admin_user',
    p_admin_user_id,
    jsonb_build_object('session_version',v_version)
  );

  return query select v_version,v_login_at;
end;
$$;

create or replace function public.change_own_admin_password(
  p_admin_user_id uuid,
  p_expected_password_hash text,
  p_password_salt text,
  p_password_hash text
)
returns table(session_version integer, password_changed_at timestamptz)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_user public.admin_users%rowtype;
  v_changed_at timestamptz := now();
  v_version integer;
begin
  if btrim(coalesce(p_expected_password_hash,''))='' or
     btrim(coalesce(p_password_salt,''))='' or
     btrim(coalesce(p_password_hash,''))='' then
    raise exception 'PASSWORD_STATE_INVALID';
  end if;

  select au.* into v_user
  from public.admin_users au
  where au.id=p_admin_user_id
  for update;

  if not found or v_user.is_active is distinct from true then
    raise exception 'ADMIN_USER_UNAVAILABLE';
  end if;
  if v_user.password_hash is distinct from p_expected_password_hash then
    raise exception 'PASSWORD_STATE_CHANGED';
  end if;

  update public.admin_users au
  set password_salt=p_password_salt,
      password_hash=p_password_hash,
      password_changed_at=v_changed_at,
      session_version=au.session_version+1,
      failed_attempts=0,
      locked_until=null,
      updated_at=v_changed_at
  where au.id=p_admin_user_id
  returning au.session_version into v_version;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(
    v_user.id,
    v_user.username,
    'change_own_password',
    'admin_user',
    v_user.id,
    jsonb_build_object('session_version',v_version,'previous_sessions_invalidated',true)
  );

  return query select v_version,v_changed_at;
end;
$$;

create or replace function public.revoke_admin_sessions(
  p_admin_user_id uuid,
  p_actor uuid,
  p_reason text default null
)
returns table(session_version integer)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_target_username text;
  v_actor_username text;
  v_version integer;
begin
  if not public.admin_actor_has_permission(p_actor,'administration.users.manage') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;

  select au.username into v_actor_username
  from public.admin_users au
  where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;

  update public.admin_users au
  set session_version=au.session_version+1,
      updated_at=now()
  where au.id=p_admin_user_id
  returning au.username,au.session_version into v_target_username,v_version;

  if not found then raise exception 'ADMIN_USER_NOT_FOUND'; end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(
    p_actor,
    v_actor_username,
    'revoke_admin_sessions',
    'admin_user',
    p_admin_user_id,
    jsonb_build_object('session_version',v_version,'reason',nullif(btrim(coalesce(p_reason,'')),''))
  );

  return query select v_version;
end;
$$;

revoke all on function public.register_admin_login_failure(uuid) from public,anon,authenticated;
revoke all on function public.register_admin_login_success(uuid) from public,anon,authenticated;
revoke all on function public.change_own_admin_password(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.revoke_admin_sessions(uuid,uuid,text) from public,anon,authenticated;

grant execute on function public.register_admin_login_failure(uuid) to service_role;
grant execute on function public.register_admin_login_success(uuid) to service_role;
grant execute on function public.change_own_admin_password(uuid,text,text,text) to service_role;
grant execute on function public.revoke_admin_sessions(uuid,uuid,text) to service_role;
