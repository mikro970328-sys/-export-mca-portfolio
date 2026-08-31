import { authorizeAdmin, createToken, fail, hashPassword, normalizeUsername, ok, readJson, supabase } from './_lib.js';

const publicFields = 'id,full_name,username,role,is_active,last_login_at,created_at,updated_at,access_role_id';
const workerFields = 'id,full_name,phone,position,is_active,deactivation_reason,deactivated_at,created_at,updated_at';
const cleanPhone = value => String(value || '').trim().replace(/[^+\d]/g, '');
const uniqueIds = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];
const rpc = (name, body) => supabase(`rpc/${name}`, { method: 'POST', body });

async function loadUsers() {
  const [admins, memberships, roles, teamsCatalog] = await Promise.all([
    supabase('admin_users', { query: `?select=${publicFields},access_roles:access_role_id(id,name,description,is_system,is_active)&order=created_at.asc` }),
    supabase('admin_team_directory', { query: '?select=admin_user_id,team_id,team_name,team_description,team_active&order=team_name.asc' }),
    supabase('access_roles', { query: '?select=id,name,description,is_system,is_active&order=is_system.desc,name.asc' }),
    supabase('teams', { query: '?select=id,name,description,is_active&order=name.asc' })
  ]);
  const teamMap = new Map();
  for (const row of memberships || []) {
    if (!teamMap.has(row.admin_user_id)) teamMap.set(row.admin_user_id, []);
    teamMap.get(row.admin_user_id).push({ id: row.team_id, name: row.team_name, description: row.team_description, is_active: row.team_active });
  }
  return {
    admins: (admins || []).map(row => ({ ...row, teams: teamMap.get(row.id) || [] })),
    roles: roles || [],
    teams: teamsCatalog || []
  };
}

