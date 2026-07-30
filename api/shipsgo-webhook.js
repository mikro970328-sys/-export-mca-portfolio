import crypto from 'node:crypto';
import { fail, normalizeContainer, ok, sendWhatsApp, supabase } from './_lib.js';

export const config = { api: { bodyParser: false } };

const EVENT_LABELS = {
  LOAD: 'Cargado en el buque',
  DEPA: 'Salió del puerto',
  ARRV: 'Llegó al puerto',
  DISC: 'Descargado del buque',
  GTOT: 'Salió de la terminal'
};

async function readRawBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function validSignature(rawBody, signature) {
  const secret = process.env.SHIPSGO_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  if (!signature || signature.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

function extract(payload) {
  const shipment = payload?.shipment || payload?.data?.shipment || payload?.data || payload?.resource || payload?.object || {};
  const containers = shipment?.containers || [];
  const movements = containers.flatMap((container) =>
    (container.movements || []).map((movement) => ({
      ...movement,
      containerNumber: container.number || container.container_number || shipment.container_number
    }))
  );

  const movement = movements
    .filter((item) => String(item.status || '').toUpperCase() === 'ACT' && item.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  const container = normalizeContainer(
    movement?.containerNumber || shipment.container_number || shipment.containerNumber || containers?.[0]?.number
  );
  const code = String(movement?.event || '').toUpperCase();
  const status = EVENT_LABELS[code] || movement?.event_description || movement?.description || 'Nueva actualización del embarque';
  const location = movement?.location?.name || movement?.location || shipment?.current_location || 'No disponible';
  const eventTime = movement?.timestamp || new Date().toISOString();
  return { shipment, movement, container, code, status, location, eventTime };
}

async function resolveTrackingAlerts(shipmentId) {
  const rows = await supabase('notifications', {
    method: 'PATCH',
    query: `?shipment_id=eq.${encodeURIComponent(shipmentId)}&event_type=eq.tracking_stale&status=eq.pending&select=id`,
    body: {
      status: 'resolved',
      delivery_status: 'resolved',
      updated_at: new Date().toISOString()
    }
  });
  return rows?.length || 0;
}

async function writeTrackingHistory(shipment, event, details, source = 'shipsgo') {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{
        shipment_id: shipment.id,
        client_id: shipment.client_id,
        event_type: `shipsgo_${String(event.code || 'event').toLowerCase()}`,
        title: `ShipsGo · ${event.status}`,
        details,
        source
      }]
    });
  } catch (error) {
    console.error('SHIPSGO_HISTORY_FAILED', error.message);
  }
}

async function logWebhookEvent(event, payload, processed, errorMessage = null) {
  await supabase('webhook_events', {
    method: 'POST',
    body: [{
      container_number: event.container,
      event_type: event.status,
      payload,
      processed,
      error_message: errorMessage
    }]
  });
}

