import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const CLIENT_ALERT_AFTER = 48 * HOUR;
const CLIENT_CRITICAL_AFTER = 7 * DAY;
const TRACKING_ALERT_AFTER = 12 * HOUR;
const TRACKING_REPEAT_EVERY = 12 * HOUR;
const BOOKING_ALERT_AFTER = 24 * HOUR;
const BOOKING_CRITICAL_AFTER = 72 * HOUR;
const DOCUMENT_ALERT_AFTER = 48 * HOUR;
const ETA_ALERT_AFTER = 24 * HOUR;

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && req.headers.authorization === `Bearer ${secret}`;
}

function validDate(value) {
  const date = new Date(value || 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function elapsedHours(from, nowMs) {
  return Math.max(0, Math.floor((nowMs - from.getTime()) / HOUR));
}

function activeAlertKey(type, entityId) {
  return `${type}:${entityId}`;
}

function normalizedStatus(shipment) {
  return String(shipment.operational_status || shipment.last_status || '').trim().toLowerCase();
}

function isCompletedShipment(shipment) {
  if (shipment.active === false || shipment.delivered_at) return true;
  const status = normalizedStatus(shipment);
  return ['entregado', 'delivered', 'completado', 'completed', 'cerrado', 'closed'].some(value => status.includes(value));
}

function shipmentReference(shipment) {
  return validDate(shipment.created_at || shipment.updated_at);
}

function shipmentEta(shipment) {
  return validDate(shipment.eta || shipment.estimated_arrival || shipment.arrival_date || shipment.eta_at);
}

function etaFieldAvailable(shipment) {
  return ['eta', 'estimated_arrival', 'arrival_date', 'eta_at'].some(field => Object.prototype.hasOwnProperty.call(shipment, field));
}

async function loadActiveOperationalAlerts() {
  const rows = await supabase('notifications', {
    query: '?select=*&notification_scope=eq.operational&resolved_at=is.null&order=created_at.desc&limit=3000'
  });
  return new Map((rows || []).filter(row => row.dedupe_key).map(row => [row.dedupe_key, row]));
}

async function createAlert(data) {
  const inserted = await supabase('notifications', {
    method: 'POST',
    body: [{
      client_id: data.client_id || null,
      shipment_id: data.shipment_id || null,
      event_type: data.event_type,
      event_status: data.severity,
      channel: 'internal',
      status: 'pending',
      delivery_status: 'pending',
      notification_scope: 'operational',
      entity_type: data.entity_type,
      entity_id: data.entity_id,
      alert_status: 'pending',
      severity: data.severity,
      title: data.title,
      message: data.message,
      dedupe_key: data.dedupe_key,
      due_at: data.due_at || null,
      first_triggered_at: data.now,
      last_triggered_at: data.now,
      occurrence_count: 1,
      payload: data.payload || {},
      attempt_count: 0,
      last_attempt_at: null,
      updated_at: data.now
    }]
  });
  return inserted?.[0] || null;
}

async function updateAlert(row, patch) {
  const updated = await supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}&select=*`,
    body: { ...patch, updated_at: new Date().toISOString() }
  });
  return updated?.[0] || { ...row, ...patch };
}

async function resolveAlert(row, reason, now) {
  return updateAlert(row, {
    alert_status: 'resolved',
    status: 'resolved',
    delivery_status: 'resolved',
    resolved_at: now,
    resolved_reason: reason,
    snoozed_until: null
  });
}

function isSnoozed(row, nowMs) {
  if (row.alert_status !== 'snoozed') return false;
  const until = validDate(row.snoozed_until);
  return Boolean(until && until.getTime() > nowMs);
}

async function upsertConditionAlert(activeAlerts, condition) {
  const previous = activeAlerts.get(condition.dedupe_key);
  if (!previous) return createAlert(condition);
  if (isSnoozed(previous, condition.nowMs)) return null;

  const changed = previous.severity !== condition.severity
    || previous.title !== condition.title
    || previous.message !== condition.message
    || previous.alert_status === 'snoozed';

  if (!changed) return null;
  return updateAlert(previous, {
    alert_status: 'pending',
    status: 'pending',
    delivery_status: 'pending',
    severity: condition.severity,
    event_status: condition.severity,
    title: condition.title,
    message: condition.message,
    payload: condition.payload,
    due_at: condition.due_at || null,
    snoozed_until: null,
    resolved_at: null,
    resolved_reason: null,
    last_triggered_at: condition.now,
    occurrence_count: Number(previous.occurrence_count || 1) + 1
  });
}

async function resolveMissingConditions(activeAlerts, eventTypes, eligibleKeys, changed, now) {
  for (const [key, row] of activeAlerts) {
    if (!eventTypes.includes(row.event_type) || eligibleKeys.has(key) || row.resolved_at) continue;
    if (changed.some(item => item?.id === row.id)) continue;
    changed.push(await resolveAlert(row, 'condition_cleared', now));
  }
}

async function processClientAlerts(activeAlerts, now, nowMs) {
  const [clients, shipments] = await Promise.all([
    supabase('clients', { query: '?select=id,name,company,created_at,status&order=created_at.asc&limit=5000' }),
    supabase('shipments', { query: '?select=id,client_id&limit=5000' })
  ]);

  const clientsWithShipment = new Set((shipments || []).map(row => row.client_id).filter(Boolean));
  const eligibleKeys = new Set();
  const changed = [];

  for (const client of clients || []) {
    const key = activeAlertKey('client_without_shipment', client.id);
    const previous = activeAlerts.get(key);
    const createdAt = validDate(client.created_at);
    const inactive = client.status && !['active', 'activo'].includes(String(client.status).toLowerCase());
    const resolvedReason = inactive ? 'client_inactive' : clientsWithShipment.has(client.id) ? 'shipment_assigned' : null;

    if (resolvedReason) {
      if (previous) changed.push(await resolveAlert(previous, resolvedReason, now));
      continue;
    }
    if (!createdAt || nowMs - createdAt.getTime() < CLIENT_ALERT_AFTER) continue;

    eligibleKeys.add(key);
    const ageHours = elapsedHours(createdAt, nowMs);
    const critical = nowMs - createdAt.getTime() >= CLIENT_CRITICAL_AFTER;
    const alert = await upsertConditionAlert(activeAlerts, {
      client_id: client.id,
      event_type: 'client_without_shipment',
      entity_type: 'client',
      entity_id: client.id,
      severity: critical ? 'critical' : 'warning',
      title: critical ? 'Cliente sin contenedor por 7 días' : 'Cliente sin contenedor por 48 horas',
      message: `${client.name || 'Cliente'} lleva ${ageHours} horas sin un contenedor asociado.`,
      dedupe_key: key,
      due_at: new Date(createdAt.getTime() + CLIENT_ALERT_AFTER).toISOString(),
      payload: { client_name: client.name, company: client.company, hours_without_shipment: ageHours },
      now,
      nowMs
    });
    if (alert) changed.push(alert);
  }

  await resolveMissingConditions(activeAlerts, ['client_without_shipment'], eligibleKeys, changed, now);
  return { checked: (clients || []).length, changed };
}

async function processTrackingAlerts(activeAlerts, now, nowMs) {
  const shipments = await supabase('shipments', {
    query: '?select=id,client_id,container_number,shipsgo_status,shipsgo_link_mode,last_event_at,created_at,active,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'
  });

  const eligibleKeys = new Set();
  const changed = [];

  for (const shipment of shipments || []) {
    const key = activeAlertKey('shipment_stale_tracking', shipment.id);
    const previous = activeAlerts.get(key);
    const manual = shipment.shipsgo_status === 'manual' || shipment.shipsgo_link_mode === 'manual';
    if (manual) {
      if (previous) changed.push(await resolveAlert(previous, 'manual_mode_enabled', now));
      continue;
    }

    const reference = validDate(shipment.last_event_at || shipment.created_at);
    if (!reference || nowMs - reference.getTime() < TRACKING_ALERT_AFTER) {
      if (previous) changed.push(await resolveAlert(previous, 'tracking_updated', now));
      continue;
    }

    eligibleKeys.add(key);
    const hours = elapsedHours(reference, nowMs);
    const lastTriggered = validDate(previous?.last_triggered_at || previous?.first_triggered_at || previous?.created_at);
    const repeatDue = !previous || !lastTriggered || nowMs - lastTriggered.getTime() >= TRACKING_REPEAT_EVERY;
    if (!repeatDue && previous?.alert_status !== 'snoozed') continue;

    const alert = await upsertConditionAlert(activeAlerts, {
      client_id: shipment.client_id,
      shipment_id: shipment.id,
      event_type: 'shipment_stale_tracking',
      entity_type: 'shipment',
      entity_id: shipment.id,
      severity: 'critical',
      title: `Tracking sin actualización por ${hours} horas`,
      message: `El contenedor ${shipment.container_number} no recibe una actualización automática desde hace ${hours} horas.`,
      dedupe_key: key,
      due_at: new Date(reference.getTime() + TRACKING_ALERT_AFTER).toISOString(),
      payload: {
        container_number: shipment.container_number,
        client_name: shipment.clients?.name || null,
        hours_without_update: hours,
        reference_at: reference.toISOString(),
        required_action: 'review_or_enable_manual'
      },
      now,
      nowMs
    });
    if (alert) changed.push(alert);
  }

  await resolveMissingConditions(activeAlerts, ['shipment_stale_tracking'], eligibleKeys, changed, now);
  return { checked: (shipments || []).length, changed };
}

async function processShipmentIntegrityAlerts(activeAlerts, now, nowMs) {
  const shipments = await supabase('shipments', {
    query: '?select=*,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'
  });

  const eventTypes = [
    'shipment_without_client',
    'shipment_without_booking',
    'shipment_without_bl',
    'shipment_without_eta',
    'shipment_eta_overdue'
  ];
  const eligibleKeys = new Set();
  const changed = [];

  for (const shipment of shipments || []) {
    if (isCompletedShipment(shipment)) continue;
    const reference = shipmentReference(shipment);
    const ageMs = reference ? nowMs - reference.getTime() : 0;
    const hours = reference ? elapsedHours(reference, nowMs) : 0;
    const container = shipment.container_number || 'Sin número';
    const basePayload = {
      container_number: shipment.container_number || null,
      client_name: shipment.clients?.name || null,
      operational_status: shipment.operational_status || shipment.last_status || null,
      shipment_age_hours: hours
    };

    if (!shipment.client_id) {
      const key = activeAlertKey('shipment_without_client', shipment.id);
      eligibleKeys.add(key);
      const alert = await upsertConditionAlert(activeAlerts, {
        client_id: null,
        shipment_id: shipment.id,
        event_type: 'shipment_without_client',
        entity_type: 'shipment',
        entity_id: shipment.id,
        severity: 'critical',
        title: 'Contenedor sin cliente asignado',
        message: `El contenedor ${container} está activo pero no tiene un cliente asociado.`,
        dedupe_key: key,
        due_at: reference?.toISOString() || now,
        payload: { ...basePayload, required_action: 'assign_client' },
        now,
        nowMs
      });
      if (alert) changed.push(alert);
    }

    if (!String(shipment.booking_number || '').trim() && reference && ageMs >= BOOKING_ALERT_AFTER) {
      const key = activeAlertKey('shipment_without_booking', shipment.id);
      eligibleKeys.add(key);
      const critical = ageMs >= BOOKING_CRITICAL_AFTER;
      const alert = await upsertConditionAlert(activeAlerts, {
        client_id: shipment.client_id,
        shipment_id: shipment.id,
        event_type: 'shipment_without_booking',
        entity_type: 'shipment',
        entity_id: shipment.id,
        severity: critical ? 'critical' : 'warning',
        title: critical ? 'Contenedor sin booking por más de 72 horas' : 'Contenedor sin booking',
        message: `El contenedor ${container} lleva ${hours} horas activo sin número de booking.`,
        dedupe_key: key,
        due_at: new Date(reference.getTime() + BOOKING_ALERT_AFTER).toISOString(),
        payload: { ...basePayload, required_action: 'add_booking_number' },
        now,
        nowMs
      });
      if (alert) changed.push(alert);
    }

    const hasDraftOrBl = Boolean(String(shipment.draft_bol_number || shipment.bol_number || '').trim());
    if (!hasDraftOrBl && reference && ageMs >= DOCUMENT_ALERT_AFTER) {
      const key = activeAlertKey('shipment_without_bl', shipment.id);
      eligibleKeys.add(key);
      const alert = await upsertConditionAlert(activeAlerts, {
        client_id: shipment.client_id,
        shipment_id: shipment.id,
        event_type: 'shipment_without_bl',
        entity_type: 'shipment',
        entity_id: shipment.id,
        severity: ageMs >= 7 * DAY ? 'critical' : 'warning',
        title: ageMs >= 7 * DAY ? 'Contenedor sin Draft B/L o B/L por 7 días' : 'Contenedor sin Draft B/L o B/L',
        message: `El contenedor ${container} lleva ${hours} horas sin Draft B/L ni B/L registrado.`,
        dedupe_key: key,
        due_at: new Date(reference.getTime() + DOCUMENT_ALERT_AFTER).toISOString(),
        payload: { ...basePayload, required_action: 'add_draft_or_final_bl' },
        now,
        nowMs
      });
      if (alert) changed.push(alert);
    }

    if (etaFieldAvailable(shipment)) {
      const eta = shipmentEta(shipment);
      if (!eta && reference && ageMs >= ETA_ALERT_AFTER) {
        const key = activeAlertKey('shipment_without_eta', shipment.id);
        eligibleKeys.add(key);
        const alert = await upsertConditionAlert(activeAlerts, {
          client_id: shipment.client_id,
          shipment_id: shipment.id,
          event_type: 'shipment_without_eta',
          entity_type: 'shipment',
          entity_id: shipment.id,
          severity: 'warning',
          title: 'Contenedor activo sin ETA',
          message: `El contenedor ${container} lleva ${hours} horas activo sin fecha estimada de llegada.`,
          dedupe_key: key,
          due_at: new Date(reference.getTime() + ETA_ALERT_AFTER).toISOString(),
          payload: { ...basePayload, required_action: 'add_eta' },
          now,
          nowMs
        });
        if (alert) changed.push(alert);
      }

      if (eta && eta.getTime() < nowMs) {
        const key = activeAlertKey('shipment_eta_overdue', shipment.id);
        eligibleKeys.add(key);
        const overdueHours = elapsedHours(eta, nowMs);
        const alert = await upsertConditionAlert(activeAlerts, {
          client_id: shipment.client_id,
          shipment_id: shipment.id,
          event_type: 'shipment_eta_overdue',
          entity_type: 'shipment',
          entity_id: shipment.id,
          severity: 'critical',
          title: 'ETA vencida sin cierre operativo',
          message: `La ETA del contenedor ${container} venció hace ${overdueHours} horas y la operación continúa activa.`,
          dedupe_key: key,
          due_at: eta.toISOString(),
          payload: { ...basePayload, eta: eta.toISOString(), overdue_hours: overdueHours, required_action: 'review_arrival_status' },
          now,
          nowMs
        });
        if (alert) changed.push(alert);
      }
    }
  }

  await resolveMissingConditions(activeAlerts, eventTypes, eligibleKeys, changed, now);
  return { checked: (shipments || []).length, changed };
}

async function resolveLegacyTrackingAlerts(now) {
  const rows = await supabase('notifications', {
    query: '?select=id&event_type=eq.tracking_stale&status=eq.pending&limit=1000'
  });
  await Promise.all((rows || []).map(row => supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}`,
    body: { status: 'resolved', delivery_status: 'resolved', updated_at: now }
  })));
  return (rows || []).length;
}

