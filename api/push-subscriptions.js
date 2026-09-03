import { authorizeAdmin, fail, ok, readJson, supabase } from './_lib.js';
import { webPushConfig } from './_web-push.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BASE64_URL_RE = /^[A-Za-z0-9_-]+$/;

const cleanText = (value, max) => String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim().slice(0, max);
const rpcRow = value => Array.isArray(value) ? value[0] || null : value || null;

function validPushEndpoint(value) {
  if (value.length < 12 || value.length > 4096) return false;
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) return false;
    if (url.port && url.port !== '443') return false;
    if (!hostname.includes('.') || hostname.startsWith('[') || /^(?:\d{1,3}\.){3}\d{1,3}$/.test(hostname)) return false;
    if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || hostname.endsWith('.internal')) return false;
    return true;
  } catch {
    return false;
  }
}

function configPayload() {
  const config = webPushConfig();
  return { ready:config.ready, public_key:config.ready ? config.publicKey : null };
}

function normalizedExpiration(value) {
  if (value === null || value === undefined || value === '') return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) throw new Error('PUSH_SUBSCRIPTION_EXPIRED');
  return new Date(timestamp).toISOString();
}

function normalizeSubscription(body) {
  const value = body?.subscription || body || {};
  const endpoint = String(value.endpoint || '').trim();
  const p256dh = String(value.keys?.p256dh || '').trim();
  const auth = String(value.keys?.auth || '').trim();
  if (!validPushEndpoint(endpoint)) throw new Error('PUSH_ENDPOINT_INVALID');
  if (!BASE64_URL_RE.test(p256dh) || p256dh.length !== 87) throw new Error('PUSH_P256DH_INVALID');
  if (!BASE64_URL_RE.test(auth) || auth.length !== 22) throw new Error('PUSH_AUTH_INVALID');
  return { endpoint, p256dh, auth, expirationTime:normalizedExpiration(value.expirationTime) };
}

async function listDevices(adminId) {
  return await supabase('push_subscription_workspace', {
    query:`?select=id,device_label,user_agent,expiration_time,status,activated_at,last_seen_at,last_delivery_at,revoked_at,failure_count,last_error_code,session_valid&admin_user_id=eq.${encodeURIComponent(adminId)}&order=activated_at.desc&limit=50`
  }) || [];
}

function mappedError(error) {
  const raw = String(error?.message || error || '');
  const code = raw.match(/(PUSH_[A-Z0-9_]+)/)?.[1] || '';
  const messages = {
    PUSH_ACTOR_INVALID:'La cuenta actual no puede administrar notificaciones push',
    PUSH_SESSION_INVALID:'La sesión expiró o fue revocada',
    PUSH_ENDPOINT_INVALID:'La suscripción del navegador no es válida',
    PUSH_P256DH_INVALID:'La clave pública de la suscripción no es válida',
    PUSH_AUTH_INVALID:'El secreto de la suscripción no es válido',
    PUSH_SUBSCRIPTION_EXPIRED:'La suscripción del navegador ya expiró',
    PUSH_SUBSCRIPTION_REQUIRED:'Indica el dispositivo que deseas desactivar',
    PUSH_SUBSCRIPTION_NOT_FOUND:'El dispositivo ya no está activo'
  };
  if (!messages[code]) return null;
  return { status:code === 'PUSH_SUBSCRIPTION_NOT_FOUND' ? 404 : code === 'PUSH_SESSION_INVALID' ? 401 : 400, message:messages[code], code };
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, 'notifications.read');
  if (!admin) return;
  try {
    if (req.method === 'GET') return ok(res, { config:configPayload(), devices:await listDevices(admin.admin_id) });

    if (req.method === 'POST') {
      const config = webPushConfig();
      if (!config.ready) return fail(res, 503, 'Las notificaciones push todavía no están configuradas', 'PUSH_VAPID_NOT_CONFIGURED');
      const body = await readJson(req);
      const subscription = normalizeSubscription(body);
      const deviceLabel = cleanText(body.device_label, 80) || 'Este dispositivo';
      const result = rpcRow(await supabase('rpc/upsert_push_subscription', {
        method:'POST',
        body:{
          p_actor:admin.admin_id,
          p_session_version:admin.session_version,
          p_endpoint:subscription.endpoint,
          p_p256dh:subscription.p256dh,
          p_auth_secret:subscription.auth,
          p_expiration_time:subscription.expirationTime,
          p_device_label:deviceLabel,
          p_user_agent:cleanText(req.headers['user-agent'], 512) || null,
          p_now:new Date().toISOString()
        },
        prefer:'return=representation'
      }));
      return ok(res, { subscription:result, devices:await listDevices(admin.admin_id) });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!UUID_RE.test(id)) return fail(res, 400, 'Identificador de dispositivo no válido');
      const result = rpcRow(await supabase('rpc/deactivate_push_subscription', {
        method:'POST',
        body:{ p_actor:admin.admin_id, p_session_version:admin.session_version, p_subscription_id:id, p_endpoint:null, p_reason:'user', p_now:new Date().toISOString() },
        prefer:'return=representation'
      }));
      return ok(res, { subscription:result, devices:await listDevices(admin.admin_id) });
    }

    if (req.method === 'DELETE') {
      const body = await readJson(req);
      const endpoint = String(body.endpoint || '').trim();
      const reason = ['logout','key_rotated','permission_revoked'].includes(String(body.reason || '').trim()) ? String(body.reason).trim() : 'logout';
      if (!validPushEndpoint(endpoint)) return fail(res, 400, 'La suscripción del navegador no es válida');
      const result = rpcRow(await supabase('rpc/deactivate_push_subscription', {
        method:'POST',
        body:{ p_actor:admin.admin_id, p_session_version:admin.session_version, p_subscription_id:null, p_endpoint:endpoint, p_reason:reason, p_now:new Date().toISOString() },
        prefer:'return=representation'
      }));
      return ok(res, { subscription:result });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    const mapped = mappedError(error);
    if (mapped) return fail(res, mapped.status, mapped.message, mapped.code);
    console.error('PUSH_SUBSCRIPTIONS_ERROR', { message:error?.message, code:error?.code });
    return fail(res, 500, 'No se pudieron administrar las notificaciones push');
  }
}
