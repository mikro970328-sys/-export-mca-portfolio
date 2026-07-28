import { fail, normalizeContainer, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';

async function history(shipment, eventType, title, details = null, source = 'admin') {
  try { await supabase('shipment_history', { method: 'POST', body: [{ shipment_id: shipment.id, client_id: shipment.client_id, event_type: eventType, title, details, source }] }); } catch {}
}
async function audit(action, shipment, details = {}) {
  try { await supabase('audit_log', { method: 'POST', body: [{ action, entity_type: 'shipment', entity_id: shipment.id, details }] }); } catch {}
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const data = await supabase('shipments', { query: '?select=*,clients(id,name,company,phone,email,welcome_status)&order=created_at.desc' });
      return ok(res, { shipments: data || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const clientId = String(body.client_id || '').trim();
      if (!clientId) return fail(res, 400, 'Selecciona un cliente');
      const containerNumber = normalizeContainer(body.container_number);
      const duplicate = await supabase('shipments', { query: `?select=id&container_number=eq.${encodeURIComponent(containerNumber)}&limit=1` });
      if (duplicate?.length) return fail(res, 409, 'Ese número de contenedor ya está registrado');
      const created = await supabase('shipments', { method: 'POST', body: [{ client_id: clientId, container_number: containerNumber, booking_number: String(body.booking_number || '').trim() || null, bol_number: String(body.bol_number || '').trim() || null, carrier: String(body.carrier || '').trim() || null, product: String(body.product || '').trim() || null, active: true, last_status: 'Registrado', operational_status: 'Registrado', last_location: null, last_event_at: null }] });
      const shipment = created?.[0];
      if (shipment) { await history(shipment, 'created', 'Contenedor registrado', containerNumber); await audit('shipment_created', shipment, { container_number: containerNumber }); }
      return ok(res, { shipment });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador del contenedor');
      const rows = await supabase('shipments', { query: `?select=*,clients(id,name,phone)&id=eq.${encodeURIComponent(id)}&limit=1` });
      const shipment = rows?.[0];
      if (!shipment) return fail(res, 404, 'Contenedor no encontrado');
      const action = body.action || 'edit';

      if (action === 'release') {
        if (shipment.released_at) return fail(res, 409, 'Este contenedor ya fue marcado como liberado');
        const contentSid = process.env.TWILIO_RELEASE_CONTENT_SID;
        if (!contentSid) return fail(res, 400, 'Falta configurar TWILIO_RELEASE_CONTENT_SID en Vercel');
        try {
          const sent = await sendWhatsApp({ to: shipment.clients.phone, contentSid, variables: { '1': shipment.clients.name, '2': shipment.container_number } });
          const now = new Date().toISOString();
          await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { operational_status: 'Liberado', last_status: 'Liberado', released_at: now, release_notification_status: 'sent', release_notification_error: null, updated_at: now } });
          await history(shipment, 'released', 'Contenedor liberado', `WhatsApp enviado: ${sent.sid}`);
          await audit('shipment_released', shipment, { sid: sent.sid });
          return ok(res, { released: true, sid: sent.sid });
        } catch (error) {
          await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { release_notification_status: 'failed', release_notification_error: error.message, updated_at: new Date().toISOString() } });
          await history(shipment, 'release_failed', 'Falló la notificación de liberación', error.message);
          return fail(res, 400, 'No se pudo enviar la liberación', error.message);
        }
      }

      if (action === 'deliver' || action === 'reactivate') {
        const active = action === 'reactivate'; const now = new Date().toISOString();
        const status = active ? 'Activo' : 'Entregado';
        await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { active, operational_status: status, last_status: status, delivered_at: active ? null : now, updated_at: now } });
        await history(shipment, active ? 'reactivated' : 'delivered', active ? 'Contenedor reactivado' : 'Contenedor entregado');
        await audit(active ? 'shipment_reactivated' : 'shipment_delivered', shipment);
        return ok(res, { active, status });
      }

      const patch = { updated_at: new Date().toISOString() };
      if (body.client_id !== undefined) patch.client_id = String(body.client_id).trim();
      if (body.container_number !== undefined) {
        const number = normalizeContainer(body.container_number);
        const duplicate = await supabase('shipments', { query: `?select=id&container_number=eq.${encodeURIComponent(number)}&id=neq.${encodeURIComponent(id)}&limit=1` });
        if (duplicate?.length) return fail(res, 409, 'Ese número de contenedor ya está registrado');
        patch.container_number = number;
      }
      for (const field of ['booking_number','bol_number','carrier','product']) if (body[field] !== undefined) patch[field] = String(body[field]).trim() || null;
      if (body.operational_status !== undefined) { patch.operational_status = String(body.operational_status).trim(); patch.last_status = patch.operational_status; }
      const updated = await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}&select=*`, body: patch });
      await history(shipment, 'updated', 'Datos del contenedor actualizados', JSON.stringify(patch));
      await audit('shipment_updated', shipment, patch);
      return ok(res, { shipment: updated?.[0] || { ...shipment, ...patch } });
    }
    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    const message = error.message === 'CONTAINER_INVALID' ? 'Número de contenedor inválido. Debe tener 4 letras y 7 números.' : error.message;
    return fail(res, 400, message);
  }
}