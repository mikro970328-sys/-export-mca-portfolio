import { fail, ok, readJson, requireAdmin, sendWhatsApp, writeAudit } from './_lib.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');

  try {
    const body = await readJson(req);
    const to = String(body.to || '').trim();
    const container = String(body.container || '').trim().toUpperCase();
    const status = String(body.status || '').trim();

    if (!to) return fail(res, 400, 'Falta el número de destino');
    if (!container) return fail(res, 400, 'Falta el número de contenedor');
    if (!status) return fail(res, 400, 'Falta el estado del envío');

    const sent = await sendWhatsApp({
      to,
      contentSid: body.content_sid || process.env.TWILIO_CONTENT_SID,
      variables: {
        '1': container,
        '2': status
      }
    });

    await writeAudit(admin, 'send', 'whatsapp_message', sent.sid, {
      to,
      container,
      status,
      content_sid: body.content_sid || process.env.TWILIO_CONTENT_SID,
      message_status: sent.status
    });

    return ok(res, {
      sent: true,
      sid: sent.sid,
      status: sent.status,
      to: sent.to
    });
  } catch (error) {
    console.error('WHATSAPP_SEND_ERROR', error);
    return fail(res, 400, 'No se pudo enviar el WhatsApp', error.message);
  }
}
