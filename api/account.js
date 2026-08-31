import { authenticateAdmin, createToken, fail, hashPassword, loadAdminAccessContext, ok, readJson, supabase, verifyPassword, writeAudit } from './_lib.js';

const publicFields = 'id,full_name,username,role,is_active,last_login_at,password_changed_at,created_at,updated_at,access_role_id';

export default async function handler(req, res) {
  const admin = await authenticateAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const rows = await supabase('admin_users', {
        query: `?select=${publicFields}&id=eq.${encodeURIComponent(admin.admin_id)}&limit=1`
      });
      const account = rows?.[0] || null;
      if (!account || account.is_active === false) return fail(res, 403, 'La cuenta no está disponible');
      const access = await loadAdminAccessContext(admin.admin_id);
      return ok(res, { account: { ...account, ...access } });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const currentPassword = String(body.current_password || '');
      const newPassword = String(body.new_password || '');
      if (!currentPassword) return fail(res, 400, 'Escribe tu contraseña actual');
      if (!newPassword) return fail(res, 400, 'Escribe la nueva contraseña');
      if (currentPassword === newPassword) return fail(res, 400, 'La nueva contraseña debe ser diferente a la actual');

      const rows = await supabase('admin_users', {
        query: `?select=id,username,is_active,password_salt,password_hash&id=eq.${encodeURIComponent(admin.admin_id)}&limit=1`
      });
      const account = rows?.[0] || null;
      if (!account || account.is_active === false) return fail(res, 403, 'La cuenta no está disponible');
      if (!verifyPassword(currentPassword, account.password_salt, account.password_hash)) {
        await writeAudit(admin, 'change_own_password_failed', 'admin_user', admin.admin_id, { reason: 'current_password_invalid' });
        return fail(res, 400, 'La contraseña actual no es correcta');
      }

      const { salt, hash } = hashPassword(newPassword);
      const changedRows = await supabase('rpc/change_own_admin_password', {
        method: 'POST',
        body: {
          p_admin_user_id: admin.admin_id,
          p_expected_password_hash: account.password_hash,
          p_password_salt: salt,
          p_password_hash: hash
        }
      });
      const changed = changedRows?.[0] || null;
      if (!changed?.session_version) throw new Error('SESSION_VERSION_MISSING');

      const token = createToken({ ...admin, session_version: Number(changed.session_version) });
      return ok(res, {
        updated: true,
        password_changed_at: changed.password_changed_at,
        token
      });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    if (error.message === 'PASSWORD_TOO_SHORT') return fail(res, 400, 'La contraseña debe tener al menos 10 caracteres');
    if (error.message.includes('PASSWORD_STATE_CHANGED')) return fail(res, 409, 'La contraseña cambió en otra sesión. Inicia sesión nuevamente.');
    if (error.message.includes('ADMIN_USER_UNAVAILABLE')) return fail(res, 403, 'La cuenta no está disponible');
    return fail(res, 500, 'No se pudo actualizar la cuenta', error.message);
  }
}
