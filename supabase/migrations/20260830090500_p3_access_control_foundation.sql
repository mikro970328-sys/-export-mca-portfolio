-- P3 · Usuarios, roles, equipos y permisos

create table if not exists public.access_permissions (
  permission_key text primary key,
  module text not null,
  action text not null,
  label text not null,
  description text,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint access_permissions_key_check check (permission_key ~ '^[a-z][a-z0-9_.-]{2,79}$'),
  constraint access_permissions_module_not_blank check (btrim(module) <> ''),
  constraint access_permissions_action_not_blank check (btrim(action) <> ''),
  constraint access_permissions_label_not_blank check (btrim(label) <> '')
);

create table if not exists public.access_roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_system boolean not null default false,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint access_roles_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.access_role_permissions (
  access_role_id uuid not null references public.access_roles(id) on delete cascade,
  permission_key text not null references public.access_permissions(permission_key) on delete restrict,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (access_role_id, permission_key)
);

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_name_not_blank check (btrim(name) <> '')
);

create table if not exists public.team_memberships (
  team_id uuid not null references public.teams(id) on delete cascade,
  admin_user_id uuid not null references public.admin_users(id) on delete cascade,
  created_by uuid,
  created_at timestamptz not null default now(),
  primary key (team_id, admin_user_id)
);

alter table public.access_roles
  add constraint access_roles_created_by_fkey
  foreign key (created_by) references public.admin_users(id) on delete set null;

alter table public.access_role_permissions
  add constraint access_role_permissions_created_by_fkey
  foreign key (created_by) references public.admin_users(id) on delete set null;

alter table public.teams
  add constraint teams_created_by_fkey
  foreign key (created_by) references public.admin_users(id) on delete set null;

alter table public.team_memberships
  add constraint team_memberships_created_by_fkey
  foreign key (created_by) references public.admin_users(id) on delete set null;

alter table public.admin_users
  add column if not exists access_role_id uuid;

alter table public.admin_users
  add constraint admin_users_access_role_id_fkey
  foreign key (access_role_id) references public.access_roles(id) on delete restrict;

create index if not exists admin_users_access_role_id_idx on public.admin_users(access_role_id);
create index if not exists access_roles_created_by_idx on public.access_roles(created_by);
create index if not exists access_role_permissions_created_by_idx on public.access_role_permissions(created_by);
create index if not exists teams_created_by_idx on public.teams(created_by);
create index if not exists team_memberships_admin_user_id_idx on public.team_memberships(admin_user_id);
create index if not exists team_memberships_created_by_idx on public.team_memberships(created_by);

insert into public.access_permissions(permission_key,module,action,label,description,sort_order)
values
  ('dashboard.read','dashboard','read','Ver dashboard','Consultar el dashboard operativo/ejecutivo.',10),
  ('clients.read','clients','read','Ver clientes','Consultar clientes.',20),
  ('clients.write','clients','write','Gestionar clientes','Crear y modificar clientes.',21),
  ('sales.read','sales','read','Ver ventas','Consultar Sales Orders y workspace comercial.',30),
  ('sales.write','sales','write','Gestionar ventas','Crear y modificar Sales Orders y abastecimiento comercial.',31),
  ('procurement.read','procurement','read','Ver compras','Consultar proveedores, Purchase Orders y cuentas por pagar.',40),
  ('procurement.write','procurement','write','Gestionar compras','Crear y modificar proveedores, Purchase Orders y procesos relacionados.',41),
  ('warehouse.read','warehouse','read','Ver almacenes e inventario','Consultar WR, almacenes e inventario.',50),
  ('warehouse.write','warehouse','write','Gestionar almacenes e inventario','Crear/actualizar WR y movimientos operativos autorizados.',51),
  ('logistics.read','logistics','read','Ver logística','Consultar Cargues, contenedores y Tracking.',60),
  ('logistics.write','logistics','write','Gestionar logística','Crear/modificar Cargues, contenedores y eventos operativos.',61),
  ('documents.read','documents','read','Ver documentos','Consultar documentos del ERP y documentos Cuba.',70),
  ('documents.write','documents','write','Gestionar documentos','Subir, generar, versionar o eliminar documentos permitidos.',71),
  ('finance.read','finance','read','Ver finanzas','Consultar facturación, cobros, anticipos, costos, rentabilidad y AP.',80),
  ('finance.write','finance','write','Gestionar finanzas','Emitir facturas, registrar/revertir cobros, anticipos, pagos y costos.',81),
  ('reports.read','reports','read','Ver reportes','Consultar y exportar reportes.',90),
  ('notifications.read','notifications','read','Ver notificaciones','Consultar alertas y notificaciones operativas.',100),
  ('notifications.manage','notifications','manage','Gestionar notificaciones','Leer, posponer, reconocer o resolver alertas según lifecycle.',101),
  ('publications.read','publications','read','Ver publicaciones','Consultar publicaciones comerciales.',110),
  ('publications.write','publications','write','Gestionar publicaciones','Crear y modificar publicaciones comerciales.',111),
  ('administration.workers.read','administration.workers','read','Ver trabajadores','Consultar directorio de trabajadores.',120),
  ('administration.workers.write','administration.workers','write','Gestionar trabajadores','Crear, modificar, activar o desactivar trabajadores.',121),
  ('administration.users.manage','administration.users','manage','Gestionar usuarios','Crear, editar, activar/desactivar usuarios y asignar roles/equipos.',130),
  ('administration.roles.manage','administration.roles','manage','Gestionar roles','Crear, editar y configurar roles/permisos.',131),
  ('administration.teams.manage','administration.teams','manage','Gestionar equipos','Crear, editar y gestionar membresías de equipos.',132),
  ('administration.audit.read','administration.audit','read','Ver auditoría','Consultar el historial de auditoría.',140)
