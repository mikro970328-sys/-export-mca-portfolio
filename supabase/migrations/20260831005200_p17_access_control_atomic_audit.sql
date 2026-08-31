-- P17 · B9.3 · Atomic role/team administration + audit.

create or replace function public.create_access_role_with_audit(
  p_actor uuid,
  p_name text,
  p_description text,
  p_permission_keys text[] default array[]::text[]
)
returns table(id uuid,name text,description text,is_system boolean,is_active boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_invalid integer;
  v_role public.access_roles%rowtype;
begin
  if not public.admin_actor_has_permission(p_actor,'administration.roles.manage') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username into v_actor_username from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;
  if length(btrim(coalesce(p_name,'')))<2 then raise exception 'ACCESS_ROLE_NAME_INVALID'; end if;

  select count(*) into v_invalid
  from unnest(coalesce(p_permission_keys,array[]::text[])) x(permission_key)
  left join public.access_permissions ap on ap.permission_key=x.permission_key and ap.is_active=true
  where ap.permission_key is null;
  if v_invalid>0 then raise exception 'ACCESS_PERMISSION_INVALID'; end if;

  insert into public.access_roles(name,description,is_system,is_active,created_by)
  values(btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),false,true,p_actor)
  returning * into v_role;

  insert into public.access_role_permissions(access_role_id,permission_key,created_by)
  select v_role.id,x.permission_key,p_actor
  from (select distinct unnest(coalesce(p_permission_keys,array[]::text[])) permission_key) x;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,v_actor_username,'create_access_role','access_role',v_role.id,
         jsonb_build_object('name',v_role.name,'permission_keys',to_jsonb(coalesce(p_permission_keys,array[]::text[]))));

  return query select v_role.id,v_role.name,v_role.description,v_role.is_system,v_role.is_active;
end;
$$;

create or replace function public.update_access_role_with_audit(
  p_access_role_id uuid,
  p_actor uuid,
  p_patch jsonb,
  p_set_permissions boolean default false,
  p_permission_keys text[] default null
)
returns table(id uuid,name text,description text,is_system boolean,is_active boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_current public.access_roles%rowtype;
  v_updated public.access_roles%rowtype;
  v_name text;
  v_description text;
  v_is_active boolean;
  v_invalid integer;
  v_fields text[]:=array[]::text[];
begin
  if not public.admin_actor_has_permission(p_actor,'administration.roles.manage') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username into v_actor_username from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;

  select ar.* into v_current from public.access_roles ar where ar.id=p_access_role_id for update;
  if not found then raise exception 'ACCESS_ROLE_NOT_FOUND'; end if;

  p_patch:=coalesce(p_patch,'{}'::jsonb);
  if p_patch='{}'::jsonb and not p_set_permissions then raise exception 'NO_CHANGES'; end if;
  if exists(
    select 1 from jsonb_object_keys(p_patch) k(key)
    where k.key not in ('name','description','is_active')
  ) then raise exception 'ACCESS_ROLE_PATCH_FIELD_INVALID'; end if;

  v_name:=v_current.name;
  if p_patch ? 'name' then
    if v_current.is_system then raise exception 'SYSTEM_ACCESS_ROLE_IMMUTABLE'; end if;
    v_name:=btrim(coalesce(p_patch->>'name',''));
    if length(v_name)<2 then raise exception 'ACCESS_ROLE_NAME_INVALID'; end if;
    v_fields:=array_append(v_fields,'name');
  end if;

  v_description:=v_current.description;
  if p_patch ? 'description' then
    if v_current.is_system then raise exception 'SYSTEM_ACCESS_ROLE_IMMUTABLE'; end if;
    v_description:=nullif(btrim(coalesce(p_patch->>'description','')),'');
    v_fields:=array_append(v_fields,'description');
  end if;

  v_is_active:=v_current.is_active;
  if p_patch ? 'is_active' then
    if jsonb_typeof(p_patch->'is_active')<>'boolean' then raise exception 'ACCESS_ROLE_ACTIVE_INVALID'; end if;
    v_is_active:=(p_patch->>'is_active')::boolean;
    if v_current.is_system and v_is_active=false then raise exception 'SYSTEM_ACCESS_ROLE_IMMUTABLE'; end if;
    v_fields:=array_append(v_fields,'is_active');
  end if;

  if p_set_permissions then
    if v_current.is_system then raise exception 'SYSTEM_ACCESS_ROLE_IMMUTABLE'; end if;
    select count(*) into v_invalid
    from unnest(coalesce(p_permission_keys,array[]::text[])) x(permission_key)
    left join public.access_permissions ap on ap.permission_key=x.permission_key and ap.is_active=true
    where ap.permission_key is null;
    if v_invalid>0 then raise exception 'ACCESS_PERMISSION_INVALID'; end if;
    v_fields:=array_append(v_fields,'permission_keys');
  end if;

  update public.access_roles ar
  set name=v_name,
      description=v_description,
      is_active=v_is_active,
      updated_at=now()
  where ar.id=p_access_role_id
  returning * into v_updated;

  if p_set_permissions then
    delete from public.access_role_permissions arp where arp.access_role_id=p_access_role_id;
    insert into public.access_role_permissions(access_role_id,permission_key,created_by)
    select p_access_role_id,x.permission_key,p_actor
    from (select distinct unnest(coalesce(p_permission_keys,array[]::text[])) permission_key) x;
  end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,v_actor_username,'update_access_role','access_role',p_access_role_id,
         jsonb_build_object('fields',to_jsonb(v_fields),
                            'permission_keys',case when p_set_permissions then to_jsonb(coalesce(p_permission_keys,array[]::text[])) else null end));

  return query select v_updated.id,v_updated.name,v_updated.description,v_updated.is_system,v_updated.is_active;
