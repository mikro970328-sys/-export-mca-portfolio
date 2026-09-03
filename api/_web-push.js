import webPush from 'web-push';

export const MAX_PUSH_ATTEMPTS = 5;

const base64Url = value => /^[A-Za-z0-9_-]+$/.test(String(value || ''));

export function webPushConfig(env = process.env) {
  const publicKey = String(env.PUSH_VAPID_PUBLIC_KEY || '').trim();
  const privateKey = String(env.PUSH_VAPID_PRIVATE_KEY || '').trim();
  const subject = String(env.PUSH_VAPID_SUBJECT || 'https://admin.exportmca.com').trim();
  const missing = [];
  if (!base64Url(publicKey) || publicKey.length !== 87) missing.push('PUSH_VAPID_PUBLIC_KEY');
  if (!base64Url(privateKey) || privateKey.length !== 43) missing.push('PUSH_VAPID_PRIVATE_KEY');
  if (!/^(mailto:|https:\/\/)/i.test(subject)) missing.push('PUSH_VAPID_SUBJECT');
  return { ready:missing.length === 0, publicKey, privateKey, subject, missing };
}

export function privacySafePushPayload(delivery = {}) {
  const id = String(delivery.inbox_item_id || '');
  const count = Math.max(0, Math.min(999, Number(delivery.unread_count) || 0));
  const deepLink = /^\/admin\/pwa\.html\?notification=[0-9a-f-]{36}$/i.test(String(delivery.deep_link || ''))
    ? String(delivery.deep_link)
    : '/admin/pwa.html';
  return JSON.stringify({
    version:1,
    kind:'operational_update',
    notificationId:/^[0-9a-f-]{36}$/i.test(id) ? id : null,
    url:deepLink,
    unreadCount:count,
    severity:['warning','critical'].includes(delivery.severity) ? delivery.severity : 'info'
  });
}

const cleanErrorCode = value => {
  const normalized = String(value || '').toLowerCase().replace(/[^a-z0-9_.:-]+/g, '_').slice(0, 80);
  return normalized || 'push_delivery_failed';
};

function retryAfterMilliseconds(error, nowMs) {
  const raw = error?.headers?.['retry-after'] ?? error?.headers?.get?.('retry-after');
  if (raw === undefined || raw === null || raw === '') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(String(raw));
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

export function classifyPushFailure(error, attemptCount, now = new Date()) {
  const statusCode = Number(error?.statusCode || error?.status || 0) || null;
  const attempt = Math.max(1, Number(attemptCount) || 1);
  const rawCode = statusCode ? `http_${statusCode}` : error?.code || error?.name;
  const errorCode = cleanErrorCode(rawCode);
  if ([404, 410].includes(statusCode)) return { status:'expired', statusCode, errorCode, nextAttemptAt:null };

  const retryableStatus = statusCode === 408 || statusCode === 425 || statusCode === 429 || (statusCode >= 500 && statusCode <= 599);
  const retryableCode = ['eai_again','econnreset','etimedout','und_err_connect_timeout'].includes(errorCode);
  if (attempt < MAX_PUSH_ATTEMPTS && (retryableStatus || retryableCode || !statusCode)) {
    const fallbackMinutes = [5, 15, 60, 240][Math.min(attempt - 1, 3)];
    const requestedDelay = retryAfterMilliseconds(error, now.getTime());
    const delay = Math.max(60_000, Math.min(requestedDelay ?? fallbackMinutes * 60_000, 24 * 60 * 60_000));
    return { status:'retry', statusCode, errorCode, nextAttemptAt:new Date(now.getTime() + delay).toISOString() };
  }
  return { status:'failed', statusCode, errorCode, nextAttemptAt:null };
}

export async function sendWebPush(delivery, config = webPushConfig()) {
  if (!config.ready) {
    const error = new Error('PUSH_VAPID_NOT_CONFIGURED');
    error.code = 'push_vapid_not_configured';
    throw error;
  }
  const subscription = {
    endpoint:delivery.endpoint,
    keys:{ p256dh:delivery.p256dh, auth:delivery.auth_secret }
  };
  return webPush.sendNotification(subscription, privacySafePushPayload(delivery), {
    TTL:24 * 60 * 60,
    urgency:delivery.severity === 'critical' ? 'high' : 'normal',
    vapidDetails:{ subject:config.subject, publicKey:config.publicKey, privateKey:config.privateKey }
  });
}
