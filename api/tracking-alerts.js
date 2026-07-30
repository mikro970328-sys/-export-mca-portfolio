import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

function referenceTime(shipment) {
  const value = shipment.last_event_at || shipment.created_at;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function alertLevel(ageMs) {
  if (ageMs >= TWELVE_HOURS) return 'critical';
  if (ageMs >= SIX_HOURS) return 'warning';
  return null;
}

function lastAlertTime(alert) {
  const value = alert?.last_attempt_at || alert?.updated_at || alert?.created_at;
  const date = new Date(value || 0).getTime();
  return Number.isFinite(date) ? date : 0;
}

function alertDue(previous, level, nowMs) {
  if (!previous) return true;
  const previousLevel = previous.payload?.alert_level || previous.event_status;
  if (level === 'critical' && previousLevel !== 'critical') return true;
  return level === 'critical' && nowMs - lastAlertTime(previous) >= TWELVE_HOURS;
}

async function resolveInactiveAlerts(activeShipmentIds) {
  const pending = await supabase('notifications', {
    query: '?select=id,shipment_id&event_type=eq.tracking_stale&status=eq.pending&limit=1000'
  });

  const inactive = (pending || []).filter(row => !activeShipmentIds.has(row.shipment_id));
  await Promise.all(inactive.map(row => supabase('notifications', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(row.id)}`,
    body: {
      status: 'resolved',
      delivery_status: 'resolved',
      updated_at: new Date().toISOString()
    }
  })));
  return inactive.length;
}

async function runCheck() {
  const [shipments, previousAlerts] = await Promise.all([
    supabase('shipments', {
      query: '?select=id,client_id,container_number,shipsgo_status,last_event_at,created_at,active,clients(id,name,phone)&active=eq.true&shipsgo_status=neq.manual&order=created_at.asc'
    }),
    supabase('notifications', {
      query: '?select=id,shipment_id,created_at,updated_at,last_attempt_at,payload,status,event_type,event_status,attempt_count&event_type=eq.tracking_stale&status=eq.pending&order=created_at.desc&limit=1000'
    })
  ]);

  const latestByShipment = new Map();
  for (const row of previousAlerts || []) {
    if (!latestByShipment.has(row.shipment_id)) latestByShipment.set(row.shipment_id, row);
  }

  const now = new Date();
  const nowMs = now.getTime();
  const activeShipmentIds = new Set((shipments || []).map(row => row.id));
  const changed = [];

  for (const shipment of shipments || []) {
    const reference = referenceTime(shipment);
    if (!reference) continue;

    const ageMs = nowMs - reference.getTime();
    const level = alertLevel(ageMs);
    const previous = latestByShipment.get(shipment.id);

    if (!level) {
      if (previous) {
        await supabase('notifications', {
          method: 'PATCH',
          query: `?id=eq.${encodeURIComponent(previous.id)}`,
          body: { status: 'resolved', delivery_status: 'resolved', updated_at: now.toISOString() }
        });
      }
      continue;
    }

    if (!alertDue(previous, level, nowMs)) continue;

    const repeatCount = previous
      ? Number(previous.payload?.repeat_count || previous.attempt_count || 1) + 1
      : 1;
    const hoursWithoutUpdate = Math.floor(ageMs / (60 * 60 * 1000));
    const title = level === 'critical'
      ? 'Tracking sin actualización por 12 horas'
      : 'Tracking sin actualización por 6 horas';
    const payload = {
      title,
      container_number: shipment.container_number,
      client_name: shipment.clients?.name || null,
      alert_level: level,
      hours_without_update: hoursWithoutUpdate,
      reference_at: reference.toISOString(),
      repeat_count: repeatCount,
      required_action: 'enable_manual'
    };

    if (previous) {
      const updated = await supabase('notifications', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(previous.id)}&select=*`,
        body: {
          event_status: level,
          status: 'pending',
          delivery_status: 'pending',
          payload,
          attempt_count: repeatCount,
          last_attempt_at: now.toISOString(),
          updated_at: now.toISOString()
        }
      });
      changed.push(updated?.[0] || { id: previous.id, shipment_id: shipment.id, level, action: 'updated' });
    } else {
      const inserted = await supabase('notifications', {
        method: 'POST',
        body: [{
          shipment_id: shipment.id,
          client_id: shipment.client_id,
          event_type: 'tracking_stale',
          event_status: level,
          channel: 'internal',
          status: 'pending',
          delivery_status: 'pending',
          recipient: null,
          recipient_phone: null,
          payload,
          attempt_count: repeatCount,
          last_attempt_at: now.toISOString()
        }]
      });
      changed.push(inserted?.[0] || { shipment_id: shipment.id, level, action: 'created' });
    }
  }

  const resolvedInactive = await resolveInactiveAlerts(activeShipmentIds);
  return {
    checked: (shipments || []).length,
    changed: changed.length,
    resolved_inactive: resolvedInactive,
    alerts: changed
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
        await writeAudit(admin, 'tracking_stale_check', 'system', null, result);
        return ok(res, result);
      }

      const rows = await supabase('notifications', {
        query: '?select=*,clients(id,name),shipments(id,container_number,shipsgo_status,last_event_at,created_at)&event_type=eq.tracking_stale&status=eq.pending&order=created_at.desc&limit=300'
      });
      return ok(res, { alerts: rows || [] });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador de la alerta');
      if (body.action !== 'resolve') return fail(res, 400, 'Acción no válida');
      await supabase('notifications', {
        method: 'PATCH',
        query: `?id=eq.${encodeURIComponent(id)}`,
        body: { status: 'resolved', delivery_status: 'resolved', updated_at: new Date().toISOString() }
      });
      await writeAudit(admin, 'tracking_stale_alert_resolved', 'notification', id, {});
      return ok(res, { resolved: true });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('TRACKING_ALERTS_ERROR', error);
    return fail(res, 400, 'No se pudieron procesar las alertas de tracking', error.message);
  }
}
