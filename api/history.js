import { fail, ok, requireAdmin, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');
  try {
    const shipmentId = String(req.query?.shipment_id || '').trim();
    const clientId = String(req.query?.client_id || '').trim();
    if (!shipmentId && !clientId) return fail(res, 400, 'Indica shipment_id o client_id');
    const filter = shipmentId ? `shipment_id=eq.${encodeURIComponent(shipmentId)}` : `client_id=eq.${encodeURIComponent(clientId)}`;
    const tasks = [
      supabase('shipment_history', { query: `?select=*&${filter}&order=created_at.desc&limit=200` }),
      supabase('notifications', { query: `?select=*&${filter}&order=created_at.desc&limit=200` })
    ];
    if (clientId) tasks.push(supabase('audit_log', { query: `?select=*&entity_type=eq.client&entity_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc&limit=200` }));
    const [events, notifications, auditEvents = []] = await Promise.all(tasks);
    return ok(res, { events: events || [], notifications: notifications || [], audit_events: auditEvents || [] });
  } catch (error) { return fail(res, 400, error.message); }
}