end;
$$;

create or replace function public.create_team_with_audit(
  p_actor uuid,
  p_name text,
  p_description text,
  p_member_ids uuid[] default array[]::uuid[]
)
returns table(id uuid,name text,description text,is_active boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_invalid integer;
  v_team public.teams%rowtype;
begin
  if not public.admin_actor_has_permission(p_actor,'administration.teams.manage') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username into v_actor_username from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;
  if length(btrim(coalesce(p_name,'')))<2 then raise exception 'TEAM_NAME_INVALID'; end if;

  select count(*) into v_invalid
  from unnest(coalesce(p_member_ids,array[]::uuid[])) x(admin_user_id)
  left join public.admin_users au on au.id=x.admin_user_id and au.is_active=true
  where au.id is null;
  if v_invalid>0 then raise exception 'ADMIN_USER_INVALID'; end if;

  insert into public.teams(name,description,is_active,created_by)
  values(btrim(p_name),nullif(btrim(coalesce(p_description,'')),''),true,p_actor)
  returning * into v_team;

  insert into public.team_memberships(team_id,admin_user_id,created_by)
  select v_team.id,x.admin_user_id,p_actor
  from (select distinct unnest(coalesce(p_member_ids,array[]::uuid[])) admin_user_id) x;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,v_actor_username,'create_team','team',v_team.id,
         jsonb_build_object('name',v_team.name,'member_ids',to_jsonb(coalesce(p_member_ids,array[]::uuid[]))));

  return query select v_team.id,v_team.name,v_team.description,v_team.is_active;
end;
$$;

create or replace function public.update_team_with_audit(
  p_team_id uuid,
  p_actor uuid,
  p_patch jsonb,
  p_set_members boolean default false,
  p_member_ids uuid[] default null
)
returns table(id uuid,name text,description text,is_active boolean)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_actor_username text;
  v_current public.teams%rowtype;
  v_updated public.teams%rowtype;
  v_name text;
  v_description text;
  v_is_active boolean;
  v_invalid integer;
  v_fields text[]:=array[]::text[];