async function logWhatsAppFailure(shipment, event, payload, error) {
  try {
    await supabase('notifications', {
      method: 'POST',
      body: [{
        shipment_id: shipment.id,
        client_id: shipment.client_id,
        recipient_phone: shipment.clients.phone,
        event_status: event.status,
        event_location: event.location,
        event_time: event.eventTime,
        delivery_status: 'failed',
        event_type: 'tracking',
        channel: 'whatsapp',
        status: 'failed',
        error_message: error.message,
        raw_event: payload,
        payload: {
          container_number: event.container,
          client_name: shipment.clients.name,
          status: event.status,
          location: event.location
        },
        attempt_count: 1,
        last_attempt_at: new Date().toISOString()
      }]
    });
  } catch (logError) {
    console.error('SHIPSGO_WHATSAPP_FAILURE_LOG_ERROR', logError);
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') return ok(res, { ok: true, service: 'export-mca-shipsgo-webhook', version: 6 });
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');

  try {
    const rawBody = await readRawBody(req);
    if (!validSignature(rawBody, req.headers['x-shipsgo-webhook-signature'])) {
      return fail(res, 401, 'Firma de ShipsGo inválida');
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventName = payload?.event?.name || payload?.event_name || req.headers['x-shipsgo-webhook-name'] || '';
    if (eventName && !eventName.includes('SHIPMENT_')) return ok(res, { received: true, ignored: eventName });

    const event = extract(payload);
    const rows = await supabase('shipments', {
      query: `?select=*,clients(id,name,phone,active)&container_number=eq.${encodeURIComponent(event.container)}&active=eq.true&limit=1`
    });
    const shipment = rows?.[0];

    if (!shipment?.clients?.active) {
      await logWebhookEvent(event, payload, false, 'No hay cliente activo asociado');
      return ok(res, { received: true, notified: false, reason: 'shipment_not_found' });
    }

    const incomingTime = new Date(event.eventTime).getTime();
    const currentTime = shipment.last_event_at ? new Date(shipment.last_event_at).getTime() : 0;

    if (Number.isFinite(currentTime) && currentTime > 0 && Number.isFinite(incomingTime) && incomingTime <= currentTime) {
      await logWebhookEvent(event, payload, false, 'Evento anterior o igual al último evento confirmado');
      await writeTrackingHistory(
        shipment,
        event,
        `Ignorado por antigüedad · Evento ShipsGo: ${event.eventTime} · Último evento ERP: ${shipment.last_event_at}`,
        'shipsgo'
      );
      return ok(res, {
        received: true,
        tracking_updated: false,
        notified: false,
        reason: 'stale_event',
        current_event_time: shipment.last_event_at,
        incoming_event_time: event.eventTime
      });
    }

    if (shipment.shipsgo_status === 'manual') {
      await logWebhookEvent(event, payload, false, 'Evento recibido mientras el contenedor está en modo manual');
      await writeTrackingHistory(
        shipment,
        event,
        `Detectado por ShipsGo durante modo manual · ${event.location} · ${event.eventTime}`,
        'shipsgo'
      );
      return ok(res, {
        received: true,
        tracking_updated: false,
        notified: false,
        reason: 'manual_mode'
      });
    }

    const existing = await supabase('notifications', {
      query: `?select=id&shipment_id=eq.${shipment.id}&event_status=eq.${encodeURIComponent(event.status)}&event_time=eq.${encodeURIComponent(event.eventTime)}&limit=1`
    });

    await supabase(`shipments?id=eq.${shipment.id}`, {
      method: 'PATCH',
      body: {
        last_status: event.status,
        operational_status: event.status,
        last_location: event.location,
        last_event_at: event.eventTime,
        updated_at: new Date().toISOString()
      }
    });
    await writeTrackingHistory(shipment, event, `${event.location} · ${event.eventTime}`, 'shipsgo');
    const resolvedAlerts = await resolveTrackingAlerts(shipment.id);

    if (existing?.length) {
      return ok(res, {
        received: true,
        tracking_updated: true,
        resolved_alerts: resolvedAlerts,
        notified: false,
        reason: 'duplicate'
      });
    }

    let twilio;
    try {
      twilio = await sendWhatsApp({
        to: shipment.clients.phone,
        variables: {
          '1': shipment.clients.name,
          '2': event.container,
          '3': event.status,
          '4': event.location
        }
      });

      await supabase('notifications', {
        method: 'POST',
        body: [{
          shipment_id: shipment.id,
          client_id: shipment.client_id,
          twilio_message_sid: twilio.sid,
          recipient_phone: shipment.clients.phone,
          event_status: event.status,
          event_location: event.location,
          event_time: event.eventTime,
          delivery_status: twilio.status || 'queued',
          event_type: 'tracking',
          channel: 'whatsapp',
          status: twilio.status || 'queued',
          provider_message_id: twilio.sid,
          raw_event: payload
        }]
      });
    } catch (twilioError) {
      console.error('SHIPSGO_WHATSAPP_ERROR', twilioError);
      await logWhatsAppFailure(shipment, event, payload, twilioError);
    }

    await logWebhookEvent(event, payload, true, twilio ? null : 'Tracking actualizado; notificación WhatsApp fallida');

    return ok(res, {
      received: true,
      tracking_updated: true,
      resolved_alerts: resolvedAlerts,
      notified: Boolean(twilio),
      message_sid: twilio?.sid || null
    });
  } catch (error) {
    console.error('ShipsGo webhook error:', error);
    return fail(res, 500, 'No se pudo procesar la actualización', error.message);
  }
}
