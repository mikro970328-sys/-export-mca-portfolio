import { fail, ok, readJson, requireAdmin, supabase } from './_lib.js';

async function history(shipment, eventType, title, details = null, source = 'admin') {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{ shipment_id: shipment.id, client_id: shipment.client_id, event_type: eventType, title, details, source }]
    });
  } catch {}
}

async function audit(action, shipment, details = {}) {
  try {
    await supabase('audit_log', {
      method: 'POST',
      body: [{ action, entity_type: 'shipment', entity_id: shipment.id, details }]
    });
  } catch {}
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'PATCH') return fail(res, 405, 'Método no permitido');

  try {
    const body = await readJson(req);
    const id = String(body.id || '').trim();
    if (!id) return fail(res, 400, 'Falta el identificador del contenedor');

    const rows = await supabase('shipments', {
      query: `?select=id,client_id,container_number,shipsgo_status,shipsgo_error&id=eq.${encodeURIComponent(id)}&limit=1`
    });
    const shipment = rows?.[0];
    if (!shipment) return fail(res, 404, 'Contenedor no encontrado');

    if (body.action !== 'enable_manual') return fail(res, 400, 'Acción no válida');

    const now = new Date().toISOString();
    const updated = await supabase('shipments', {
      method: 'PATCH',
      query: `?id=eq.${encodeURIComponent(id)}&select=*`,
      body: {
        shipsgo_status: 'manual',
        shipsgo_link_mode: 'manual',
        updated_at: now
      }
    });

    await history(
      shipment,
      'tracking_manual_enabled',
      'Seguimiento manual activado',
      `Activado por ${admin.username || 'administrador'}${shipment.shipsgo_error ? ` · Error previo: ${shipment.shipsgo_error}` : ''}`,
      'admin'
    );
    await audit('tracking_manual_enabled', shipment, {
      actor: admin.username,
      previous_status: shipment.shipsgo_status || null,
      previous_error: shipment.shipsgo_error || null
    });

    return ok(res, { shipment: updated?.[0] || { ...shipment, shipsgo_status: 'manual', shipsgo_link_mode: 'manual' } });
  } catch (error) {
    return fail(res, 400, error.message || 'No se pudo activar el seguimiento manual');
  }
}
