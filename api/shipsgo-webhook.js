import crypto from 'node:crypto';
import { fail, normalizeContainer, ok, sendWhatsApp, supabase } from './_lib.js';
import { claimNotificationDelivery, ingestShipsGoObservation, releaseNotificationDelivery, resolveTrackingStaleCondition, trackingDeliveryKey } from './_integration-events.js';

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
  const providerShipment = payload?.shipment || payload?.data?.shipment || payload?.data || payload?.resource || payload?.object || {};
  const containers = providerShipment?.containers || [];
  const movements = containers.flatMap(container =>
    (container.movements || []).map(movement => ({
      ...movement,
      containerNumber: container.number || container.container_number || providerShipment.container_number
    }))
  );

  const movement = movements
    .filter(item => String(item.status || '').toUpperCase() === 'ACT' && item.timestamp)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];

  const container = normalizeContainer(
    movement?.containerNumber || providerShipment.container_number || providerShipment.containerNumber || containers?.[0]?.number
  );
  const code = String(movement?.event || '').toUpperCase();
  const status = EVENT_LABELS[code] || movement?.event_description || movement?.description || 'Nueva actualización del embarque';
  const location = movement?.location?.name || movement?.location || providerShipment?.current_location || 'No disponible';
  const eventTime = movement?.timestamp || new Date().toISOString();
  const trackingId = providerShipment?.id || providerShipment?.shipment_id || providerShipment?.tracking_id || null;
  return { providerShipment, movement, container, code, status, location, eventTime, trackingId };
}

