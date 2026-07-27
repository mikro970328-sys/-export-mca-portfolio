import { fail, ok, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
  try {
    const body = req.body || {};
    const sid = body.MessageSid || body.SmsSid;
    const status = body.MessageStatus || body.SmsStatus;
    if (sid && status) {
      await supabase(`notifications?twilio_message_sid=eq.${encodeURIComponent(sid)}`, {
        method: 'PATCH',
        body: {
          delivery_status: status,
          error_code: body.ErrorCode || null,
          error_message: body.ErrorMessage || null,
          updated_at: new Date().toISOString()
        }
      });
    }
    return ok(res, { received: true });
  } catch (error) {
    console.error(error);
    return ok(res, { received: true });
  }
}