begin
  if not public.admin_actor_has_permission(p_actor,'administration.teams.manage') then
    raise exception 'ADMIN_PERMISSION_DENIED';
  end if;
  select au.username into v_actor_username from public.admin_users au where au.id=p_actor and au.is_active=true;
  if not found then raise exception 'ADMIN_ACTOR_INVALID'; end if;

  select t.* into v_current from public.teams t where t.id=p_team_id for update;
  if not found then raise exception 'TEAM_NOT_FOUND'; end if;

  p_patch:=coalesce(p_patch,'{}'::jsonb);
  if p_patch='{}'::jsonb and not p_set_members then raise exception 'NO_CHANGES'; end if;
  if exists(
    select 1 from jsonb_object_keys(p_patch) k(key)
    where k.key not in ('name','description','is_active')
  ) then raise exception 'TEAM_PATCH_FIELD_INVALID'; end if;

  v_name:=v_current.name;
  if p_patch ? 'name' then
    v_name:=btrim(coalesce(p_patch->>'name',''));
    if length(v_name)<2 then raise exception 'TEAM_NAME_INVALID'; end if;
    v_fields:=array_append(v_fields,'name');
  end if;

  v_description:=v_current.description;
  if p_patch ? 'description' then
    v_description:=nullif(btrim(coalesce(p_patch->>'description','')),'');
    v_fields:=array_append(v_fields,'description');
  end if;

  v_is_active:=v_current.is_active;
  if p_patch ? 'is_active' then
    if jsonb_typeof(p_patch->'is_active')<>'boolean' then raise exception 'TEAM_ACTIVE_INVALID'; end if;
    v_is_active:=(p_patch->>'is_active')::boolean;
    v_fields:=array_append(v_fields,'is_active');
  end if;

  if p_set_members then
    if v_is_active=false and cardinality(coalesce(p_member_ids,array[]::uuid[]))>0 then
      raise exception 'TEAM_INACTIVE';
    end if;
    select count(*) into v_invalid
    from unnest(coalesce(p_member_ids,array[]::uuid[])) x(admin_user_id)
    left join public.admin_users au on au.id=x.admin_user_id and au.is_active=true
    where au.id is null;
    if v_invalid>0 then raise exception 'ADMIN_USER_INVALID'; end if;
    v_fields:=array_append(v_fields,'member_ids');
  elsif v_is_active=false and v_current.is_active=true then
    p_set_members:=true;
    p_member_ids:=array[]::uuid[];
    v_fields:=array_append(v_fields,'member_ids');
  end if;

  update public.teams t
  set name=v_name,
      description=v_description,
      is_active=v_is_active,
      updated_at=now()
  where t.id=p_team_id
  returning * into v_updated;

  if p_set_members then
    delete from public.team_memberships tm where tm.team_id=p_team_id;
    insert into public.team_memberships(team_id,admin_user_id,created_by)
    select p_team_id,x.admin_user_id,p_actor
    from (select distinct unnest(coalesce(p_member_ids,array[]::uuid[])) admin_user_id) x;
  end if;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  values(p_actor,v_actor_username,'update_team','team',p_team_id,
         jsonb_build_object('fields',to_jsonb(v_fields),
                            'member_ids',case when p_set_members then to_jsonb(coalesce(p_member_ids,array[]::uuid[])) else null end));

  return query select v_updated.id,v_updated.name,v_updated.description,v_updated.is_active;
end;
$$;

revoke all on function public.create_access_role_with_audit(uuid,text,text,text[]) from public,anon,authenticated;
revoke all on function public.update_access_role_with_audit(uuid,uuid,jsonb,boolean,text[]) from public,anon,authenticated;
revoke all on function public.create_team_with_audit(uuid,text,text,uuid[]) from public,anon,authenticated;
revoke all on function public.update_team_with_audit(uuid,uuid,jsonb,boolean,uuid[]) from public,anon,authenticated;

grant execute on function public.create_access_role_with_audit(uuid,text,text,text[]) to service_role;
grant execute on function public.update_access_role_with_audit(uuid,uuid,jsonb,boolean,text[]) to service_role;
grant execute on function public.create_team_with_audit(uuid,text,text,uuid[]) to service_role;
grant execute on function public.update_team_with_audit(uuid,uuid,jsonb,boolean,uuid[]) to service_role;