export default async function handler(req, res) {
  const resource = String(req.query?.resource || 'admins').toLowerCase();
  const isWrite = req.method !== 'GET';
  const permission = resource === 'worker_history'
    ? 'administration.workers.read'
    : resource === 'workers'
      ? (isWrite ? 'administration.workers.write' : 'administration.workers.read')
      : 'administration.users.manage';
  const actor = await authorizeAdmin(req, res, permission);
  if (!actor) return;

  try {
    if (resource === 'worker_history') {
      if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');
      const workerId = String(req.query?.worker_id || '');
      if (!workerId) return fail(res, 400, 'Trabajador inválido');
      const history = await supabase('worker_status_history', {
        query: `?select=id,worker_id,action,reason,changed_by,created_at&worker_id=eq.${encodeURIComponent(workerId)}&order=created_at.desc`
      });
      return ok(res, { history: history || [] });
    }

    if (resource === 'workers') {
      if (req.method === 'GET') {
        const workers = await supabase('workers', { query: `?select=${workerFields}&order=full_name.asc` });
        return ok(res, { workers: workers || [] });
      }

      const body = await readJson(req);
      if (req.method === 'POST') {
        const fullName = String(body.full_name || '').trim();
        const phone = cleanPhone(body.phone);
        const position = String(body.position || '').trim();
        if (fullName.length < 3) return fail(res, 400, 'El nombre completo es obligatorio');
        if (phone.length < 8) return fail(res, 400, 'El número de teléfono no es válido');
        const rows = await rpc('create_worker_with_audit', {
          p_actor: actor.admin_id,
          p_full_name: fullName,
          p_phone: phone,
          p_position: position || null
        });
        return ok(res, { worker: rows?.[0] || null });
      }

      if (req.method === 'PATCH') {
        const id = String(body.id || '');
        if (!id) return fail(res, 400, 'Trabajador inválido');
        const patch = {};
        if (body.full_name !== undefined) patch.full_name = String(body.full_name || '').trim();
        if (body.phone !== undefined) patch.phone = cleanPhone(body.phone);
        if (body.position !== undefined) patch.position = String(body.position || '').trim() || null;
        if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
        if (body.deactivation_reason !== undefined) patch.deactivation_reason = String(body.deactivation_reason || '').trim();
        if (body.reactivation_reason !== undefined) patch.reactivation_reason = String(body.reactivation_reason || '').trim();
        if (!Object.keys(patch).length) return fail(res, 400, 'No hay cambios para guardar');
        await rpc('update_worker_with_audit', { p_worker_id: id, p_actor: actor.admin_id, p_patch: patch });
        return ok(res, { updated: true });
      }

      return fail(res, 405, 'Método no permitido');
    }

    if (req.method === 'GET') return ok(res, await loadUsers());

    const body = await readJson(req);

    if (req.method === 'POST') {
      const fullName = String(body.full_name || '').trim();
      const username = normalizeUsername(body.username || '');
      const password = String(body.password || '');
      if (fullName.length < 3) return fail(res, 400, 'El nombre completo es obligatorio');
      const accessRoleId = String(body.access_role_id || '').trim();
      if (!accessRoleId) return fail(res, 400, 'Selecciona un rol de acceso');
      const { salt, hash } = hashPassword(password);
      const teamIds = uniqueIds(body.team_ids);
      const rows = await rpc('create_admin_account_with_audit', {
        p_actor: actor.admin_id,
        p_full_name: fullName,
        p_username: username,
        p_password_salt: salt,
        p_password_hash: hash,
        p_access_role_id: accessRoleId,
        p_team_ids: teamIds
      });
      const created = rows?.[0] || null;
      return ok(res, { admin: created ? { ...created, team_ids: teamIds } : null });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) return fail(res, 400, 'Administrador inválido');

      if (body.revoke_sessions === true) {
        const rows = await rpc('revoke_admin_sessions', {
          p_admin_user_id: id,
          p_actor: actor.admin_id,
          p_reason: String(body.revoke_reason || '').trim() || null
        });
        const nextVersion = Number(rows?.[0]?.session_version || 0);
        const response = { updated: true, sessions_revoked: true };
        if (id === actor.admin_id && nextVersion > 0) {
          response.token = createToken({ ...actor, session_version: nextVersion });
        }
        return ok(res, response);
      }

      const patch = {};
      if (body.full_name !== undefined) patch.full_name = String(body.full_name || '').trim();
      if (body.username !== undefined) patch.username = normalizeUsername(body.username);
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      if (body.access_role_id !== undefined) patch.access_role_id = String(body.access_role_id || '').trim();
      if (body.password) {
        const { salt, hash } = hashPassword(String(body.password));
        patch.password_salt = salt;
        patch.password_hash = hash;
      }

      const hasTeams = body.team_ids !== undefined;
      const teamIds = hasTeams ? uniqueIds(body.team_ids) : null;
      if (!Object.keys(patch).length && !hasTeams) return fail(res, 400, 'No hay cambios para guardar');

      const rows = await rpc('update_admin_account_with_audit', {
        p_admin_user_id: id,
        p_actor: actor.admin_id,
        p_patch: patch,
        p_set_teams: hasTeams,
        p_team_ids: teamIds
      });
      const updated = rows?.[0] || null;
      const response = { updated: true };
      if (id === actor.admin_id && updated?.session_version && Number(updated.session_version) !== Number(actor.session_version)) {
        response.token = createToken({
          ...actor,
          username: updated.username,
          full_name: updated.full_name,
          role: updated.role,
          access_role_id: updated.access_role_id || null,
          session_version: Number(updated.session_version)
        });
      }
      return ok(res, response);
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    if (error.message === 'USERNAME_INVALID' || error.message.includes('USERNAME_INVALID')) return fail(res, 400, 'El usuario debe tener entre 4 y 32 caracteres y solo usar letras, números, punto, guion o guion bajo');
    if (error.message === 'PASSWORD_TOO_SHORT') return fail(res, 400, 'La contraseña debe tener al menos 10 caracteres');
    if (error.message.includes('ACCESS_ROLE_INVALID')) return fail(res, 400, 'El rol seleccionado no está disponible');
    if (error.message.includes('admin_users_username_unique')) return fail(res, 409, 'Ese nombre de usuario ya existe');
    if (error.message.includes('workers_phone_unique')) return fail(res, 409, 'Ese teléfono ya está registrado');
    if (error.message.includes('TEAM_INVALID')) return fail(res, 400, 'Uno de los equipos seleccionados no está disponible');
    if (error.message.includes('LAST_MASTER_ADMIN_REQUIRED')) return fail(res, 409, 'Debe existir al menos una cuenta maestra activa');
    if (error.message.includes('MASTER_ADMIN_CHANGE_FORBIDDEN')) return fail(res, 403, 'Solo el administrador maestro puede modificar otra cuenta maestra');
    if (error.message.includes('SELF_DEACTIVATION_FORBIDDEN')) return fail(res, 400, 'No puedes desactivar tu propia cuenta');
    if (error.message.includes('WORKER_DEACTIVATION_REASON_REQUIRED')) return fail(res, 400, 'El motivo de desactivación es obligatorio');
    if (error.message.includes('ADMIN_PERMISSION_DENIED')) return fail(res, 403, 'No tienes permiso para realizar esta acción');
    return fail(res, 500, 'No se pudo completar la operación', error.message);
  }
}
