-- P17 · B9.3 reversible E2E. Must finish with ROLLBACK and zero fixture residue.
begin;

do $$
declare
  v_actor uuid;
  v_role_id uuid;
  v_team_id uuid;
  v_admin_id uuid;
  v_worker_id uuid;
  v_version integer;
  v_count bigint;
  v_blocked boolean;
begin
  select au.id into v_actor
  from public.admin_users au
  where au.role='master_admin' and au.is_active=true
  order by au.created_at asc
  limit 1;
  if v_actor is null then raise exception 'P17_MASTER_ADMIN_FIXTURE_REQUIRED'; end if;

  select r.id into v_role_id
  from public.create_access_role_with_audit(
    v_actor,'__P17_ROLE__','P17 reversible role',array['dashboard.read']::text[]
  ) r;
  if v_role_id is null then raise exception 'P17_ROLE_CREATE_FAILED'; end if;

  select t.id into v_team_id
  from public.create_team_with_audit(
    v_actor,'__P17_TEAM__','P17 reversible team',array[]::uuid[]
  ) t;
  if v_team_id is null then raise exception 'P17_TEAM_CREATE_FAILED'; end if;

  select a.id,a.session_version into v_admin_id,v_version
  from public.create_admin_account_with_audit(
    v_actor,'P17 Fixture Admin','p17.fixture.admin','p17_salt_a','p17_hash_a',v_role_id,array[v_team_id]
  ) a;
  if v_admin_id is null or v_version<>1 then raise exception 'P17_ADMIN_INITIAL_SESSION_INVALID:%',v_version; end if;

  perform * from public.update_team_with_audit(
    v_team_id,v_actor,'{"description":"P17 team updated"}'::jsonb,true,array[v_admin_id]
  );
  perform * from public.update_access_role_with_audit(
    v_role_id,v_actor,'{"description":"P17 role updated"}'::jsonb,true,array['dashboard.read','clients.read']::text[]
  );

  select w.id into v_worker_id
  from public.create_worker_with_audit(v_actor,'P17 Fixture Worker','+15550001717','Tester') w;
  if v_worker_id is null then raise exception 'P17_WORKER_CREATE_FAILED'; end if;
  perform * from public.update_worker_with_audit(
    v_worker_id,v_actor,'{"is_active":false,"deactivation_reason":"P17 reversible test"}'::jsonb
  );
  perform * from public.update_worker_with_audit(
    v_worker_id,v_actor,'{"is_active":true,"reactivation_reason":"P17 reversible test"}'::jsonb
  );

  perform * from public.register_admin_login_failure(v_admin_id);
  select count(*) into v_count from public.admin_users au where au.id=v_admin_id and au.failed_attempts=1;
  if v_count<>1 then raise exception 'P17_LOGIN_FAILURE_STATE_INVALID'; end if;
  perform * from public.register_admin_login_success(v_admin_id);
  select count(*) into v_count from public.admin_users au where au.id=v_admin_id and au.failed_attempts=0 and au.locked_until is null;
  if v_count<>1 then raise exception 'P17_LOGIN_SUCCESS_STATE_INVALID'; end if;

  select p.session_version into v_version
  from public.change_own_admin_password(v_admin_id,'p17_hash_a','p17_salt_b','p17_hash_b') p;
  if v_version<>2 then raise exception 'P17_PASSWORD_SESSION_VERSION_INVALID:%',v_version; end if;

  select r.session_version into v_version
  from public.revoke_admin_sessions(v_admin_id,v_actor,'P17 reversible revoke') r;
  if v_version<>3 then raise exception 'P17_REVOKE_SESSION_VERSION_INVALID:%',v_version; end if;

  select a.session_version into v_version
  from public.update_admin_account_with_audit(v_admin_id,v_actor,'{"is_active":false}'::jsonb,false,null) a;
  if v_version<>4 then raise exception 'P17_DEACTIVATE_SESSION_VERSION_INVALID:%',v_version; end if;
  select a.session_version into v_version
  from public.update_admin_account_with_audit(v_admin_id,v_actor,'{"is_active":true}'::jsonb,false,null) a;
  if v_version<>5 then raise exception 'P17_REACTIVATE_SESSION_VERSION_INVALID:%',v_version; end if;

  select count(*) into v_count
  from public.audit_log al
  where al.entity_id in (v_admin_id,v_role_id,v_team_id,v_worker_id)
    and al.actor_admin_id is not null;
  if v_count<11 then raise exception 'P17_AUDIT_EVENTS_MISSING:%',v_count; end if;

  if not has_table_privilege('service_role','public.audit_log','SELECT')
     or not has_table_privilege('service_role','public.audit_log','INSERT')
     or has_table_privilege('service_role','public.audit_log','UPDATE')
     or has_table_privilege('service_role','public.audit_log','DELETE')
     or has_table_privilege('service_role','public.audit_log','TRUNCATE') then
    raise exception 'P17_AUDIT_LOG_GRANTS_INVALID';
  end if;

  v_blocked:=false;
  begin
    update public.audit_log set details='{}'::jsonb where entity_id=v_admin_id;
  exception when others then
    if sqlerrm like '%AUDIT_LOG_APPEND_ONLY%' then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'P17_AUDIT_UPDATE_NOT_BLOCKED'; end if;

  v_blocked:=false;
  begin
    delete from public.audit_log where entity_id=v_admin_id;
  exception when others then
    if sqlerrm like '%AUDIT_LOG_APPEND_ONLY%' then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'P17_AUDIT_DELETE_NOT_BLOCKED'; end if;

  v_blocked:=false;
  begin
    truncate table public.audit_log;
  exception when others then
    if sqlerrm like '%AUDIT_LOG_APPEND_ONLY%' then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'P17_AUDIT_TRUNCATE_NOT_BLOCKED'; end if;

  v_blocked:=false;
  begin
    insert into public.audit_log(action,entity_type,entity_id,details)
    values('login','admin_user',v_admin_id,'{}'::jsonb);
  exception when others then
    if sqlerrm like '%AUDIT_ACTOR_REQUIRED%' then v_blocked:=true; else raise; end if;
  end;
  if not v_blocked then raise exception 'P17_SENSITIVE_AUDIT_ACTOR_NOT_REQUIRED'; end if;

  if not has_function_privilege('service_role','public.change_own_admin_password(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('anon','public.change_own_admin_password(uuid,text,text,text)','EXECUTE')
     or has_function_privilege('authenticated','public.change_own_admin_password(uuid,text,text,text)','EXECUTE') then
    raise exception 'P17_PASSWORD_RPC_GRANTS_INVALID';
  end if;
end $$;

select
  'p17_e2e_passed_before_rollback' as result,
  (select count(*) from public.admin_users where username='p17.fixture.admin') as fixture_admins,
  (select count(*) from public.access_roles where name='__P17_ROLE__') as fixture_roles,
  (select count(*) from public.teams where name='__P17_TEAM__') as fixture_teams,
  (select count(*) from public.workers where phone='+15550001717') as fixture_workers;

rollback;

select
  (select count(*) from public.admin_users where username='p17.fixture.admin') as admin_fixture_residue,
  (select count(*) from public.access_roles where name='__P17_ROLE__') as role_fixture_residue,
  (select count(*) from public.teams where name='__P17_TEAM__') as team_fixture_residue,
  (select count(*) from public.workers where phone='+15550001717') as worker_fixture_residue,
  (select count(*) from public.audit_log where details::text like '%P17 reversible%') as audit_fixture_residue;
