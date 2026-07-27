import crypto from 'node:crypto';
import { createToken, fail, ok, readJson } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
  try {
    const { password = '' } = await readJson(req);
    const expected = process.env.ADMIN_PASSWORD || '';
    if (!expected) return fail(res, 500, 'ADMIN_PASSWORD no está configurada');
    const supplied = String(password);
    const valid = supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
    if (!valid) return fail(res, 401, 'Contraseña incorrecta');
    return ok(res, { token: createToken({ admin: true }) });
  } catch (error) {
    return fail(res, 400, error.message === 'JSON_INVALID' ? 'Solicitud inválida' : 'No se pudo iniciar sesión');
  }
}