on conflict (permission_key) do update
set module=excluded.module,
    action=excluded.action,
    label=excluded.label,
    description=excluded.description,
    sort_order=excluded.sort_order,
    is_active=true;

insert into public.access_roles(name,description,is_system,is_active)
values ('Administrador','Acceso completo a todos los módulos y acciones del ERP.',true,true)
on conflict (name) do update
set description=excluded.description,
    is_system=true,
    is_active=true,
    updated_at=now();

insert into public.access_role_permissions(access_role_id,permission_key)
select r.id,p.permission_key
from public.access_roles r
cross join public.access_permissions p
where r.name='Administrador' and r.is_system=true and p.is_active=true
on conflict (access_role_id,permission_key) do nothing;

update public.admin_users au
set access_role_id=(select id from public.access_roles where name='Administrador' and is_system=true limit 1),
    updated_at=now()
where au.role='admin' and au.access_role_id is null;

alter table public.admin_users
  drop constraint if exists admin_users_access_role_required;
alter table public.admin_users
  add constraint admin_users_access_role_required
  check (role='master_admin' or access_role_id is not null) not valid;
alter table public.admin_users validate constraint admin_users_access_role_required;

create or replace function public.guard_last_master_admin()
returns trigger
language plpgsql
set search_path=public
as $$
declare
  v_other_active_master_count integer;
begin
  if old.role='master_admin' and old.is_active=true and (
    tg_op='DELETE'
    or (tg_op='UPDATE' and (new.role is distinct from 'master_admin' or new.is_active is distinct from true))
  ) then
    select count(*) into v_other_active_master_count
    from public.admin_users
    where id<>old.id and role='master_admin' and is_active=true;
    if v_other_active_master_count=0 then
      raise exception 'LAST_MASTER_ADMIN_REQUIRED';
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists admin_users_guard_last_master on public.admin_users;
create trigger admin_users_guard_last_master
before update of role,is_active or delete on public.admin_users
for each row execute function public.guard_last_master_admin();

create or replace function public.guard_system_access_role()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if tg_op='DELETE' and old.is_system=true then
    raise exception 'SYSTEM_ACCESS_ROLE_DELETE_FORBIDDEN';
  end if;
  if tg_op='UPDATE' and old.is_system=true and (
    new.name is distinct from old.name
    or new.is_system is distinct from true
    or new.is_active is distinct from true
  ) then
    raise exception 'SYSTEM_ACCESS_ROLE_IMMUTABLE';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists access_roles_guard_system on public.access_roles;
create trigger access_roles_guard_system
before update or delete on public.access_roles
for each row execute function public.guard_system_access_role();

create or replace view public.admin_effective_permissions
with (security_invoker=true)
as
select au.id as admin_user_id,
       arp.permission_key
from public.admin_users au
join public.access_roles ar on ar.id=au.access_role_id and ar.is_active=true
join public.access_role_permissions arp on arp.access_role_id=ar.id
join public.access_permissions ap on ap.permission_key=arp.permission_key and ap.is_active=true
where au.is_active=true and au.role='admin'
union
select au.id as admin_user_id,
       ap.permission_key
from public.admin_users au
cross join public.access_permissions ap
where au.is_active=true and au.role='master_admin' and ap.is_active=true;

create or replace view public.admin_team_directory
with (security_invoker=true)
as
select tm.admin_user_id,
       t.id as team_id,
       t.name as team_name,
       t.description as team_description,
       t.is_active as team_active,
       tm.created_at as membership_created_at
from public.team_memberships tm
join public.teams t on t.id=tm.team_id;

alter table public.access_permissions enable row level security;
alter table public.access_roles enable row level security;
alter table public.access_role_permissions enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;

revoke all on table public.access_permissions from public,anon,authenticated;
revoke all on table public.access_roles from public,anon,authenticated;
revoke all on table public.access_role_permissions from public,anon,authenticated;
revoke all on table public.teams from public,anon,authenticated;
revoke all on table public.team_memberships from public,anon,authenticated;
revoke all on table public.admin_effective_permissions from public,anon,authenticated;
revoke all on table public.admin_team_directory from public,anon,authenticated;

grant select,insert,update,delete on table public.access_permissions to service_role;
grant select,insert,update,delete on table public.access_roles to service_role;
grant select,insert,update,delete on table public.access_role_permissions to service_role;
grant select,insert,update,delete on table public.teams to service_role;
grant select,insert,update,delete on table public.team_memberships to service_role;
grant select on table public.admin_effective_permissions to service_role;
grant select on table public.admin_team_directory to service_role;
