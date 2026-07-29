import { fail, hashPassword, normalizeUsername, ok, readJson, requireMasterAdmin, supabase, writeAudit } from './_lib.js';

const publicFields = 'id,full_name,username,role,is_active,last_login_at,created_at,updated_at';
const workerFields = 'id,full_name,phone,position,is_active,created_at,updated_at';
const cleanPhone = value => String(value || '').trim().replace(/[^+\d]/g, '');

export default async function handler(req, res) {
  const master = requireMasterAdmin(req, res);
  if (!master) return;

  const resource = String(req.query?.resource || 'admins').toLowerCase();

  try {
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
          body: { full_name: fullName, phone, position: position || null, is_active: true, created_by: master.admin_id }
        });
        const worker = rows?.[0] || null;
        await writeAudit(master, 'create_worker', 'worker', worker?.id, { full_name: fullName, phone, position });
        return ok(res, { worker });
      }

      if (req.method === 'PATCH') {
        const id = String(body.id || '');
        if (!id) return fail(res, 400, 'Trabajador inválido');
        const patch = { updated_at: new Date().toISOString() };
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
        if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
        await supabase('workers', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}`, body: patch });
        await writeAudit(master, 'update_worker', 'worker', id, { fields: Object.keys(patch) });
        return ok(res, { updated: true });
      }

      return fail(res, 405, 'Método no permitido');
    }

    if (req.method === 'GET') {
      const admins = await supabase('admin_users', { query: `?select=${publicFields}&order=created_at.asc` });
      return ok(res, { admins: admins || [] });
    }

    const body = await readJson(req);

    if (req.method === 'POST') {
      const fullName = String(body.full_name || '').trim();
      const username = normalizeUsername(body.username || '');
      const password = String(body.password || '');
      if (fullName.length < 3) return fail(res, 400, 'El nombre completo es obligatorio');
      const { salt, hash } = hashPassword(password);
      const rows = await supabase('admin_users', {
        method: 'POST',
        body: {
          full_name: fullName,
          username,
          password_salt: salt,
          password_hash: hash,
          role: 'admin',
          is_active: true,
          created_by: master.admin_id
        }
      });
      const created = rows?.[0];
      await writeAudit(master, 'create_admin', 'admin_user', created?.id, { username });
      return ok(res, { admin: created ? { id: created.id, full_name: created.full_name, username: created.username, role: created.role, is_active: created.is_active } : null });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) return fail(res, 400, 'Administrador inválido');
      if (id === master.admin_id && body.is_active === false) return fail(res, 400, 'No puedes desactivar tu propia cuenta maestra');

      const patch = {};
      if (body.full_name !== undefined) {
        const fullName = String(body.full_name).trim();
        if (fullName.length < 3) return fail(res, 400, 'Nombre inválido');
        patch.full_name = fullName;
      }
      if (body.username !== undefined) patch.username = normalizeUsername(body.username);
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      if (body.password) {
        const { salt, hash } = hashPassword(String(body.password));
        patch.password_salt = salt;
        patch.password_hash = hash;
        patch.password_changed_at = new Date().toISOString();
        patch.failed_attempts = 0;
        patch.locked_until = null;
      }
      if (!Object.keys(patch).length) return fail(res, 400, 'No hay cambios para guardar');

      await supabase('admin_users', { method: 'PATCH', query: `?id=eq.${id}`, body: patch });
      await writeAudit(master, 'update_admin', 'admin_user', id, { fields: Object.keys(patch).filter(x => !x.includes('password') && x !== 'password_salt') });
      return ok(res, { updated: true });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    if (error.message === 'USERNAME_INVALID') return fail(res, 400, 'El usuario debe tener entre 4 y 32 caracteres y solo usar letras, números, punto, guion o guion bajo');
    if (error.message === 'PASSWORD_TOO_SHORT') return fail(res, 400, 'La contraseña debe tener al menos 10 caracteres');
    if (error.message.includes('admin_users_username_unique')) return fail(res, 409, 'Ese nombre de usuario ya existe');
    if (error.message.includes('workers_phone_unique')) return fail(res, 409, 'Ese teléfono ya está registrado');
    return fail(res, 500, 'No se pudo completar la operación', error.message);
  }
}