const crypto = require('crypto');

const config = {
  api: {
    bodyParser: false,
  },
};

const EVENT_LABELS = {
  LOAD: 'fue cargado en el buque',
  DEPA: 'salió del puerto',
  ARRV: 'llegó al puerto',
  DISC: 'fue descargado del buque',
  GTOT: 'salió de la terminal',
};

const ALLOWED_EVENTS = new Set(
  (process.env.NOTIFY_EVENT_CODES || 'LOAD,DEPA,ARRV,DISC,GTOT')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean)
);

const recentWebhookIds = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

function pruneCache() {
  const now = Date.now();
  for (const [id, timestamp] of recentWebhookIds.entries()) {
    if (now - timestamp > CACHE_TTL_MS) recentWebhookIds.delete(id);
  }
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isValidSignature(rawBody, receivedSignature, secret) {
  if (!secret || !receivedSignature) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const received = Buffer.from(receivedSignature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');

  return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

function getShipment(payload) {
  return (
    payload?.shipment ||
    payload?.data?.shipment ||
    payload?.data ||
    payload?.resource ||
    payload?.object ||
    {}
  );
}

function getContainerNumber(shipment, payload) {
  return (
    shipment?.container_number ||
    shipment?.containerNumber ||
    shipment?.containers?.[0]?.number ||
    shipment?.containers?.[0]?.container_number ||
    payload?.container_number ||
    payload?.containerNumber ||
    'sin número informado'
  );
}

function getLatestActualMovement(shipment) {
  const movements = (shipment?.containers || [])
    .flatMap((container) =>
      (container.movements || []).map((movement) => ({
        ...movement,
        containerNumber:
          container.number || container.container_number || shipment.container_number,
      }))
    )
    .filter(
      (movement) =>
        String(movement.status || '').toUpperCase() === 'ACT' &&
        ALLOWED_EVENTS.has(String(movement.event || '').toUpperCase()) &&
        movement.timestamp
    )
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  return movements[0] || null;
}

function formatDate(timestamp, timezone) {
  try {
    return new Intl.DateTimeFormat('es-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone || 'America/New_York',
    }).format(new Date(timestamp));
  } catch {
    return timestamp || new Date().toISOString();
  }
}

function buildMovementMessage(shipment, movement) {
  const eventCode = String(movement.event || '').toUpperCase();
  const eventText = EVENT_LABELS[eventCode] || `actualizó su estado (${eventCode})`;
  const container = movement.containerNumber || shipment.container_number || 'sin número';
  const location = movement.location?.name || 'ubicación no informada';
  const timezone = movement.location?.timezone;
  const vessel = movement.vessel?.name ? `\n🚢 Buque: ${movement.vessel.name}` : '';
  const voyage = movement.voyage ? `\n🧭 Viaje: ${movement.voyage}` : '';
  const booking = shipment.booking_number ? `\n📄 Booking/B/L: ${shipment.booking_number}` : '';

  return [
    '📦 *Export MCA Tracking*',
    '',
    `El contenedor *${container}* ${eventText}.`,
    `📍 Lugar: ${location}`,
    `🕒 Fecha: ${formatDate(movement.timestamp, timezone)}`,
    vessel,
    voyage,
    booking,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildFallbackMessage(eventName, shipment, payload) {
  const container = getContainerNumber(shipment, payload);
  const action = eventName?.endsWith('SHIPMENT_CREATED')
    ? 'fue agregado al sistema de seguimiento'
    : eventName?.endsWith('SHIPMENT_DELETED')
      ? 'fue eliminado del sistema de seguimiento'
      : 'recibió una actualización en ShipsGo';

  const booking = shipment?.booking_number || shipment?.bookingNumber;
  const carrier = shipment?.carrier?.name || shipment?.carrier_name || shipment?.shipping_line;

  return [
    '📦 *Export MCA Tracking*',
    '',
    `El contenedor *${container}* ${action}.`,
    booking ? `📄 Booking/B/L: ${booking}` : '',
    carrier ? `🚢 Naviera: ${carrier}` : '',
    `🕒 Recibido: ${formatDate(new Date().toISOString(), 'America/New_York')}`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function sendWhatsApp(body) {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;
  const to = process.env.WHATSAPP_TO;

  if (!accountSid || !authToken || !from || !to) {
    throw new Error('Missing Twilio environment variables');
  }

  const params = new URLSearchParams({
    From: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
    To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    Body: body,
  });

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    }
  );

  const result = await response.json();
  if (!response.ok) {
    throw new Error(`Twilio error ${response.status}: ${result.message || 'Unknown error'}`);
  }

  return result.sid;
}

async function handler(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'shipsgo-twilio-bridge', version: 2 });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const rawBody = await readRawBody(req);
    const signature = req.headers['x-shipsgo-webhook-signature'];
    const webhookId = req.headers['x-shipsgo-webhook-id'];
    const webhookName = req.headers['x-shipsgo-webhook-name'];

    if (!isValidSignature(rawBody, signature, process.env.SHIPSGO_WEBHOOK_SECRET)) {
      return res.status(401).json({ error: 'Invalid webhook signature' });
    }

    pruneCache();
    if (webhookId && recentWebhookIds.has(webhookId)) {
      return res.status(200).json({ ok: true, duplicate: true });
    }

    const payload = JSON.parse(rawBody.toString('utf8'));
    const eventName = payload?.event?.name || payload?.event_name || webhookName || '';

    const supportedEvent = [
      'OCEAN.SHIPMENTS.SHIPMENT_CREATED',
      'OCEAN.SHIPMENTS.SHIPMENT_UPDATED',
      'OCEAN.SHIPMENTS.SHIPMENT_DELETED',
    ].includes(eventName);

    if (!supportedEvent) {
      return res.status(200).json({ ok: true, ignored: eventName || 'unknown event' });
    }

    const shipment = getShipment(payload);
    const movement = getLatestActualMovement(shipment);
    const message = movement
      ? buildMovementMessage(shipment, movement)
      : buildFallbackMessage(eventName, shipment, payload);

    const twilioMessageSid = await sendWhatsApp(message);

    if (webhookId) recentWebhookIds.set(webhookId, Date.now());

    return res.status(200).json({
      ok: true,
      eventName,
      container: movement?.containerNumber || getContainerNumber(shipment, payload),
      movementEvent: movement?.event || null,
      twilioMessageSid,
    });
  } catch (error) {
    console.error('ShipsGo webhook error:', error);
    return res.status(500).json({
      error: 'Webhook processing failed',
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}

module.exports = handler;
module.exports.config = config;
