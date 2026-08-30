import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';

const cleanText = (value, max = 240) => String(value || '').trim().slice(0, max);
const uniqueStrings = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
const uniqueIds = values => uniqueStrings(values);

async function rpc(name, body) {
  return supabase(`rpc/${name}`, { method:'POST', body });
}

async function listPermissions() {
  return supabase('access_permissions', {
    query:'?select=permission_key,module,action,label,description,is_active,sort_order&is_active=eq.true&order=sort_order.asc,permission_key.asc'
  });
}

async function listRoles() {
  const [roles, grants] = await Promise.all([
    supabase('access_roles', { query:'?select=id,name,description,is_system,is_active,created_at,updated_at&order=is_system.desc,name.asc' }),
    supabase('access_role_permissions', { query:'?select=access_role_id,permission_key&order=permission_key.asc' })
  ]);
  const map = new Map();
  for (const grant of grants || []) {
    if (!map.has(grant.access_role_id)) map.set(grant.access_role_id, []);
    map.get(grant.access_role_id).push(grant.permission_key);
  }
  return (roles || []).map(role => ({ ...role, permission_keys:map.get(role.id) || [] }));
}

async function listTeams() {
  const [teams, memberships] = await Promise.all([
    supabase('teams', { query:'?select=id,name,description,is_active,created_at,updated_at&order=name.asc' }),
    supabase('team_memberships', { query:'?select=team_id,admin_user_id,created_at&order=created_at.asc' })
  ]);
  const map = new Map();
  for (const row of memberships || []) {
    if (!map.has(row.team_id)) map.set(row.team_id, []);
    map.get(row.team_id).push(row.admin_user_id);
  }
  return (teams || []).map(team => ({ ...team, member_ids:map.get(team.id) || [] }));
}

async function listUsers() {
  return supabase('admin_users', {
    query:'?select=id,full_name,username,role,is_active,access_role_id&order=full_name.asc'
  });
}

async function validatePermissionKeys(keys) {
  const wanted = uniqueStrings(keys);
  if (!wanted.length) return [];
  const rows = await listPermissions();
  const allowed = new Set((rows || []).map(row => row.permission_key));
  if (wanted.some(key => !allowed.has(key))) throw new Error('ACCESS_PERMISSION_INVALID');
  return wanted;
}

