import { fail, ok, requireAdmin, supabase, writeAudit } from './_lib.js';

const DAY = 24 * 60 * 60 * 1000;
const WARNING_AFTER = 3 * DAY;
const CRITICAL_AFTER = 5 * DAY;
const EVENT_TYPE = 'shipment_manual_tracking_stale';

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function loadActiveAlerts() {
  const rows = await supabase('notifications', {
    query: `?select=*&notification_scope=eq.operational&event_type=eq.${EVENT_TYPE}&resolved_at=is.null&limit=2000`
  });
  return new Map((rows || []).filter(row => row.dedupe_key).map(row => [row.dedupe_key, row]));
}

async function createAlert(shipment, reference, severity, elapsedDays, now) {
  const key = `${EVENT_TYPE}:${shipment.id}`;
  const rows = await supabase('notifications', {
    method: 'POST',
    body: [{
      client_id: shipment.client_id || null,
      shipment_id: shipment.id,
      event_type: EVENT_TYPE,
      event_status: severity,
      channel: 'internal',
      status: 'pending',
      delivery_status: 'pending',
      notification_scope: 'operational',
      entity_type: 'shipment',
      entity_id: shipment.id,
      alert_status: 'pending',
      severity,
      title: severity === 'critical' ? 'Tracking manual sin actualizar por 5 días' : 'Tracking manual sin actualizar por 3 días',
      message: `El contenedor ${shipment.container_number || 'sin número'} lleva ${elapsedDays} días sin registrar un nuevo evento manual.`,
      dedupe_key: key,
      due_at: new Date(reference.getTime() + WARNING_AFTER).toISOString(),
      first_triggered_at: now,
      last_triggered_at: now,
      occurrence_count: 1,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        last_status: shipment.last_status || shipment.operational_status || null,
        last_event_at: reference.toISOString(),
        days_without_update: elapsedDays,
        required_action: 'update_manual_tracking'
      },
      attempt_count: 0,
      last_attempt_at: null,
      updated_at: now
    }]
  });
  return rows?.[0] || null;
}

async function updateAlert(row, shipment, reference, severity, elapsedDays, now) {
  const rows = await supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}&select=*`,
    body: {
      severity,
      event_status: severity,
      alert_status: 'pending',
      status: 'pending',
      delivery_status: 'pending',
      title: severity === 'critical' ? 'Tracking manual sin actualizar por 5 días' : 'Tracking manual sin actualizar por 3 días',
      message: `El contenedor ${shipment.container_number || 'sin número'} lleva ${elapsedDays} días sin registrar un nuevo evento manual.`,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        last_status: shipment.last_status || shipment.operational_status || null,
        last_event_at: reference.toISOString(),
        days_without_update: elapsedDays,
        required_action: 'update_manual_tracking'
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
      query: '?select=id,client_id,container_number,last_status,operational_status,last_event_at,created_at,shipsgo_status,shipsgo_link_mode,active,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'
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
    const manual = shipment.shipsgo_status === 'manual' || shipment.shipsgo_link_mode === 'manual';

    if (!manual) {
      if (previous) {
        await resolveAlert(previous, now, 'automatic_tracking_enabled');
        resolved += 1;
      }
      continue;
    }

    const reference = validDate(shipment.last_event_at || shipment.created_at);
    if (!reference) continue;
    const elapsedMs = nowMs - reference.getTime();

    if (elapsedMs < WARNING_AFTER) {
      if (previous) {
        await resolveAlert(previous, now, 'manual_tracking_updated');
        resolved += 1;
      }
      continue;
    }

    eligible.add(key);
    const elapsedDays = Math.floor(elapsedMs / DAY);
    const severity = elapsedMs >= CRITICAL_AFTER ? 'critical' : 'warning';

    if (!previous) {
      if (await createAlert(shipment, reference, severity, elapsedDays, now)) created += 1;
      continue;
    }

    const changed = previous.severity !== severity
      || Number(previous.payload?.days_without_update || 0) !== elapsedDays
      || previous.alert_status === 'snoozed';

    if (changed) {
      if (await updateAlert(previous, shipment, reference, severity, elapsedDays, now)) updated += 1;
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
    alerts_resolved: resolved,
    warning_after_days: 3,
    critical_after_days: 5
  };
}

export default async function handler(req, res) {
  const isCron = cronAuthorized(req);
  const admin = isCron ? { username: 'vercel-cron', admin_id: null } : requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const result = await runCheck();
    await writeAudit(admin, 'manual_tracking_alerts_check', 'system', null, result);
    return ok(res, result);
  } catch (error) {
    console.error('MANUAL_TRACKING_ALERTS_ERROR', error);
    return fail(res, 400, 'No se pudieron comprobar las actualizaciones del tracking manual', error.message);
  }
}
