import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';

const DAY = 24 * 60 * 60 * 1000;
const EVENT_TYPE = 'shipment_stagnant_status';

const RULES = [
  { match: ['registrado', 'registered'], warningDays: 5, criticalDays: 7 },
  { match: ['cargado en el buque', 'loaded on vessel'], warningDays: 3, criticalDays: 5 },
  { match: ['salió del puerto', 'salio del puerto', 'departed'], warningDays: 7, criticalDays: 10 },
  { match: ['llegó al puerto', 'llego al puerto', 'arrived'], warningDays: 3, criticalDays: 5 },
  { match: ['liberado', 'released'], warningDays: 3, criticalDays: 5 }
];

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizedStatus(shipment) {
  return String(shipment.last_status || shipment.operational_status || '').trim().toLowerCase();
}

function ruleFor(status) {
  return RULES.find(rule => rule.match.some(value => status.includes(value))) || null;
}

async function loadActiveAlerts() {
  const rows = await supabase('notifications', {
    query: `?select=*&notification_scope=eq.operational&event_type=eq.${EVENT_TYPE}&resolved_at=is.null&limit=3000`
  });
  return new Map((rows || []).filter(row => row.dedupe_key).map(row => [row.dedupe_key, row]));
}

async function createAlert(shipment, status, reference, elapsedDays, rule, now) {
  const severity = elapsedDays >= rule.criticalDays ? 'critical' : 'warning';
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
      title: severity === 'critical' ? 'Contenedor detenido en el mismo estado' : 'Contenedor sin avance operativo',
      message: `El contenedor ${shipment.container_number || 'sin número'} lleva ${elapsedDays} días en “${status}” sin registrar un nuevo evento.`,
      dedupe_key: key,
      due_at: new Date(reference.getTime() + rule.warningDays * DAY).toISOString(),
      first_triggered_at: now,
      last_triggered_at: now,
      occurrence_count: 1,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        operational_status: status,
        status_reference_at: reference.toISOString(),
        days_in_status: elapsedDays,
        warning_days: rule.warningDays,
        critical_days: rule.criticalDays,
        required_action: 'review_shipment_status'
      },
      attempt_count: 0,
      last_attempt_at: null,
      updated_at: now
    }]
  });
  return rows?.[0] || null;
}

async function updateAlert(row, shipment, status, reference, elapsedDays, rule, now) {
  const severity = elapsedDays >= rule.criticalDays ? 'critical' : 'warning';
  const rows = await supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}&select=*`,
    body: {
      severity,
      event_status: severity,
      alert_status: 'pending',
      status: 'pending',
      delivery_status: 'pending',
      title: severity === 'critical' ? 'Contenedor detenido en el mismo estado' : 'Contenedor sin avance operativo',
      message: `El contenedor ${shipment.container_number || 'sin número'} lleva ${elapsedDays} días en “${status}” sin registrar un nuevo evento.`,
      payload: {
        container_number: shipment.container_number || null,
        client_name: shipment.clients?.name || null,
        operational_status: status,
        status_reference_at: reference.toISOString(),
        days_in_status: elapsedDays,
        warning_days: rule.warningDays,
        critical_days: rule.criticalDays,
        required_action: 'review_shipment_status'
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
  const nowMs = Date.now();
  const [shipments, activeAlerts] = await Promise.all([
    supabase('shipments', {
      query: '?select=id,client_id,container_number,last_status,operational_status,last_event_at,created_at,updated_at,shipsgo_status,active,released_at,delivered_at,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'
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
    const status = normalizedStatus(shipment);

    if (shipment.shipsgo_status === 'manual' || status.includes('descargado') || status.includes('discharged') || shipment.delivered_at) {
      if (previous) {
        await resolveAlert(previous, now, 'covered_by_specific_rule_or_completed');
        resolved += 1;
      }
      continue;
    }

    const rule = ruleFor(status);
    const reference = validDate(shipment.last_event_at || shipment.updated_at || shipment.created_at);
    if (!rule || !reference) {
      if (previous) {
        await resolveAlert(previous, now, 'status_not_monitored');
        resolved += 1;
      }
      continue;
    }

    const elapsedDays = Math.floor((nowMs - reference.getTime()) / DAY);
    if (elapsedDays < rule.warningDays) {
      if (previous) {
        await resolveAlert(previous, now, 'status_advanced_or_within_threshold');
        resolved += 1;
      }
      continue;
    }

    eligible.add(key);
    if (!previous) {
      if (await createAlert(shipment, shipment.last_status || shipment.operational_status || 'Sin estado', reference, elapsedDays, rule, now)) created += 1;
      continue;
    }

    const previousReference = validDate(previous.payload?.status_reference_at);
    if (previousReference && previousReference.getTime() !== reference.getTime()) {
      await resolveAlert(previous, now, 'status_reference_changed');
      resolved += 1;
      eligible.delete(key);
      continue;
    }

    const lastTriggered = validDate(previous.last_triggered_at || previous.created_at);
    const severity = elapsedDays >= rule.criticalDays ? 'critical' : 'warning';
    const repeatDue = !lastTriggered || nowMs - lastTriggered.getTime() >= DAY;
    const severityChanged = previous.severity !== severity;
    if ((repeatDue || severityChanged) && previous.alert_status !== 'snoozed') {
      if (await updateAlert(previous, shipment, shipment.last_status || shipment.operational_status || 'Sin estado', reference, elapsedDays, rule, now)) updated += 1;
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
  const admin = isCron ? { username: 'vercel-cron', admin_id: null } : await authorizeAdmin(req, res, 'notifications.manage');
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const result = await runCheck();
    await writeAudit(admin, 'stagnant_shipment_alerts_check', 'system', null, result);
    return ok(res, result);
  } catch (error) {
    console.error('STAGNANT_SHIPMENT_ALERTS_ERROR', error);
    return fail(res, 400, 'No se pudieron comprobar los contenedores detenidos', error.message);
  }
}
