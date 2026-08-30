import { authorizeAdmin, fail, hashPassword, normalizeUsername, ok, readJson, supabase, writeAudit } from './_lib.js';

const publicFields = 'id,full_name,username,role,is_active,last_login_at,created_at,updated_at,access_role_id';
const workerFields = 'id,full_name,phone,position,is_active,deactivation_reason,deactivated_at,created_at,updated_at';
const cleanPhone = value => String(value || '').trim().replace(/[^+\d]/g, '');
const uniqueIds = values => [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))];

async function ensureAccessRole(id) {
  const roleId = String(id || '').trim();
  if (!roleId) throw new Error('ACCESS_ROLE_REQUIRED');
  const rows = await supabase('access_roles', {
    query: `?select=id,name,is_active&id=eq.${encodeURIComponent(roleId)}&is_active=eq.true&limit=1`
  });
  if (!rows?.length) throw new Error('ACCESS_ROLE_INVALID');
  return rows[0];
}

async function setUserTeams(userId, teamIds, actorId) {
  const ids = uniqueIds(teamIds);
  await supabase('rpc/set_admin_teams', {
    method: 'POST',
    body: { p_admin_user_id:userId, p_team_ids:ids, p_actor:actorId }
  });
  return ids;
}

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
    teamMap.get(row.admin_user_id).push({ id:row.team_id, name:row.team_name, description:row.team_description, is_active:row.team_active });
  }
  return {
    admins:(admins || []).map(row => ({ ...row, teams:teamMap.get(row.id) || [] })),
    roles:roles || [],
    teams:teamsCatalog || []
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

        const rows = await supabase('workers', {
          method: 'POST',
          body: { full_name: fullName, phone, position: position || null, is_active: true, created_by: actor.admin_id }
        });
        const worker = rows?.[0] || null;
        await writeAudit(actor, 'create_worker', 'worker', worker?.id, { full_name: fullName, phone, position });
        return ok(res, { worker });
      }

      if (req.method === 'PATCH') {
        const id = String(body.id || '');
        if (!id) return fail(res, 400, 'Trabajador inválido');
        const patch = { updated_at: new Date().toISOString() };
        let statusEvent = null;

        if (body.full_name !== undefined) {
          const fullName = String(body.full_name || '').trim();
          if (fullName.length < 3) return fail(res, 400, 'Nombre inválido');
          patch.full_name = fullName;
        }
        if (body.phone !== undefined) {
          const phone = cleanPhone(body.phone);
          if (phone.length < 8) return fail(res, 400, 'Teléfono inválido');
          patch.phone = phone;
        }
        if (body.position !== undefined) patch.position = String(body.position || '').trim() || null;
        if (body.is_active !== undefined) {
          const isActive = Boolean(body.is_active);
          patch.is_active = isActive;
          if (isActive) {
            patch.deactivation_reason = null;
            patch.deactivated_at = null;
            statusEvent = { action: 'reactivated', reason: String(body.reactivation_reason || '').trim() || null };
          } else {
            const reason = String(body.deactivation_reason || '').trim();
            if (reason.length < 3) return fail(res, 400, 'El motivo de desactivación es obligatorio');
            patch.deactivation_reason = reason;
            patch.deactivated_at = new Date().toISOString();
            statusEvent = { action: 'deactivated', reason };
          }
        }

        await supabase('workers', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}`, body: patch });

        if (statusEvent) {
          await supabase('worker_status_history', {
            method: 'POST',
            body: { worker_id:id, action:statusEvent.action, reason:statusEvent.reason, changed_by:actor.admin_id }
          });
        }

        await writeAudit(
          actor,
          patch.is_active === false ? 'deactivate_worker' : patch.is_active === true ? 'reactivate_worker' : 'update_worker',
          'worker',
          id,
          {
            fields: Object.keys(patch),
            deactivation_reason: patch.deactivation_reason || undefined,
            reactivation_reason: statusEvent?.action === 'reactivated' ? statusEvent.reason || undefined : undefined
          }
        );
        return ok(res, { updated: true });
      }

      return fail(res, 405, 'Método no permitido');
    }

    if (req.method === 'GET') {
      return ok(res, await loadUsers());
    }

    const body = await readJson(req);

    if (req.method === 'POST') {
      const fullName = String(body.full_name || '').trim();
      const username = normalizeUsername(body.username || '');
      const password = String(body.password || '');
      if (fullName.length < 3) return fail(res, 400, 'El nombre completo es obligatorio');
      const accessRole = await ensureAccessRole(body.access_role_id);
      const { salt, hash } = hashPassword(password);
      const rows = await supabase('admin_users', {
        method: 'POST',
        body: {
          full_name: fullName,
          username,
          password_salt: salt,
          password_hash: hash,
          role: 'admin',
          access_role_id: accessRole.id,
          is_active: true,
          created_by: actor.admin_id
        }
      });
      const created = rows?.[0];
      const teamIds = created ? await setUserTeams(created.id, body.team_ids, actor.admin_id) : [];
      await writeAudit(actor, 'create_admin', 'admin_user', created?.id, { username, access_role_id:accessRole.id, access_role_name:accessRole.name, team_ids:teamIds });
      return ok(res, { admin: created ? { id: created.id, full_name: created.full_name, username: created.username, role: created.role, access_role_id:created.access_role_id, is_active: created.is_active, team_ids:teamIds } : null });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) return fail(res, 400, 'Administrador inválido');
      const currentRows = await supabase('admin_users', { query:`?select=id,role,is_active,access_role_id&id=eq.${encodeURIComponent(id)}&limit=1` });
      const current = currentRows?.[0] || null;
      if (!current) return fail(res, 404, 'Administrador no encontrado');
      if (current.role === 'master_admin' && actor.role !== 'master_admin') return fail(res, 403, 'Solo el administrador maestro puede modificar otra cuenta maestra');
      if (id === actor.admin_id && body.is_active === false) return fail(res, 400, 'No puedes desactivar tu propia cuenta');

      const patch = { updated_at:new Date().toISOString() };
      if (body.full_name !== undefined) {
        const fullName = String(body.full_name).trim();
        if (fullName.length < 3) return fail(res, 400, 'Nombre inválido');
        patch.full_name = fullName;
      }
      if (body.username !== undefined) patch.username = normalizeUsername(body.username);
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      if (body.access_role_id !== undefined) {
        if (current.role === 'master_admin') return fail(res, 400, 'La cuenta maestra no utiliza un rol configurable');
        const accessRole = await ensureAccessRole(body.access_role_id);
        patch.access_role_id = accessRole.id;
      }
      if (body.password) {
        const { salt, hash } = hashPassword(String(body.password));
        patch.password_salt = salt;
        patch.password_hash = hash;
        patch.password_changed_at = new Date().toISOString();
        patch.failed_attempts = 0;
        patch.locked_until = null;
      }

      const hasTeams = body.team_ids !== undefined;
      if (Object.keys(patch).length === 1 && !hasTeams) return fail(res, 400, 'No hay cambios para guardar');
      if (Object.keys(patch).length > 1) {
        await supabase('admin_users', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}`, body: patch });
      }
      const teamIds = hasTeams ? await setUserTeams(id, body.team_ids, actor.admin_id) : null;
      await writeAudit(actor, 'update_admin', 'admin_user', id, {
        fields: Object.keys(patch).filter(x => !x.includes('password') && x !== 'password_salt'),
        ...(teamIds ? { team_ids:teamIds } : {})
      });
      return ok(res, { updated: true });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    if (error.message === 'USERNAME_INVALID') return fail(res, 400, 'El usuario debe tener entre 4 y 32 caracteres y solo usar letras, números, punto, guion o guion bajo');
    if (error.message === 'PASSWORD_TOO_SHORT') return fail(res, 400, 'La contraseña debe tener al menos 10 caracteres');
    if (error.message === 'ACCESS_ROLE_REQUIRED') return fail(res, 400, 'Selecciona un rol de acceso');
    if (error.message === 'ACCESS_ROLE_INVALID') return fail(res, 400, 'El rol seleccionado no está disponible');
    if (error.message.includes('admin_users_username_unique')) return fail(res, 409, 'Ese nombre de usuario ya existe');
    if (error.message.includes('workers_phone_unique')) return fail(res, 409, 'Ese teléfono ya está registrado');
    if (error.message.includes('TEAM_INVALID')) return fail(res, 400, 'Uno de los equipos seleccionados no está disponible');
    if (error.message.includes('LAST_MASTER_ADMIN_REQUIRED')) return fail(res, 409, 'Debe existir al menos una cuenta maestra activa');
    return fail(res, 500, 'No se pudo completar la operación', error.message);
  }
}
