import { authenticateAdmin, fail, hashPassword, loadAdminAccessContext, ok, readJson, supabase, verifyPassword, writeAudit } from './_lib.js';

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
      const changedAt = new Date().toISOString();
      await supabase('admin_users', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(admin.admin_id)}`,
        body: {
          password_salt: salt,
          password_hash: hash,
          password_changed_at: changedAt,
          failed_attempts: 0,
          locked_until: null,
          updated_at: changedAt
        }
      });

      await writeAudit(admin, 'change_own_password', 'admin_user', admin.admin_id, {});
      return ok(res, { updated: true, password_changed_at: changedAt });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    if (error.message === 'PASSWORD_TOO_SHORT') return fail(res, 400, 'La contraseña debe tener al menos 10 caracteres');
    return fail(res, 500, 'No se pudo actualizar la cuenta', error.message);
  }
}