async function runCheck() {
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const activeAlerts = await loadActiveOperationalAlerts();
  const [clients, tracking, integrity, legacyResolved] = await Promise.all([
    processClientAlerts(activeAlerts, now, nowMs),
    processTrackingAlerts(activeAlerts, now, nowMs),
    processShipmentIntegrityAlerts(activeAlerts, now, nowMs),
    resolveLegacyTrackingAlerts(now)
  ]);
  return {
    clients_checked: clients.checked,
    tracking_checked: tracking.checked,
    shipments_integrity_checked: integrity.checked,
    client_alerts_changed: clients.changed.length,
    tracking_alerts_changed: tracking.changed.length,
    logistics_alerts_changed: integrity.changed.length,
    legacy_tracking_alerts_resolved: legacyResolved
  };
}

export default async function handler(req, res) {
  const isCron = cronAuthorized(req);
  const admin = isCron ? { username: 'vercel-cron', admin_id: null } : requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      if (isCron || String(req.query?.action || '') === 'check') {
        const result = await runCheck();
        await writeAudit(admin, 'operational_alerts_check', 'system', null, result);
        return ok(res, result);
      }
      const rows = await supabase('notifications', {
        query: '?select=*,clients(id,name),shipments(id,container_number,shipsgo_status,last_event_at)&notification_scope=eq.operational&resolved_at=is.null&order=created_at.desc&limit=500'
      });
      return ok(res, { alerts: rows || [] });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador de la alerta');
      if (body.action !== 'resolve') return fail(res, 400, 'Acción no válida');
      const now = new Date().toISOString();
      await supabase('notifications', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(id)}`,
        body: {
          alert_status: 'resolved',
          status: 'resolved',
          delivery_status: 'resolved',
          resolved_at: now,
          resolved_reason: 'manual',
          updated_at: now
        }
      });
      await writeAudit(admin, 'operational_alert_resolved', 'notification', id, {});
      return ok(res, { resolved: true });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('OPERATIONAL_ALERTS_ERROR', error);
    return fail(res, 400, 'No se pudieron procesar las alertas operativas', error.message);
  }
}
