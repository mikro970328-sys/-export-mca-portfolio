import { fail, normalizePhone, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';

async function audit(action, entityId, details = {}) {
  try { await supabase('audit_log', { method: 'POST', body: [{ action, entity_type: 'client', entity_id: entityId, details }] }); } catch {}
}

async function sendWelcome(client) {
  const contentSid = process.env.TWILIO_WELCOME_CONTENT_SID;
  if (!contentSid) {
    await supabase('clients', { method: 'PATCH', query: `?id=eq.${client.id}`, body: { welcome_status: 'pending', welcome_error: 'Plantilla no configurada', updated_at: new Date().toISOString() } });
    return { status: 'pending_config' };
  }
  try {
    const sent = await sendWhatsApp({ to: client.phone, contentSid, variables: { '1': client.name } });
    await supabase('clients', { method: 'PATCH', query: `?id=eq.${client.id}`, body: { welcome_status: 'sent', welcome_sent_at: new Date().toISOString(), welcome_error: null, updated_at: new Date().toISOString() } });
    await audit('welcome_sent', client.id, { sid: sent.sid });
    return { status: 'sent', sid: sent.sid };
  } catch (error) {
    await supabase('clients', { method: 'PATCH', query: `?id=eq.${client.id}`, body: { welcome_status: 'failed', welcome_error: error.message, updated_at: new Date().toISOString() } });
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