import { supabase } from './_lib.js';

const rpcRow = value => Array.isArray(value) ? value[0] || {} : value || {};

async function call(name, body) {
  return rpcRow(await supabase(`rpc/${name}`, {
    method:'POST',
    body,
    prefer:'return=representation'
  }));
}

export async function reconcileAllNotifications(now = new Date().toISOString()) {
  const inbox = await call('reconcile_user_notifications', { p_now:now });
  const push = await call('reconcile_web_push_notifications', { p_now:now });
  return { inbox, push };
}
