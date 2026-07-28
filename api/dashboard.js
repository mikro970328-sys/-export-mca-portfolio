import { fail, ok, requireAdmin, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (!await requireAdmin(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');
  try {
    const [clients, shipments, notifications] = await Promise.all([
      supabase('clients', { query: '?select=id,welcome_status,active' }),
      supabase('shipments', { query: '?select=id,active,operational_status,last_event_at,released_at,delivered_at,release_notification_status' }),
      supabase('notifications', { query: '?select=id,delivery_status&order=created_at.desc&limit=500' })
    ]);
    const now = Date.now();
    const active = (shipments || []).filter(x => x.active !== false);
    const status = (name) => active.filter(x => String(x.operational_status || x.last_status || '').toLowerCase().includes(name)).length;
    const stale = active.filter(x => x.last_event_at && now - new Date(x.last_event_at).getTime() > 5 * 86400000).length;
    const welcomePending = (clients || []).filter(x => x.welcome_status !== 'sent').length;
    const messageFailed = (notifications || []).filter(x => ['failed','undelivered'].includes(String(x.delivery_status).toLowerCase())).length;
    const releasePending = active.filter(x => /lleg|descarg|destino/i.test(x.operational_status || '') && !x.released_at).length;
    return ok(res, {
      stats: {
        clients: (clients || []).filter(x => x.active !== false).length,
        active: active.length,
        in_transit: status('tránsito') + status('salió'),
        at_destination: status('lleg') + status('descarg'),
        awaiting_release: releasePending,
        released: status('liberado'),
        delivered: (shipments || []).filter(x => x.active === false).length
      },
      alerts: { welcome_pending: welcomePending, stale_shipments: stale, failed_messages: messageFailed, awaiting_release: releasePending }
    });
  } catch (error) { return fail(res, 400, error.message); }
}
