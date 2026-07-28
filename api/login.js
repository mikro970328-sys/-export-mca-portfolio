import { createToken, fail, normalizeUsername, ok, readJson, supabase, verifyPassword, writeAudit } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
  try {
    const body = await readJson(req);
    const username = normalizeUsername(body.username || '');
    const password = String(body.password || '');
    const rows = await supabase('admin_users', {
      query: `?select=id,full_name,username,password_salt,password_hash,role,is_active,failed_attempts,locked_until&username_normalized=eq.${encodeURIComponent(username.toLowerCase())}&limit=1`
    });
    const user = rows?.[0];
    if (!user) return fail(res, 401, 'Usuario o contraseña incorrectos');
    if (!user.is_active) return fail(res, 403, 'Esta cuenta está desactivada');
    if (user.locked_until && new Date(user.locked_until) > new Date()) {
      return fail(res, 429, 'Cuenta bloqueada temporalmente. Intenta más tarde');
    }

    const valid = verifyPassword(password, user.password_salt, user.password_hash);
    if (!valid) {
      const attempts = Number(user.failed_attempts || 0) + 1;
      const lockedUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000).toISOString() : null;
      await supabase('admin_users', {
        method: 'PATCH',
        query: `?id=eq.${user.id}`,
        body: { failed_attempts: attempts >= 5 ? 0 : attempts, locked_until: lockedUntil }
      });
      return fail(res, 401, attempts >= 5 ? 'Cuenta bloqueada por 15 minutos' : 'Usuario o contraseña incorrectos');
    }

    await supabase('admin_users', {
      method: 'PATCH',
      query: `?id=eq.${user.id}`,
      body: { failed_attempts: 0, locked_until: null, last_login_at: new Date().toISOString() }
    });

    const admin = {
      admin: true,
      admin_id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };
    await writeAudit(admin, 'login', 'admin_user', user.id, {});
    return ok(res, { token: createToken(admin), user: { id: user.id, full_name: user.full_name, username: user.username, role: user.role } });
  } catch (error) {
    if (error.message === 'USERNAME_INVALID') return fail(res, 400, 'Nombre de usuario inválido');
    return fail(res, 400, error.message === 'JSON_INVALID' ? 'Solicitud inválida' : 'No se pudo iniciar sesión', error.message);
  }
}
