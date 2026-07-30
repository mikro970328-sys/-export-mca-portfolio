import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const SIX_HOURS = 6 * 60 * 60 * 1000;
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

function cronAuthorized(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.authorization === `Bearer ${secret}`;
}

function referenceTime(shipment) {
  const value = shipment.last_event_at || shipment.updated_at || shipment.created_at;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function alertLevel(ageMs) {
  if (ageMs >= TWELVE_HOURS) return 'critical';
  if (ageMs >= SIX_HOURS) return 'warning';
  return null;
}

function alertDue(previous, level, nowMs) {
  if (!previous) return true;
  const previousLevel = previous.payload?.alert_level;
  const lastAt = new Date(previous.created_at).getTime();
  if (level === 'critical' && previousLevel !== 'critical') return true;
  return level === 'critical' && Number.isFinite(lastAt) && nowMs - lastAt >= TWELVE_HOURS;
}

async function runCheck() {
  const [shipments, previousAlerts] = await Promise.all([
    supabase('shipments', {
      query: '?select=id,client_id,container_number,shipsgo_status,last_event_at,updated_at,created_at,active,clients(id,name,phone)&active=eq.true&shipsgo_status=neq.manual&order=created_at.asc'
    }),
    supabase('notifications', {
      query: '?select=id,shipment_id,created_at,payload,status,event_type&event_type=eq.tracking_stale&order=created_at.desc&limit=1000'
    })
  ]);

  const latestByShipment = new Map();
  for (const row of previousAlerts || []) if (!latestByShipment.has(row.shipment_id)) latestByShipment.set(row.shipment_id, row);

  const now = new Date();
  const created = [];
  for (const shipment of shipments || []) {
    const reference = referenceTime(shipment);
    if (!reference) continue;
    const ageMs = now.getTime() - reference.getTime();
    const level = alertLevel(ageMs);
    if (!level) continue;

    const previous = latestByShipment.get(shipment.id);
    if (!alertDue(previous, level, now.getTime())) continue;

    const repeatCount = Number(previous?.payload?.repeat_count || 0) + 1;
    const hoursWithoutUpdate = Math.floor(ageMs / (60 * 60 * 1000));
    const title = level === 'critical' ? 'Tracking sin actualización por 12 horas' : 'Tracking sin actualización por 6 horas';

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
        payload: {
          title,
          container_number: shipment.container_number,
          client_name: shipment.clients?.name || null,
          alert_level: level,
          hours_without_update: hoursWithoutUpdate,
          reference_at: reference.toISOString(),
          repeat_count: repeatCount,
          required_action: 'enable_manual'
        },
        attempt_count: repeatCount,
        last_attempt_at: now.toISOString()
      }]
    });
    created.push(inserted?.[0] || { shipment_id: shipment.id, level });
  }

  return { checked: (shipments || []).length, created: created.length, alerts: created };
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
        body: { status: 'resolved', delivery_status: 'resolved' }
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
