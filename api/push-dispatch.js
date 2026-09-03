import crypto from 'node:crypto';
import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';
import { reconcileAllNotifications } from './_notification-reconcile.js';
import { classifyPushFailure, sendWebPush, webPushConfig } from './_web-push.js';

const BATCH_SIZE = 50;

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

async function rpc(name, body) {
  const result = await supabase(`rpc/${name}`, { method:'POST', body, prefer:'return=representation' });
  return Array.isArray(result) ? result : result ? [result] : [];
}

async function complete(delivery, leaseToken, outcome) {
  await rpc('complete_push_delivery', {
    p_delivery_id:delivery.delivery_id,
    p_lease_token:leaseToken,
    p_status:outcome.status,
    p_status_code:outcome.statusCode || null,
    p_error_code:outcome.errorCode || null,
    p_next_attempt_at:outcome.nextAttemptAt || null,
    p_now:new Date().toISOString()
  });
}

async function dispatchOne(delivery, leaseToken, config) {
  try {
    const response = await sendWebPush(delivery, config);
    const statusCode = Number(response?.statusCode || 201);
    await complete(delivery, leaseToken, { status:'sent', statusCode, errorCode:null, nextAttemptAt:null });
    return { status:'sent' };
  } catch (error) {
    const outcome = classifyPushFailure(error, delivery.attempt_count);
    await complete(delivery, leaseToken, outcome);
    return { status:outcome.status };
  }
}

async function mapConcurrent(items, concurrency, mapper) {
  const queue = [...items];
  const results = [];
  const workers = Array.from({ length:Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) results.push(await mapper(queue.shift()));
  });
  await Promise.all(workers);
  return results;
}

export default async function handler(req, res) {
  if (!['GET','POST'].includes(req.method)) return fail(res, 405, 'Método no permitido');
  const cron = cronAuthorized(req);
  let admin = null;
  if (!cron) {
    admin = await authorizeAdmin(req, res, 'notifications.manage');
    if (!admin) return;
  }

  try {
    const now = new Date().toISOString();
    const reconciliation = await reconcileAllNotifications(now);
    const config = webPushConfig();
    if (!config.ready) return ok(res, { configured:false, dispatched:0, reconciliation });

    const leaseToken = crypto.randomUUID();
    const deliveries = await rpc('claim_push_deliveries', { p_batch_size:BATCH_SIZE, p_lease_token:leaseToken, p_now:now });
    const outcomes = await mapConcurrent(deliveries, 5, delivery => dispatchOne(delivery, leaseToken, config));
    const summary = outcomes.reduce((counts, outcome) => {
      counts[outcome.status] = (counts[outcome.status] || 0) + 1;
      return counts;
    }, {});
    if (admin) await writeAudit(admin, 'push.dispatch.manual', 'push_delivery', null, { claimed:deliveries.length, outcomes:summary });
    return ok(res, { configured:true, claimed:deliveries.length, outcomes:summary, reconciliation });
  } catch (error) {
    console.error('PUSH_DISPATCH_ERROR', { message:error?.message, code:error?.code });
    return fail(res, 500, 'No se pudieron entregar las notificaciones push');
  }
}
