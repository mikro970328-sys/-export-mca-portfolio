import { fail, normalizePhone, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';

async function audit(action, entityId, details = {}) {
  try { await supabase('audit_log', { method: 'POST', body: [{ action, entity_type: 'client', entity_id: entityId, details }] }); } catch {}
}

async function persistWelcomeNotification(client, data = {}) {
  try {
    await supabase('notifications', {
      method: 'POST',
      body: [{
        client_id: client.id,
        shipment_id: null,
        event_type: 'welcome',
        event_status: 'welcome',
        channel: 'whatsapp',
        recipient: client.phone,
        recipient_phone: client.phone,
        status: data.status || 'pending',
        delivery_status: data.status || 'pending',
        provider_message_id: data.sid || null,
        twilio_message_sid: data.sid || null,
        template_sid: data.template_sid || null,
        payload: { client_name: client.name },
        error_message: data.error || null,
        sent_at: data.sent_at || null,
        attempt_count: Number(data.attempt_count || 1),
        last_attempt_at: new Date().toISOString()
      }]
    });
  } catch (error) {
    console.error('WELCOME_NOTIFICATION_LOG_FAILED', error.message);
  }
}

async function sendWelcome(client) {
  const contentSid = process.env.TWILIO_WELCOME_CONTENT_SID;
  if (!contentSid) {
    const error = 'Plantilla no configurada';
    await supabase('clients', { method: 'PATCH', query: `?id=eq.${client.id}`, body: { welcome_status: 'pending', welcome_error: error, updated_at: new Date().toISOString() } });
    await persistWelcomeNotification(client, { status: 'pending', error });
    await audit('welcome_pending_config', client.id, { error });
    return { status: 'pending_config', error };
  }
  try {
    const sent = await sendWhatsApp({ to: client.phone, contentSid, variables: { '1': client.name } });
    const now = new Date().toISOString();
    await supabase('clients', { method: 'PATCH', query: `?id=eq.${client.id}`, body: { welcome_status: 'sent', welcome_sent_at: now, welcome_error: null, updated_at: now } });
    await persistWelcomeNotification(client, { status: sent.status || 'queued', sid: sent.sid, template_sid: contentSid, sent_at: now });
    await audit('welcome_sent', client.id, { sid: sent.sid });
    return { status: 'sent', sid: sent.sid };
  } catch (error) {
    await supabase('clients', { method: 'PATCH', query: `?id=eq.${client.id}`, body: { welcome_status: 'failed', welcome_error: error.message, updated_at: new Date().toISOString() } });
    await persistWelcomeNotification(client, { status: 'failed', error: error.message, template_sid: contentSid });
    await audit('welcome_failed', client.id, { error: error.message });
    return { status: 'failed', error: error.message };
  }
}

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
      const created = await supabase('clients', { method: 'POST', body: [{ name, company: String(body.company || '').trim() || null, phone, email: String(body.email || '').trim() || null, active: true, welcome_status: 'pending' }] });
      const client = created?.[0];
      await audit('client_created', client?.id, { name, phone });
      const welcome = client ? await sendWelcome(client) : { status: 'failed' };
      return ok(res, { client, welcome });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador del cliente');
      const rows = await supabase('clients', { query: `?select=*&id=eq.${encodeURIComponent(id)}&limit=1` });
      const current = rows?.[0];
      if (!current) return fail(res, 404, 'Cliente no encontrado');
      if (body.action === 'resend_welcome') return ok(res, { welcome: await sendWelcome(current) });
      const patch = { updated_at: new Date().toISOString() };
      if (body.name !== undefined) { patch.name = String(body.name).trim(); if (!patch.name) return fail(res, 400, 'El nombre es obligatorio'); }
      if (body.company !== undefined) patch.company = String(body.company).trim() || null;
      if (body.phone !== undefined) patch.phone = normalizePhone(body.phone);
      if (body.email !== undefined) patch.email = String(body.email).trim() || null;
      const updated = await supabase('clients', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}&select=*`, body: patch });
      await audit('client_updated', id, patch);
      return ok(res, { client: updated?.[0] || { ...current, ...patch } });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador del cliente');
      const deleted = await supabase('clients', { method: 'DELETE', query: `?id=eq.${encodeURIComponent(id)}&select=id,name` });
      if (!deleted?.length) return fail(res, 404, 'Cliente no encontrado');
      await audit('client_deleted', id, { name: deleted[0].name });
      return ok(res, { deleted: true, client: deleted[0] });
    }
    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    const message = error.message === 'PHONE_INVALID' ? 'Número de WhatsApp inválido. Usa formato internacional, por ejemplo +5351234567.' : error.message;
    return fail(res, 400, message);
  }
}
