import { authorizeAdmin, fail, ok, readJson, supabase } from './_lib.js';
import { resolveTrackingStaleCondition } from './_integration-events.js';

async function history(shipment, eventType, title, details = null, source = 'admin') {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{ shipment_id: shipment.id, client_id: shipment.client_id, event_type: eventType, title, details, source }]
    });
  } catch (error) {
    console.error('TRACKING_MODE_HISTORY_FAILED', error.message);
  }
}

async function audit(action, shipment, admin, details = {}) {
  try {
    await supabase('audit_log', {
      method: 'POST',
      body: [{
        actor_admin_id: admin.admin_id || null,
        actor_username: admin.username || null,
        action,
        entity_type: 'shipment',
        entity_id: shipment.id,
        details
      }]
    });
  } catch (error) {
    console.error('TRACKING_MODE_AUDIT_FAILED', error.message);
  }
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, 'logistics.write');
  if (!admin) return;
  if (req.method !== 'PATCH') return fail(res, 405, 'Método no permitido');

  try {
    const body = await readJson(req);
    const id = String(body.id || '').trim();
    if (!id) return fail(res, 400, 'Falta el identificador del contenedor');

    const rows = await supabase('shipments', {
      query: `?select=id,client_id,container_number,shipsgo_status,shipsgo_error,shipsgo_tracking_id,shipsgo_link_mode&id=eq.${encodeURIComponent(id)}&limit=1`
    });
    const shipment = rows?.[0];
    if (!shipment) return fail(res, 404, 'Contenedor no encontrado');

    const action = String(body.action || '').trim();
    const now = new Date().toISOString();

    if (action === 'enable_manual') {
      const updated = await supabase('shipments', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(id)}&select=*`,
        body: {
          shipsgo_status: 'manual',
          shipsgo_link_mode: shipment.shipsgo_link_mode === 'manual' ? null : shipment.shipsgo_link_mode,
          updated_at: now
        }
      });

      const alertResult = await resolveTrackingStaleCondition(shipment, 'manual_mode_enabled', now);
      const resolvedAlerts = alertResult && ['auto_resolved','condition_closed'].includes(alertResult.action) ? 1 : 0;

      await history(
        shipment,
        'tracking_manual_enabled',
        'Seguimiento manual activado',
        `Activado por ${admin.username || 'administrador'}${shipment.shipsgo_tracking_id ? ` · Vínculo ShipsGo conservado: ${shipment.shipsgo_tracking_id}` : ''}`,
        'admin'
      );
      await audit('tracking_manual_enabled', shipment, admin, {
        previous_status: shipment.shipsgo_status || null,
        shipsgo_tracking_id_preserved: shipment.shipsgo_tracking_id || null,
        resolved_tracking_alerts: resolvedAlerts
      });

      return ok(res, {
        shipment: updated?.[0] || { ...shipment, shipsgo_status: 'manual' },
        resolved_alerts: resolvedAlerts
      });
    }

    if (action === 'enable_auto') {
      if (!shipment.shipsgo_tracking_id) {
        return fail(res, 409, 'Este contenedor no tiene un tracking de ShipsGo confirmado. Debes reconectarlo primero.');
      }

      const updated = await supabase('shipments', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(id)}&select=*`,
        body: {
          shipsgo_status: 'active',
          shipsgo_error: null,
          updated_at: now
        }
      });

      await history(
        shipment,
        'tracking_auto_resumed',
        'Seguimiento automático reanudado',
        `Vínculo ShipsGo confirmado: ${shipment.shipsgo_tracking_id} · Activado por ${admin.username || 'administrador'}`,
        'admin'
      );
      await audit('tracking_auto_resumed', shipment, admin, {
        shipsgo_tracking_id: shipment.shipsgo_tracking_id,
        previous_status: shipment.shipsgo_status || null
      });

      return ok(res, {
        shipment: updated?.[0] || { ...shipment, shipsgo_status: 'active', shipsgo_error: null },
        resumed: true,
        tracking_id: shipment.shipsgo_tracking_id
      });
    }

    return fail(res, 400, 'Acción no válida');
  } catch (error) {
    return fail(res, 400, error.message || 'No se pudo cambiar el modo de seguimiento');
  }
}