async function writeTrackingHistory(shipment, event, details, source = 'shipsgo') {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{
        shipment_id: shipment.id,
        client_id: shipment.client_id || null,
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

async function logWebhookEvent(event, payload, processed, errorMessage = null, trace = {}) {
  await supabase('webhook_events', {
    method: 'POST',
    body: [{
      container_number: event.container,
      event_type: event.status,
      payload,
      processed,
      error_message: errorMessage,
      provider: 'shipsgo',
      provider_event_key: trace.eventKey || null,
      observation_id: trace.observationId || null
    }]
  });
}

async function logWhatsAppFailure(shipment, event, payload, error, observationId = null) {
  if (!shipment.client_id || !shipment.clients?.phone) return;
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
        notification_scope: 'message',
        status: 'failed',
        error_message: error.message,
        raw_event: payload,
        payload: {
          container_number: event.container,
          client_name: shipment.clients.name,
          status: event.status,
          location: event.location,
          event_code: event.code || null,
          provider: 'shipsgo',
          provider_observation_id: observationId
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
  if (req.method === 'GET') return ok(res, { ok: true, service: 'export-mca-shipsgo-webhook', version: 10 });
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
    if (!event.movement?.timestamp) {
      await logWebhookEvent(event, payload, false, 'Webhook de sincronización sin movimiento activo');
      return ok(res, { received: true, tracking_updated: false, notified: false, reason: 'no_active_movement' });
    }

    const rows = await supabase('shipments', {
      query: `?select=*,clients(id,name,phone,active)&container_number=eq.${encodeURIComponent(event.container)}&active=eq.true&limit=1`
    });
    const shipment = rows?.[0];

    if (!shipment) {
      await logWebhookEvent(event, payload, false, 'No hay contenedor activo asociado');
      return ok(res, { received: true, tracking_updated: false, notified: false, reason: 'shipment_not_found' });
    }

    const observation = await ingestShipsGoObservation({ shipment, event, payload });
    const trace = { eventKey: observation.eventKey, observationId: observation.observation_id || null };

    if (observation.action === 'duplicate') {
      await logWebhookEvent(event, payload, true, 'Evento ShipsGo ya ingerido', trace);
      return ok(res, { received: true, tracking_updated: false, notified: false, reason: 'duplicate_event', observation_id: trace.observationId });
    }

    if (observation.action === 'stale') {
      await logWebhookEvent(event, payload, false, 'Evento anterior o igual al último evento del proveedor', trace);
      await writeTrackingHistory(shipment, event, `Observación ignorada por antigüedad · ${event.eventTime}`, 'shipsgo');
      return ok(res, { received: true, tracking_updated: false, notified: false, reason: 'stale_event', observation_id: trace.observationId });
    }

    if (observation.action === 'observed_manual') {
      await logWebhookEvent(event, payload, true, 'Observación conservada; tracking manual mantiene autoridad ERP', trace);
      await writeTrackingHistory(shipment, event, `Observado por ShipsGo durante modo manual · ${event.location} · ${event.eventTime}`, 'shipsgo');
      return ok(res, { received: true, tracking_updated: false, provider_observed: true, notified: false, reason: 'manual_mode', observation_id: trace.observationId });
    }

    await writeTrackingHistory(shipment, event, `${event.location} · ${event.eventTime} · Observación ${trace.observationId}`, 'shipsgo');
    const alertResult = await resolveTrackingStaleCondition(shipment, 'tracking_updated', new Date().toISOString());
    const resolvedAlerts = alertResult && ['auto_resolved','condition_closed'].includes(alertResult.action) ? 1 : 0;

    if (!trackingDeliveryKey(event.code)) {
      await logWebhookEvent(event, payload, true, 'Tracking actualizado; milestone externo no habilitado para WhatsApp', trace);
      return ok(res, {
        received: true,
        tracking_updated: true,
        operational_status_changed: false,
        resolved_alerts: resolvedAlerts,
        notified: false,
        reason: 'unmapped_milestone',
        observation_id: trace.observationId
      });
    }

    if (!shipment.client_id || !shipment.clients?.active || !shipment.clients?.phone) {
      await logWebhookEvent(event, payload, true, 'Tracking actualizado sin cliente activo; WhatsApp omitido', trace);
      return ok(res, {
        received: true,
        tracking_updated: true,
        operational_status_changed: false,
        resolved_alerts: resolvedAlerts,
        notified: false,
        reason: 'no_active_client',
        observation_id: trace.observationId
      });
    }

    const claim = await claimNotificationDelivery(shipment.id, event.code, event.status, 'shipsgo');
    if (!claim.claimed) {
      await logWebhookEvent(event, payload, true, 'Milestone ya notificado previamente', trace);
      await writeTrackingHistory(shipment, event, 'Tracking actualizado sin reenviar WhatsApp · Milestone ya notificado', 'shipsgo');
      return ok(res, {
        received: true,
        tracking_updated: true,
        operational_status_changed: false,
        resolved_alerts: resolvedAlerts,
        notified: false,
        reason: claim.reason || 'already_notified',
        observation_id: trace.observationId
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
          notification_scope: 'message',
          status: twilio.status || 'queued',
          provider_message_id: twilio.sid,
          raw_event: payload,
          payload: {
            provider: 'shipsgo',
            event_code: event.code,
            delivery_key: claim.deliveryKey,
            provider_event_key: observation.eventKey,
            provider_observation_id: trace.observationId,
            container_number: event.container,
            client_name: shipment.clients.name,
            status: event.status,
            location: event.location
          }
        }]
      });
    } catch (twilioError) {
      console.error('SHIPSGO_WHATSAPP_ERROR', twilioError);
      await releaseNotificationDelivery(shipment.id, claim.deliveryKey);
      await logWhatsAppFailure(shipment, event, payload, twilioError, trace.observationId);
    }

    await logWebhookEvent(event, payload, true, twilio ? null : 'Tracking actualizado; notificación WhatsApp fallida', trace);
    return ok(res, {
      received: true,
      tracking_updated: true,
      operational_status_changed: false,
      resolved_alerts: resolvedAlerts,
      notified: Boolean(twilio),
      message_sid: twilio?.sid || null,
      observation_id: trace.observationId
    });
  } catch (error) {
    console.error('ShipsGo webhook error:', error);
    return fail(res, 500, 'No se pudo procesar la actualización', error.message);
  }
}
