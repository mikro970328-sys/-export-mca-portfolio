import { createToken, fail, normalizeUsername, ok, readJson, supabase, verifyPassword } from './_lib.js';

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
      const failureRows = await supabase('rpc/register_admin_login_failure', {
        method: 'POST',
        body: { p_admin_user_id: user.id }
      });
      const failure = failureRows?.[0] || {};
      return fail(res, 401, failure.locked ? 'Cuenta bloqueada por 15 minutos' : 'Usuario o contraseña incorrectos');
    }

    const loginRows = await supabase('rpc/register_admin_login_success', {
      method: 'POST',
      body: { p_admin_user_id: user.id }
    });
    const login = loginRows?.[0] || null;
    if (!login?.session_version) throw new Error('LOGIN_SESSION_VERSION_MISSING');

    const admin = {
      admin: true,
      admin_id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      session_version: Number(login.session_version)
    };
    return ok(res, {
      token: createToken(admin),
      user: { id: user.id, full_name: user.full_name, username: user.username, role: user.role }
    });
  } catch (error) {
    if (error.message === 'USERNAME_INVALID') return fail(res, 400, 'Nombre de usuario inválido');
    if (error.message.includes('ACCOUNT_LOCKED')) return fail(res, 429, 'Cuenta bloqueada temporalmente. Intenta más tarde');
    if (error.message.includes('ADMIN_USER_UNAVAILABLE')) return fail(res, 403, 'Esta cuenta no está disponible');
    return fail(res, 400, error.message === 'JSON_INVALID' ? 'Solicitud inválida' : 'No se pudo iniciar sesión', error.message);
  }
}
