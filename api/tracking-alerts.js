import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const HOUR = 60 * 60 * 1000;
const CLIENT_ALERT_AFTER = 48 * HOUR;
const CLIENT_CRITICAL_AFTER = 7 * 24 * HOUR;
const TRACKING_ALERT_AFTER = 12 * HOUR;
const TRACKING_REPEAT_EVERY = 12 * HOUR;

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

async function loadActiveOperationalAlerts() {
  const rows = await supabase('notifications', {
    query: '?select=*&notification_scope=eq.operational&resolved_at=is.null&order=created_at.desc&limit=2000'
  });
  return new Map((rows || []).filter(row => row.dedupe_key).map(row => [row.dedupe_key, row]));
}

async function createAlert(data) {
  const inserted = await supabase('notifications', {
    method: 'POST',
    body: [{
      client_id: data.client_id,
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

async function processClientAlerts(activeAlerts, now, nowMs) {
  const [clients, shipments] = await Promise.all([
    supabase('clients', { query: '?select=id,name,company,created_at,active&order=created_at.asc&limit=5000' }),
    supabase('shipments', { query: '?select=id,client_id&limit=5000' })
  ]);

  const clientsWithShipment = new Set((shipments || []).map(row => row.client_id));
  const eligibleKeys = new Set();
  const changed = [];

  for (const client of clients || []) {
    const key = activeAlertKey('client_without_shipment', client.id);
    const previous = activeAlerts.get(key);
    const createdAt = validDate(client.created_at);
    const inactive = client.active === false;
    const resolvedReason = inactive ? 'client_inactive' : clientsWithShipment.has(client.id) ? 'shipment_assigned' : null;

    if (resolvedReason) {
      if (previous) changed.push(await resolveAlert(previous, resolvedReason, now));
      continue;
    }
    if (!createdAt || nowMs - createdAt.getTime() < CLIENT_ALERT_AFTER) continue;

    eligibleKeys.add(key);
    const ageHours = elapsedHours(createdAt, nowMs);
    const critical = nowMs - createdAt.getTime() >= CLIENT_CRITICAL_AFTER;
    const severity = critical ? 'critical' : 'warning';
    const title = critical ? 'Cliente sin contenedor por 7 días' : 'Cliente sin contenedor por 48 horas';
    const message = `${client.name || 'Cliente'} lleva ${ageHours} horas sin un contenedor asociado.`;
    const payload = { client_name: client.name, company: client.company, hours_without_shipment: ageHours };

    if (!previous) {
      const created = await createAlert({
        client_id: client.id,
        event_type: 'client_without_shipment',
        entity_type: 'client',
        entity_id: client.id,
        severity,
        title,
        message,
        dedupe_key: key,
        due_at: new Date(createdAt.getTime() + CLIENT_ALERT_AFTER).toISOString(),
        payload,
        now
      });
      if (created) changed.push(created);
      continue;
    }

    if (isSnoozed(previous, nowMs)) continue;
    const needsUpdate = previous.severity !== severity || previous.alert_status === 'snoozed';
    if (needsUpdate) {
      changed.push(await updateAlert(previous, {
        alert_status: 'pending',
        severity,
        event_status: severity,
        title,
        message,
        payload,
        snoozed_until: null,
        last_triggered_at: now,
        occurrence_count: Number(previous.occurrence_count || 1) + 1
      }));
    }
  }

  for (const [key, row] of activeAlerts) {
    if (row.event_type === 'client_without_shipment' && !eligibleKeys.has(key) && !row.resolved_at) {
      const alreadyChanged = changed.some(item => item?.id === row.id);
      if (!alreadyChanged) changed.push(await resolveAlert(row, 'condition_cleared', now));
    }
  }

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
    const interval = Math.max(1, Math.floor(hours / 12));
    const title = `Tracking sin actualización por ${hours} horas`;
    const message = `El contenedor ${shipment.container_number} no recibe una actualización automática desde hace ${hours} horas.`;
    const payload = {
      container_number: shipment.container_number,
      client_name: shipment.clients?.name || null,
      hours_without_update: hours,
      reference_at: reference.toISOString(),
      repeat_interval: interval,
      required_action: 'review_or_enable_manual'
    };

    if (!previous) {
      const created = await createAlert({
        client_id: shipment.client_id,
        shipment_id: shipment.id,
        event_type: 'shipment_stale_tracking',
        entity_type: 'shipment',
        entity_id: shipment.id,
        severity: 'critical',
        title,
        message,
        dedupe_key: key,
        due_at: new Date(reference.getTime() + TRACKING_ALERT_AFTER).toISOString(),
        payload,
        now
      });
      if (created) changed.push(created);
      continue;
    }

    if (isSnoozed(previous, nowMs)) continue;
    const lastTriggered = validDate(previous.last_triggered_at || previous.first_triggered_at || previous.created_at);
    const repeatDue = !lastTriggered || nowMs - lastTriggered.getTime() >= TRACKING_REPEAT_EVERY;
    if (repeatDue || previous.alert_status === 'snoozed') {
      changed.push(await updateAlert(previous, {
        alert_status: 'pending',
        severity: 'critical',
        event_status: 'critical',
        title,
        message,
        payload,
        snoozed_until: null,
        last_triggered_at: now,
        occurrence_count: Number(previous.occurrence_count || 1) + 1
      }));
    }
  }

  for (const [key, row] of activeAlerts) {
    if (row.event_type === 'shipment_stale_tracking' && !eligibleKeys.has(key) && !row.resolved_at) {
      const alreadyChanged = changed.some(item => item?.id === row.id);
      if (!alreadyChanged) changed.push(await resolveAlert(row, 'condition_cleared', now));
    }
  }

  return { checked: (shipments || []).length, changed };
}

function sameMissingDocuments(previous, nextMissing) {
  const before = Array.isArray(previous?.payload?.missing_documents) ? [...previous.payload.missing_documents].sort() : [];
  const after = Array.isArray(nextMissing) ? [...nextMissing].sort() : [];
  return before.length === after.length && before.every((value,index) => value === after[index]);
}

async function processCustomsDocumentAlerts(activeAlerts, now, nowMs) {
  const readinessRows = await supabase('shipment_customs_document_readiness', {
    query: '?select=shipment_id,container_number,client_id,active,documentation_required,has_packing_list_cuba,has_commercial_invoice_cuba,document_status,missing_documents&order=container_number.asc&limit=5000'
  }) || [];
  const eligibleKeys = new Set();
  const changed = [];

  for (const row of readinessRows) {
    const key = activeAlertKey('shipment_customs_documents_missing', row.shipment_id);
    const previous = activeAlerts.get(key);
    const missing = Array.isArray(row.missing_documents) ? row.missing_documents : [];
    const pending = row.documentation_required === true && row.document_status !== 'ready' && missing.length > 0;

    if (!pending) {
      if (previous) changed.push(await resolveAlert(previous, row.document_status === 'ready' ? 'documents_complete' : 'documentation_not_required', now));
      continue;
    }

    eligibleKeys.add(key);
    const friendlyMissing = missing.map(value => value === 'Commercial Invoice Cuba' ? 'Factura comercial Cuba' : value);
    const title = 'Documentos Cuba pendientes';
    const message = `El contenedor ${row.container_number} está enviado y todavía falta: ${friendlyMissing.join(' y ')}.`;
    const payload = {
      container_number: row.container_number,
      missing_documents: missing,
      has_packing_list_cuba: Boolean(row.has_packing_list_cuba),
      has_commercial_invoice_cuba: Boolean(row.has_commercial_invoice_cuba),
      document_status: row.document_status,
      required_action: 'upload_cuba_customs_documents'
    };

    if (!previous) {
      const created = await createAlert({
        client_id: row.client_id,
        shipment_id: row.shipment_id,
        event_type: 'shipment_customs_documents_missing',
        entity_type: 'shipment',
        entity_id: row.shipment_id,
        severity: 'warning',
        title,
        message,
        dedupe_key: key,
        payload,
        now
      });
      if (created) changed.push(created);
      continue;
    }

    if (isSnoozed(previous, nowMs)) continue;
    if (!sameMissingDocuments(previous,missing) || previous.alert_status === 'snoozed' || previous.title !== title || previous.message !== message) {
      changed.push(await updateAlert(previous, {
        alert_status: 'pending',
        severity: 'warning',
        event_status: 'warning',
        title,
        message,
        payload,
        snoozed_until: null,
        last_triggered_at: now,
        occurrence_count: Number(previous.occurrence_count || 1) + 1
      }));
    }
  }

  for (const [key,row] of activeAlerts) {
    if (row.event_type === 'shipment_customs_documents_missing' && !eligibleKeys.has(key) && !row.resolved_at) {
      const alreadyChanged = changed.some(item => item?.id === row.id);
      if (!alreadyChanged) changed.push(await resolveAlert(row,'condition_cleared',now));
    }
  }

  return { checked: readinessRows.length, changed };
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
  const [clients, tracking, customsDocuments, legacyResolved] = await Promise.all([
    processClientAlerts(activeAlerts, now, nowMs),
    processTrackingAlerts(activeAlerts, now, nowMs),
    processCustomsDocumentAlerts(activeAlerts, now, nowMs),
    resolveLegacyTrackingAlerts(now)
  ]);
  return {
    clients_checked: clients.checked,
    tracking_checked: tracking.checked,
    customs_documents_checked: customsDocuments.checked,
    client_alerts_changed: clients.changed.length,
    tracking_alerts_changed: tracking.changed.length,
    customs_document_alerts_changed: customsDocuments.changed.length,
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
