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

function getLatestActualMovement(shipment) {
  const movements = (shipment?.containers || [])
    .flatMap((container) =>
      (container.movements || []).map((movement) => ({
        ...movement,
        containerNumber: container.number || shipment.container_number,
      }))
    )
    .filter(
      (movement) =>
        movement.status === 'ACT' &&
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
    return timestamp;
  }
}

function buildMessage(shipment, movement) {
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
    return res.status(200).json({ ok: true, service: 'shipsgo-twilio-bridge' });
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
    const eventName = payload?.event?.name || webhookName;

    if (eventName !== 'OCEAN.SHIPMENTS.SHIPMENT_UPDATED') {
      return res.status(200).json({ ok: true, ignored: eventName || 'unknown event' });
    }

    const shipment = payload.shipment;
    const movement = getLatestActualMovement(shipment);

    if (!movement) {
      return res.status(200).json({ ok: true, ignored: 'No supported actual movement' });
    }

    const message = buildMessage(shipment, movement);
    const twilioMessageSid = await sendWhatsApp(message);

    if (webhookId) recentWebhookIds.set(webhookId, Date.now());

    return res.status(200).json({
      ok: true,
      container: movement.containerNumber,
      event: movement.event,
      twilioMessageSid,
    });
  } catch (error) {
    console.error('ShipsGo webhook error:', error);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }
}

module.exports = handler;
module.exports.config = config;
