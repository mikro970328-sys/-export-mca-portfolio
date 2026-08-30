-- P3 · setters atómicos para permisos y equipos

create or replace function public.set_access_role_permissions(
  p_access_role_id uuid,
  p_permission_keys text[],
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_role public.access_roles%rowtype;
  v_invalid integer;
begin
  select * into v_role from public.access_roles where id=p_access_role_id for update;
  if not found then raise exception 'ACCESS_ROLE_NOT_FOUND'; end if;
  if v_role.is_system then raise exception 'SYSTEM_ACCESS_ROLE_PERMISSIONS_IMMUTABLE'; end if;

  select count(*) into v_invalid
  from unnest(coalesce(p_permission_keys, array[]::text[])) k(permission_key)
  left join public.access_permissions ap on ap.permission_key=k.permission_key and ap.is_active=true
  where ap.permission_key is null;
  if v_invalid > 0 then raise exception 'ACCESS_PERMISSION_INVALID'; end if;

  delete from public.access_role_permissions where access_role_id=p_access_role_id;
  insert into public.access_role_permissions(access_role_id,permission_key,created_by)
  select p_access_role_id,k.permission_key,p_actor
  from (select distinct unnest(coalesce(p_permission_keys, array[]::text[])) as permission_key) k;

  update public.access_roles set updated_at=now() where id=p_access_role_id;
end;
$$;

create or replace function public.set_admin_teams(
  p_admin_user_id uuid,
  p_team_ids uuid[],
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_invalid integer;
begin
  if not exists(select 1 from public.admin_users where id=p_admin_user_id) then
    raise exception 'ADMIN_USER_NOT_FOUND';
  end if;

  select count(*) into v_invalid
  from unnest(coalesce(p_team_ids, array[]::uuid[])) x(team_id)
  left join public.teams t on t.id=x.team_id and t.is_active=true
  where t.id is null;
  if v_invalid > 0 then raise exception 'TEAM_INVALID'; end if;

  delete from public.team_memberships where admin_user_id=p_admin_user_id;
  insert into public.team_memberships(team_id,admin_user_id,created_by)
  select x.team_id,p_admin_user_id,p_actor
  from (select distinct unnest(coalesce(p_team_ids, array[]::uuid[])) as team_id) x;
end;
$$;

create or replace function public.set_team_members(
  p_team_id uuid,
  p_admin_user_ids uuid[],
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_team public.teams%rowtype;
  v_invalid integer;
begin
  select * into v_team from public.teams where id=p_team_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;
  if not v_team.is_active and cardinality(coalesce(p_admin_user_ids,array[]::uuid[])) > 0 then
    raise exception 'TEAM_INACTIVE';
  end if;

  select count(*) into v_invalid
  from unnest(coalesce(p_admin_user_ids, array[]::uuid[])) x(admin_user_id)
  left join public.admin_users au on au.id=x.admin_user_id and au.is_active=true
  where au.id is null;
  if v_invalid > 0 then raise exception 'ADMIN_USER_INVALID'; end if;

  delete from public.team_memberships where team_id=p_team_id;
  insert into public.team_memberships(team_id,admin_user_id,created_by)
  select p_team_id,x.admin_user_id,p_actor
  from (select distinct unnest(coalesce(p_admin_user_ids, array[]::uuid[])) as admin_user_id) x;

  update public.teams set updated_at=now() where id=p_team_id;
end;
$$;

revoke all on function public.set_access_role_permissions(uuid,text[],uuid) from public,anon,authenticated;
revoke all on function public.set_admin_teams(uuid,uuid[],uuid) from public,anon,authenticated;
revoke all on function public.set_team_members(uuid,uuid[],uuid) from public,anon,authenticated;
grant execute on function public.set_access_role_permissions(uuid,text[],uuid) to service_role;
grant execute on function public.set_admin_teams(uuid,uuid[],uuid) to service_role;
grant execute on function public.set_team_members(uuid,uuid[],uuid) to service_role;