export default async function handler(req, res) {
  const resource = String(req.query?.resource || 'snapshot').toLowerCase();
  const permission = resource === 'teams' ? 'administration.teams.manage' : 'administration.roles.manage';
  const actor = await authorizeAdmin(req, res, permission);
  if (!actor) return;

  try {
    if (req.method === 'GET') {
      if (resource === 'permissions') return ok(res, { permissions:await listPermissions() || [] });
      if (resource === 'roles') return ok(res, { roles:await listRoles() });
      if (resource === 'teams') return ok(res, { teams:await listTeams(), users:await listUsers() || [] });
      if (resource === 'snapshot') {
        const [permissions, roles, teams, users] = await Promise.all([listPermissions(), listRoles(), listTeams(), listUsers()]);
        return ok(res, { permissions:permissions || [], roles, teams, users:users || [] });
      }
      return fail(res, 400, 'Recurso inválido');
    }

    const body = await readJson(req);

    if (resource === 'roles') {
      if (req.method === 'POST') {
        const name = cleanText(body.name, 80);
        const description = cleanText(body.description, 500) || null;
        if (name.length < 2) return fail(res, 400, 'El nombre del rol es obligatorio');
        const permissionKeys = await validatePermissionKeys(body.permission_keys);
        const rows = await supabase('access_roles', {
          method:'POST',
          body:{ name, description, is_system:false, is_active:true, created_by:actor.admin_id }
        });
        const role = rows?.[0] || null;
        if (!role) throw new Error('ACCESS_ROLE_CREATE_FAILED');
        await rpc('set_access_role_permissions', {
          p_access_role_id:role.id,
          p_permission_keys:permissionKeys,
          p_actor:actor.admin_id
        });
        await writeAudit(actor, 'create_access_role', 'access_role', role.id, { name, permission_keys:permissionKeys });
        return ok(res, { role:{ ...role, permission_keys:permissionKeys } });
      }

      if (req.method === 'PATCH') {
        const id = String(body.id || '').trim();
        if (!id) return fail(res, 400, 'Rol inválido');
        const rows = await supabase('access_roles', { query:`?select=id,name,is_system,is_active&id=eq.${encodeURIComponent(id)}&limit=1` });
        const current = rows?.[0] || null;
        if (!current) return fail(res, 404, 'Rol no encontrado');
        const patch = { updated_at:new Date().toISOString() };
        if (body.name !== undefined) {
          if (current.is_system) return fail(res, 400, 'El rol de sistema no puede renombrarse');
          const name = cleanText(body.name, 80);
          if (name.length < 2) return fail(res, 400, 'Nombre de rol inválido');
          patch.name = name;
        }
        if (body.description !== undefined) patch.description = cleanText(body.description, 500) || null;
        if (body.is_active !== undefined) {
          if (current.is_system && body.is_active === false) return fail(res, 400, 'El rol de sistema no puede desactivarse');
          patch.is_active = Boolean(body.is_active);
        }
        const hasPermissions = body.permission_keys !== undefined;
        if (hasPermissions && current.is_system) return fail(res, 400, 'Los permisos del rol de sistema son administrados por el sistema');
        const permissionKeys = hasPermissions ? await validatePermissionKeys(body.permission_keys) : null;
        if (Object.keys(patch).length > 1) {
          await supabase('access_roles', { method:'PATCH', query:`?id=eq.${encodeURIComponent(id)}`, body:patch });
        }
        if (hasPermissions) {
          await rpc('set_access_role_permissions', {
            p_access_role_id:id,
            p_permission_keys:permissionKeys,
            p_actor:actor.admin_id
          });
        }
        await writeAudit(actor, 'update_access_role', 'access_role', id, {
          fields:Object.keys(patch),
          ...(hasPermissions ? { permission_keys:permissionKeys } : {})
        });
        return ok(res, { updated:true });
      }

      return fail(res, 405, 'Método no permitido');
    }

    if (resource === 'teams') {
      if (req.method === 'POST') {
        const name = cleanText(body.name, 80);
        const description = cleanText(body.description, 500) || null;
        if (name.length < 2) return fail(res, 400, 'El nombre del equipo es obligatorio');
        const rows = await supabase('teams', {
          method:'POST',
          body:{ name, description, is_active:true, created_by:actor.admin_id }
        });
        const team = rows?.[0] || null;
        if (!team) throw new Error('TEAM_CREATE_FAILED');
        const memberIds = uniqueIds(body.member_ids);
        await rpc('set_team_members', { p_team_id:team.id, p_admin_user_ids:memberIds, p_actor:actor.admin_id });
        await writeAudit(actor, 'create_team', 'team', team.id, { name, member_ids:memberIds });
        return ok(res, { team:{ ...team, member_ids:memberIds } });
      }

      if (req.method === 'PATCH') {
        const id = String(body.id || '').trim();
        if (!id) return fail(res, 400, 'Equipo inválido');
        const rows = await supabase('teams', { query:`?select=id,name,is_active&id=eq.${encodeURIComponent(id)}&limit=1` });
        const current = rows?.[0] || null;
        if (!current) return fail(res, 404, 'Equipo no encontrado');
        const patch = { updated_at:new Date().toISOString() };
        if (body.name !== undefined) {
          const name = cleanText(body.name, 80);
          if (name.length < 2) return fail(res, 400, 'Nombre de equipo inválido');
          patch.name = name;
        }
        if (body.description !== undefined) patch.description = cleanText(body.description, 500) || null;
        if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
        const hasMembers = body.member_ids !== undefined;
        const memberIds = hasMembers ? uniqueIds(body.member_ids) : null;
        if (Object.keys(patch).length > 1) {
          await supabase('teams', { method:'PATCH', query:`?id=eq.${encodeURIComponent(id)}`, body:patch });
        }
        if (hasMembers) {
          const activeAfter = body.is_active === undefined ? current.is_active : Boolean(body.is_active);
          if (!activeAfter && memberIds.length) return fail(res, 400, 'Un equipo inactivo no puede conservar miembros activos');
          await rpc('set_team_members', { p_team_id:id, p_admin_user_ids:memberIds, p_actor:actor.admin_id });
        } else if (body.is_active === false) {
          await rpc('set_team_members', { p_team_id:id, p_admin_user_ids:[], p_actor:actor.admin_id });
        }
        await writeAudit(actor, 'update_team', 'team', id, {
          fields:Object.keys(patch),
          ...(hasMembers ? { member_ids:memberIds } : {})
        });
        return ok(res, { updated:true });
      }
      return fail(res, 405, 'Método no permitido');
    }

    return fail(res, 400, 'Recurso inválido');
  } catch (error) {
    if (error.message.includes('access_roles_name_key')) return fail(res, 409, 'Ya existe un rol con ese nombre');
    if (error.message.includes('teams_name_key')) return fail(res, 409, 'Ya existe un equipo con ese nombre');
    if (error.message.includes('ACCESS_PERMISSION_INVALID')) return fail(res, 400, 'Uno de los permisos seleccionados no es válido');
    if (error.message.includes('SYSTEM_ACCESS_ROLE')) return fail(res, 400, 'El rol de sistema no admite ese cambio');
    if (error.message.includes('TEAM_INACTIVE')) return fail(res, 400, 'El equipo está inactivo');
    if (error.message.includes('ADMIN_USER_INVALID')) return fail(res, 400, 'Uno de los usuarios seleccionados no está disponible');
    return fail(res, 500, 'No se pudo completar la operación', error.message);
  }
}
