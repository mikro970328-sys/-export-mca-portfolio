import { fail, ok, requireAdmin, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');
  try {
    const shipmentId = String(req.query?.shipment_id || '').trim();
    const clientId = String(req.query?.client_id || '').trim();
    if (!shipmentId && !clientId) return fail(res, 400, 'Indica shipment_id o client_id');
    const filter = shipmentId ? `shipment_id=eq.${encodeURIComponent(shipmentId)}` : `client_id=eq.${encodeURIComponent(clientId)}`;
    const events = await supabase('shipment_history', { query: `?select=*&${filter}&order=created_at.desc&limit=200` });
    const notifications = await supabase('notifications', { query: `?select=*&${filter}&order=created_at.desc&limit=200` });
    return ok(res, { events: events || [], notifications: notifications || [] });
  } catch (error) { return fail(res, 400, error.message); }
}