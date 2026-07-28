import crypto from 'node:crypto';

const json = (res, status, body) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export function ok(res, body = {}) { return json(res, 200, body); }
export function fail(res, status, message, details) { return json(res, status, { error: message, ...(details ? { details } : {}) }); }

export async function readJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new Error('JSON_INVALID'); }
}

const b64url = (value) => Buffer.from(value).toString('base64url');
const sign = (value, secret) => crypto.createHmac('sha256', secret).update(value).digest('base64url');
const fromB64url = (value) => Buffer.from(value, 'base64url');

export function createToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET_MISSING');
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 12 }));
  return `${header}.${body}.${sign(`${header}.${body}`, secret)}`;
}

export function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret || !token) return null;
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return null;
  const expected = sign(`${header}.${body}`, secret);
  if (signature.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

async function verifySupabaseAccessToken(token) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key || !token) return null;

  try {
    const response = await fetch(`${url}/auth/v1/user`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${token}`
      }
    });
    if (!response.ok) return null;
    const user = await response.json();
    if (!user?.id || !user?.email) return null;
    return user;
  } catch {
    return null;
  }
}

async function resolveAdminFromSupabaseUser(user) {
  const email = String(user.email || '').trim().toLowerCase();
  const masterEmail = String(process.env.SUPER_ADMIN_EMAIL || 'mikro970328@gmail.com').trim().toLowerCase();

  let profile = null;
  try {
    const rows = await supabase('profiles', {
      query: `?select=id,full_name,email,is_active,company_id&auth_user_id=eq.${encodeURIComponent(user.id)}&limit=1`
    });
    profile = rows?.[0] || null;
  } catch (error) {
    console.error('PROFILE_LOOKUP_FAILED', error.message);
  }

  if (profile?.is_active === false) return null;

  let role = email === masterEmail ? 'master_admin' : 'admin';
  if (profile?.id) {
    try {
      const rows = await supabase('user_roles', {
        query: `?select=roles(name)&profile_id=eq.${encodeURIComponent(profile.id)}`
      });
      const names = (rows || []).map((row) => row.roles?.name).filter(Boolean);
      if (names.includes('master_admin') || names.includes('super_admin')) role = 'master_admin';
      else if (names.length) role = names[0];
    } catch (error) {
      console.error('ROLE_LOOKUP_FAILED', error.message);
    }
  }

  return {
    admin: true,
    admin_id: profile?.id || user.id,
    auth_user_id: user.id,
    username: email,
    email,
    full_name: profile?.full_name || user.user_metadata?.full_name || email,
    role,
    company_id: profile?.company_id || null
  };
}

export async function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';

  const legacy = verifyToken(token);
  if (legacy?.admin && legacy?.admin_id && ['master_admin', 'admin'].includes(legacy.role)) return legacy;

  const supabaseUser = await verifySupabaseAccessToken(token);
  const admin = supabaseUser ? await resolveAdminFromSupabaseUser(supabaseUser) : null;
  if (!admin || !['master_admin', 'admin'].includes(admin.role)) {
    fail(res, 401, 'No autorizado');
    return null;
  }
  return admin;
}

export async function requireMasterAdmin(req, res) {
  const admin = await requireAdmin(req, res);
  if (!admin) return null;
  if (admin.role !== 'master_admin') {
    fail(res, 403, 'Solo el administrador maestro puede realizar esta acción');
    return null;
  }
  return admin;
}

export function hashPassword(password, salt = crypto.randomBytes(16).toString('base64url')) {
  const value = String(password || '');
  if (value.length < 10) throw new Error('PASSWORD_TOO_SHORT');
  const hash = crypto.scryptSync(value, fromB64url(salt), 64, { N: 16384, r: 8, p: 1 }).toString('base64url');
  return { salt, hash };
}

export function verifyPassword(password, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(String(password || ''), fromB64url(salt), 64, { N: 16384, r: 8, p: 1 });
    const expected = fromB64url(expectedHash);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function normalizeUsername(value = '') {
  const username = String(value).trim();
  if (!/^[A-Za-z0-9._-]{4,32}$/.test(username)) throw new Error('USERNAME_INVALID');
  return username;
}

export function normalizePhone(value = '') {
  const cleaned = String(value).trim().replace(/^whatsapp:/i, '').replace(/[^\d+]/g, '');
  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) throw new Error('PHONE_INVALID');
  return cleaned;
}

export function normalizeContainer(value = '') {
  const cleaned = String(value).trim().toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z]{4}\d{7}$/.test(cleaned)) throw new Error('CONTAINER_INVALID');
  return cleaned;
}

export async function supabase(path, { method = 'GET', body, query = '', prefer } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIG_MISSING');
  const response = await fetch(`${url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: prefer || (method === 'POST' ? 'return=representation' : 'return=minimal')
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`SUPABASE_${response.status}:${text}`);
  return parsed;
}

export async function writeAudit(admin, action, entityType, entityId = null, details = {}) {
  try {
    await supabase('audit_log', {
      method: 'POST',
      body: {
        actor_admin_id: admin?.admin_id || null,
        actor_username: admin?.username || null,
        action,
        entity_type: entityType,
        entity_id: entityId,
        details
      }
    });
  } catch (error) {
    console.error('AUDIT_LOG_FAILED', error.message);
  }
}

const cleanVariable = (value, fallback = 'No disponible') => {
  const result = String(value ?? '').replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return result || fallback;
};

export async function sendWhatsApp({ to, variables, contentSid }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const selectedContentSid = contentSid || process.env.TWILIO_CONTENT_SID;
  const sender = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !selectedContentSid || !sender) throw new Error('TWILIO_CONFIG_MISSING');

  const form = new URLSearchParams();
  form.set('To', `whatsapp:${normalizePhone(to)}`);
  form.set('From', sender.startsWith('whatsapp:') ? sender : `whatsapp:${sender}`);
  form.set('ContentSid', selectedContentSid);
  form.set('ContentVariables', JSON.stringify(Object.fromEntries(Object.entries(variables).map(([k, v]) => [k, cleanVariable(v)]))));
  if (process.env.TWILIO_STATUS_CALLBACK_URL) form.set('StatusCallback', process.env.TWILIO_STATUS_CALLBACK_URL);

  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: form
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`TWILIO_${data.code || response.status}:${data.message || 'Error enviando mensaje'}`);
  return data;
}

export function parseShipsGoEvent(payload = {}) {
  const source = payload.data || payload.result || payload;
  const container = source.containerNumber || source.container_number || source.container || source.ContainerNumber || source.containerNo;
  const status = source.status || source.event || source.eventType || source.description || source.lastEvent || 'Actualización disponible';
  const location = source.location || source.port || source.eventLocation || source.currentLocation || 'No disponible';
  const eventTime = source.eventTime || source.eventDate || source.date || source.updatedAt || new Date().toISOString();
  const voyage = source.voyage || source.vesselVoyage || source.vessel || '';
  return { container: normalizeContainer(container), status, location, eventTime, voyage, raw: payload };
}
