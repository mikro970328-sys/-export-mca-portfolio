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

export function requireAdmin(req, res) {
  const auth = req.headers.authorization || '';
  const payload = verifyToken(auth.startsWith('Bearer ') ? auth.slice(7) : '');
  if (!payload?.admin) { fail(res, 401, 'No autorizado'); return null; }
  return payload;
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

export async function supabase(path, { method = 'GET', body, query = '' } = {}) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIG_MISSING');
  const response = await fetch(`${url}/rest/v1/${path}${query}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const parsed = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`SUPABASE_${response.status}:${text}`);
  return parsed;
}

const cleanVariable = (value, fallback = 'No disponible') => {
  const result = String(value ?? '').replace(/[\n\r\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return result || fallback;
};

export async function sendWhatsApp({ to, variables }) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const contentSid = process.env.TWILIO_CONTENT_SID;
  const sender = process.env.TWILIO_WHATSAPP_FROM;
  if (!accountSid || !authToken || !contentSid || !sender) throw new Error('TWILIO_CONFIG_MISSING');

  const form = new URLSearchParams();
  form.set('To', `whatsapp:${normalizePhone(to)}`);
  form.set('From', sender.startsWith('whatsapp:') ? sender : `whatsapp:${sender}`);
  form.set('ContentSid', contentSid);
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
