import { fail, normalizePhone, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const data = await supabase('clients', { query: '?select=*&order=created_at.desc' });
      return ok(res, { clients: data || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      if (!name) return fail(res, 400, 'El nombre del cliente es obligatorio');
      const phone = normalizePhone(body.phone);
      const created = await supabase('clients', {
        method: 'POST',
        body: [{
          name,
          company: String(body.company || '').trim() || null,
          phone,
          email: String(body.email || '').trim() || null,
          active: true
        }]
      });

      let welcome = { status: 'pending_config' };
      const welcomeContentSid = process.env.TWILIO_WELCOME_CONTENT_SID;
      if (welcomeContentSid) {
        try {
          const sent = await sendWhatsApp({
            to: phone,
            contentSid: welcomeContentSid,
            variables: { '1': name }
          });
          welcome = { status: 'sent', sid: sent.sid };
        } catch (error) {
          welcome = { status: 'failed', error: error.message };
        }
      }

      return ok(res, { client: created?.[0], welcome });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador del cliente');

      const deleted = await supabase('clients', {
        method: 'DELETE',
        query: `?id=eq.${encodeURIComponent(id)}&select=id,name`
      });

      if (!deleted?.length) return fail(res, 404, 'Cliente no encontrado');
      return ok(res, { deleted: true, client: deleted[0] });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    const message = error.message === 'PHONE_INVALID'
      ? 'Número de WhatsApp inválido. Usa formato internacional, por ejemplo +5351234567.'
      : error.message;
    return fail(res, 400, message);
  }
}
