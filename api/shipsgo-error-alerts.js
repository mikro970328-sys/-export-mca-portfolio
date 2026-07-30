import { fail, ok, requireAdmin, supabase, writeAudit } from './_lib.js';

const EVENT_TYPE = 'shipsgo_tracking_failed';
const REPEAT_EVERY = 24 * 60 * 60 * 1000;

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isShipsGoFailure(shipment) {
  const status = String(shipment.shipsgo_status || '').trim().toLowerCase();
  return status === 'failed' || Boolean(String(shipment.shipsgo_error || '').trim());
}

async function loadActiveAlerts() {
  const rows = await supabase('notifications', {
    query: `?select=*&notification_scope=eq.operational&event_type=eq.${EVENT_TYPE}&resolved_at=is.null&limit=2000`
  });
  return new Map((rows || []).filter(row => row.dedupe_key).map(row => [row.dedupe_key, row]));
}

async function createAlert(shipment, now) {
  const key = `${EVENT_TYPE}:${shipment.id}`;
  const error = String(shipment.shipsgo_error || 'ShipsGo no pudo mantener el tracking automático').trim();
  const rows = await supabase('notifications', {
    method: 'POST',
    body: [{
      client_id: shipment.client_id || null,
      shipment_id: shipment.id,
      event_type: EVENT_TYPE,
      event_status: 'critical',
      channel: 'internal',
      status: 'pending',
      delivery_status: 'pending',
      notification_scope: 'operational',
      entity_type: 'shipment',
      entity_id: shipment.id,
      alert_status: 'pending',
      severity: 'critical',
      title: 'Error de tracking en ShipsGo',
      message: `El contenedor ${shipment.container_number || 'sin número'} tiene un error de ShipsGo y requiere reconexión o cambio a seguimiento manual.`,
      dedupe_key: key,
      first_triggered_at: now,
      last_triggered_at: now,
      occurrence_count: 1,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        shipsgo_status: shipment.shipsgo_status || null,
        shipsgo_tracking_id: shipment.shipsgo_tracking_id || null,
        shipsgo_error: error,
        required_action: shipment.shipsgo_tracking_id ? 'reconnect_or_enable_manual' : 'connect_or_enable_manual'
      },
      attempt_count: 0,
      last_attempt_at: null,
      updated_at: now
    }]
  });
  return rows?.[0] || null;
}

async function refreshAlert(row, shipment, now) {
  const error = String(shipment.shipsgo_error || 'ShipsGo no pudo mantener el tracking automático').trim();
  const rows = await supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}&select=*`,
    body: {
      alert_status: 'pending',
      status: 'pending',
      delivery_status: 'pending',
      severity: 'critical',
      event_status: 'critical',
      title: 'Error de tracking en ShipsGo',
      message: `El contenedor ${shipment.container_number || 'sin número'} continúa con un error de ShipsGo.`,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        shipsgo_status: shipment.shipsgo_status || null,
        shipsgo_tracking_id: shipment.shipsgo_tracking_id || null,
        shipsgo_error: error,
        required_action: shipment.shipsgo_tracking_id ? 'reconnect_or_enable_manual' : 'connect_or_enable_manual'
      },
      last_triggered_at: now,
      occurrence_count: Number(row.occurrence_count || 1) + 1,
      snoozed_until: null,
      resolved_at: null,
      resolved_reason: null,
      updated_at: now
    }
  });
  return rows?.[0] || null;
}

async function resolveAlert(row, now, reason) {
  await supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}`,
    body: {
      alert_status: 'resolved',
      status: 'resolved',
      delivery_status: 'resolved',
      resolved_at: now,
      resolved_reason: reason,
      snoozed_until: null,
      updated_at: now
    }
  });
}

async function runCheck() {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const [shipments, activeAlerts] = await Promise.all([
    supabase('shipments', {
      query: '?select=id,client_id,container_number,shipsgo_status,shipsgo_error,shipsgo_tracking_id,shipsgo_link_mode,active,clients(id,name)&active=eq.true&order=updated_at.asc&limit=5000'
    }),
    loadActiveAlerts()
  ]);

  const eligible = new Set();
  let created = 0;
  let updated = 0;
  let resolved = 0;

  for (const shipment of shipments || []) {
    const key = `${EVENT_TYPE}:${shipment.id}`;
    const previous = activeAlerts.get(key);
    const manual = String(shipment.shipsgo_status || '').toLowerCase() === 'manual';
    const failed = !manual && isShipsGoFailure(shipment);

    if (!failed) {
      if (previous) {
        await resolveAlert(previous, now, manual ? 'manual_mode_enabled' : 'shipsgo_recovered');
        resolved += 1;
      }
      continue;
    }

    eligible.add(key);
    if (!previous) {
      if (await createAlert(shipment, now)) created += 1;
      continue;
    }

    const lastTriggered = validDate(previous.last_triggered_at || previous.created_at);
    const repeatDue = !lastTriggered || nowMs - lastTriggered.getTime() >= REPEAT_EVERY;
    const errorChanged = previous.payload?.shipsgo_error !== String(shipment.shipsgo_error || '').trim();
    if ((repeatDue || errorChanged || previous.alert_status === 'snoozed') && previous.alert_status !== 'snoozed') {
      if (await refreshAlert(previous, shipment, now)) updated += 1;
    }
  }

  for (const [key, row] of activeAlerts) {
    if (!eligible.has(key) && !row.resolved_at) {
      await resolveAlert(row, now, 'condition_cleared');
      resolved += 1;
    }
  }

  return {
    shipments_checked: (shipments || []).length,
    alerts_created: created,
    alerts_updated: updated,
    alerts_resolved: resolved
  };
}

export default async function handler(req, res) {
  const isCron = cronAuthorized(req);
  const admin = isCron ? { username: 'vercel-cron', admin_id: null } : requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const result = await runCheck();
    await writeAudit(admin, 'shipsgo_error_alerts_check', 'system', null, result);
    return ok(res, result);
  } catch (error) {
    console.error('SHIPSGO_ERROR_ALERTS_ERROR', error);
    return fail(res, 400, 'No se pudieron comprobar los errores de ShipsGo', error.message);
  }
}
