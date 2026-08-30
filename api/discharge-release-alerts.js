import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';

const DAY = 24 * 60 * 60 * 1000;
const RELEASE_ALERT_AFTER = 5 * DAY;
const EVENT_TYPE = 'shipment_discharged_not_released';

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

async function createAlert(shipment, dischargedAt, now) {
  const elapsedDays = Math.floor((Date.now() - dischargedAt.getTime()) / DAY);
  const key = `${EVENT_TYPE}:${shipment.id}`;
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
      title: 'Contenedor descargado pendiente de liberación',
      message: `El contenedor ${shipment.container_number || 'sin número'} fue descargado hace ${elapsedDays} días y todavía no ha sido liberado.`,
      dedupe_key: key,
      due_at: new Date(dischargedAt.getTime() + RELEASE_ALERT_AFTER).toISOString(),
      first_triggered_at: now,
      last_triggered_at: now,
      occurrence_count: 1,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        discharged_at: dischargedAt.toISOString(),
        days_since_discharge: elapsedDays,
        required_action: 'release_shipment'
      },
      attempt_count: 0,
      last_attempt_at: null,
      updated_at: now
    }]
  });
  return rows?.[0] || null;
}

async function updateAlert(row, shipment, dischargedAt, now) {
  const elapsedDays = Math.floor((Date.now() - dischargedAt.getTime()) / DAY);
  const rows = await supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}&select=*`,
    body: {
      severity: 'critical',
      event_status: 'critical',
      alert_status: 'pending',
      status: 'pending',
      delivery_status: 'pending',
      title: 'Contenedor descargado pendiente de liberación',
      message: `El contenedor ${shipment.container_number || 'sin número'} fue descargado hace ${elapsedDays} días y todavía no ha sido liberado.`,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        discharged_at: dischargedAt.toISOString(),
        days_since_discharge: elapsedDays,
        required_action: 'release_shipment'
      },
      last_triggered_at: now,
      occurrence_count: Number(row.occurrence_count || 1) + 1,
      snoozed_until: null,
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
  const threshold = new Date(Date.now() - RELEASE_ALERT_AFTER).toISOString();
  const [shipments, activeAlerts] = await Promise.all([
    supabase('shipments', {
      query: `?select=id,client_id,container_number,discharged_at,released_at,active,clients(id,name)&active=eq.true&discharged_at=not.is.null&discharged_at=lte.${encodeURIComponent(threshold)}&order=discharged_at.asc&limit=5000`
    }),
    loadActiveAlerts()
  ]);

  const eligible = new Set();
  let created = 0;
  let updated = 0;
  let resolved = 0;

  for (const shipment of shipments || []) {
    const key = `${EVENT_TYPE}:${shipment.id}`;
    const dischargedAt = validDate(shipment.discharged_at);
    if (!dischargedAt) continue;

    if (shipment.released_at) {
      const previous = activeAlerts.get(key);
      if (previous) {
        await resolveAlert(previous, now, 'shipment_released');
        resolved += 1;
      }
      continue;
    }

    eligible.add(key);
    const previous = activeAlerts.get(key);
    if (!previous) {
      if (await createAlert(shipment, dischargedAt, now)) created += 1;
      continue;
    }

    const lastTriggered = validDate(previous.last_triggered_at || previous.created_at);
    const repeatDue = !lastTriggered || Date.now() - lastTriggered.getTime() >= DAY;
    if (repeatDue && previous.alert_status !== 'snoozed') {
      if (await updateAlert(previous, shipment, dischargedAt, now)) updated += 1;
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
    threshold_days: 5
  };
}

export default async function handler(req, res) {
  const isCron = cronAuthorized(req);
  const admin = isCron ? { username: 'vercel-cron', admin_id: null } : await authorizeAdmin(req, res, 'notifications.manage');
  if (!admin) return;

  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const result = await runCheck();
    await writeAudit(admin, 'discharge_release_alerts_check', 'system', null, result);
    return ok(res, result);
  } catch (error) {
    console.error('DISCHARGE_RELEASE_ALERTS_ERROR', error);
    return fail(res, 400, 'No se pudo comprobar la liberación después de la descarga', error.message);
  }
}
