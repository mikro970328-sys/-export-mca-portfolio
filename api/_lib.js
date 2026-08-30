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

function tokenPayload(req) {
  const auth = req.headers.authorization || '';
  return verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '');
}

// Legacy synchronous guard. P3 private business routes must use authenticateAdmin/authorizeAdmin.
export function requireAdmin(req, res) {
  const payload = tokenPayload(req);
  if (!payload?.admin || !payload?.admin_id || !['master_admin', 'admin'].includes(payload.role)) {
    fail(res, 401, 'No autorizado');
    return null;
  }
  return payload;
}

export function requireMasterAdmin(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return null;
  if (admin.role !== 'master_admin') {
    fail(res, 403, 'Solo el administrador maestro puede realizar esta acción');
    return null;
  }
  return admin;
}

export async function authenticateAdmin(req, res) {
  const payload = tokenPayload(req);
  if (!payload?.admin || !payload?.admin_id) {
    fail(res, 401, 'No autorizado');
    return null;
  }

  const rows = await supabase('admin_users', {
    query: `?select=id,full_name,username,role,is_active,access_role_id&id=eq.${encodeURIComponent(payload.admin_id)}&limit=1`
  });
  const account = rows?.[0] || null;
  if (!account || account.is_active !== true || !['master_admin', 'admin'].includes(account.role)) {
    fail(res, 401, 'Sesión no autorizada');
    return null;
  }
  if (account.role === 'admin' && !account.access_role_id) {
    fail(res, 403, 'La cuenta no tiene un rol de acceso asignado');
    return null;
  }

  return {
    admin: true,
    admin_id: account.id,
    username: account.username,
    full_name: account.full_name,
    role: account.role,
    access_role_id: account.access_role_id || null
  };
}

export async function authorizeAdmin(req, res, permissionKey) {
  const admin = await authenticateAdmin(req, res);
  if (!admin) return null;
  if (!permissionKey || admin.role === 'master_admin') return admin;

  const rows = await supabase('admin_effective_permissions', {
    query: `?select=permission_key&admin_user_id=eq.${encodeURIComponent(admin.admin_id)}&permission_key=eq.${encodeURIComponent(permissionKey)}&limit=1`
  });
  if (!rows?.length) {
    fail(res, 403, 'No tienes permiso para realizar esta acción');
    return null;
  }
  return admin;
}

export async function authorizeAdminAny(req, res, permissionKeys = []) {
  const admin = await authenticateAdmin(req, res);
  if (!admin) return null;
  if (admin.role === 'master_admin') return admin;
  const keys = [...new Set((permissionKeys || []).map(value => String(value || '').trim()).filter(Boolean))];
  if (!keys.length) return admin;
  const encoded = keys.map(value => `"${value.replace(/"/g, '\\"')}"`).join(',');
  const rows = await supabase('admin_effective_permissions', {
    query: `?select=permission_key&admin_user_id=eq.${encodeURIComponent(admin.admin_id)}&permission_key=in.(${encodeURIComponent(encoded)})&limit=1`
  });
  if (!rows?.length) {
    fail(res, 403, 'No tienes permiso para realizar esta acción');
    return null;
  }
  return admin;
}

export async function loadAdminAccessContext(adminId) {
  const id = String(adminId || '');
  if (!id) return { permissions: [], teams: [], access_role: null };
  const [permissionRows, teamRows, accountRows] = await Promise.all([
    supabase('admin_effective_permissions', {
      query: `?select=permission_key&admin_user_id=eq.${encodeURIComponent(id)}&order=permission_key.asc`
    }),
    supabase('admin_team_directory', {
      query: `?select=team_id,team_name,team_description,team_active,membership_created_at&admin_user_id=eq.${encodeURIComponent(id)}&order=team_name.asc`
    }),
    supabase('admin_users', {
      query: `?select=access_role_id,access_roles:access_role_id(id,name,description,is_system,is_active)&id=eq.${encodeURIComponent(id)}&limit=1`
    })
  ]);
  return {
    permissions: (permissionRows || []).map(row => row.permission_key),
    teams: teamRows || [],
    access_role: accountRows?.[0]?.access_roles || null
  };
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
