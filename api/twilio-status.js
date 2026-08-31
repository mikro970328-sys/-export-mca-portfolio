import { fail, ok, supabase } from './_lib.js';
import { parseTwilioFormBody, readRawBody, validateTwilioRequest } from './_twilio-webhook.js';

export const config = { api: { bodyParser: false } };

function callbackUrl() {
  const value = String(process.env.TWILIO_STATUS_CALLBACK_URL || '').trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');

  const authToken = String(process.env.TWILIO_AUTH_TOKEN || '').trim();
  const expectedAccountSid = String(process.env.TWILIO_ACCOUNT_SID || '').trim();
  const expectedUrl = callbackUrl();
  if (!authToken || !expectedUrl) {
    console.error('TWILIO_STATUS_VALIDATION_CONFIG_MISSING');
    return fail(res, 503, 'Webhook no disponible');
  }

  try {
    const rawBody = await readRawBody(req);
    const params = parseTwilioFormBody(rawBody);
    const signature = req.headers['x-twilio-signature'];

    if (!validateTwilioRequest({ authToken, signature, callbackUrl: expectedUrl, params })) {
      return fail(res, 403, 'Firma Twilio inválida');
    }

    if (expectedAccountSid && params.AccountSid && params.AccountSid !== expectedAccountSid) {
      return fail(res, 403, 'Cuenta Twilio inválida');
    }

    const sid = String(params.MessageSid || params.SmsSid || '').trim();
    const status = String(params.MessageStatus || params.SmsStatus || '').trim();
    if (!sid || !status) return fail(res, 400, 'Callback Twilio incompleto');

    const result = await supabase('rpc/reconcile_twilio_delivery_status', {
      method: 'POST',
      body: {
        p_message_sid: sid,
        p_status: status,
        p_error_code: params.ErrorCode || null,
        p_error_message: params.ErrorMessage || null,
        p_now: new Date().toISOString()
      },
      prefer: 'return=representation'
    });
    const row = Array.isArray(result) ? result[0] || null : result;

    return ok(res, {
      received: true,
      matched: Boolean(row?.matched),
      applied: Boolean(row?.applied),
      previous_status: row?.previous_status || null,
      current_status: row?.current_status || status
    });
  } catch (error) {
    console.error('TWILIO_STATUS_CALLBACK_ERROR', error.message);
    return fail(res, 500, 'No se pudo procesar el callback Twilio');
  }
}
