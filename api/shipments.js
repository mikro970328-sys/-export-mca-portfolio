import { fail, normalizeContainer, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';

async function history(shipment, eventType, title, details = null, source = 'admin') {
  try { await supabase('shipment_history', { method: 'POST', body: [{ shipment_id: shipment.id, client_id: shipment.client_id, event_type: eventType, title, details, source }] }); } catch {}
}
async function audit(action, shipment, details = {}) {
  try { await supabase('audit_log', { method: 'POST', body: [{ action, entity_type: 'shipment', entity_id: shipment.id, details }] }); } catch {}
}
async function logNotification(shipment, type, data = {}) {
  try {
    await supabase('notifications', { method: 'POST', body: [{ shipment_id: shipment.id, client_id: shipment.client_id, event_type: type, event_status: type, channel: 'whatsapp', recipient: shipment.clients?.phone || null, recipient_phone: shipment.clients?.phone || null, status: data.status || 'pending', delivery_status: data.status || 'pending', provider_message_id: data.sid || null, twilio_message_sid: data.sid || null, template_sid: data.template_sid || null, payload: { container_number: shipment.container_number, client_name: shipment.clients?.name || null }, error_message: data.error || null, sent_at: data.sent_at || null, attempt_count: 1, last_attempt_at: new Date().toISOString() }] });
  } catch (error) { console.error('SHIPMENT_NOTIFICATION_LOG_FAILED', error.message); }
}

async function shipsGoRequest(path, options = {}) {
  const token = process.env.SHIPSGO_API_KEY || process.env.SHIPSGO_TOKEN;
  const base = process.env.SHIPSGO_API_BASE_URL;
  if (!token || !base) throw new Error('SHIPSGO_CONFIG_MISSING');
  const response = await fetch(`${base.replace(/\/$/, '')}/${String(path).replace(/^\//, '')}`, {
    method: options.method || 'GET',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(`SHIPSGO_${response.status}:${data.message || text || 'Error de ShipsGo'}`);
  return data;
}

async function registerShipsGo(containerNumber, carrier = null) {
  const searchPath = process.env.SHIPSGO_SEARCH_PATH || `shipments?containerNumber=${encodeURIComponent(containerNumber)}`;
  try {
    const found = await shipsGoRequest(searchPath);
    const existing = found?.data?.[0] || found?.items?.[0] || found?.[0] || null;
    if (existing) return { mode: 'linked', id: existing.id || existing.trackingId || existing.referenceId || null, raw: existing };
  } catch (error) {
    if (!String(error.message).includes('404')) console.warn('SHIPSGO_LOOKUP_FAILED', error.message);
  }
  const createPath = process.env.SHIPSGO_CREATE_PATH || 'shipments';
  const created = await shipsGoRequest(createPath, { method: 'POST', body: { containerNumber, carrier: carrier || undefined } });
  const item = created?.data || created;
  return { mode: 'created', id: item?.id || item?.trackingId || item?.referenceId || null, raw: item };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const data = await supabase('shipments', { query: '?select=*,clients(id,name,company,phone,email,welcome_status)&order=created_at.desc' });
      return ok(res, { shipments: data || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body.action === 'send_test_whatsapp') {
        const to = String(body.to || '').trim();
        const container = normalizeContainer(body.container_number);
        const status = String(body.status || '').trim();
        if (!to) return fail(res, 400, 'Falta el número de destino');
        if (!status) return fail(res, 400, 'Falta el estado del envío');
        const sent = await sendWhatsApp({ to, contentSid: body.content_sid || process.env.TWILIO_CONTENT_SID, variables: { '1': container, '2': status } });
        return ok(res, { sent: true, sid: sent.sid, status: sent.status, to: sent.to });
      }

      const clientId = String(body.client_id || '').trim();
      if (!clientId) return fail(res, 400, 'Selecciona un cliente');
      const containerNumber = normalizeContainer(body.container_number);
      const duplicate = await supabase('shipments', { query: `?select=id&container_number=eq.${encodeURIComponent(containerNumber)}&limit=1` });
      if (duplicate?.length) return fail(res, 409, 'Ese número de contenedor ya está registrado');

      const created = await supabase('shipments', { method: 'POST', body: [{ client_id: clientId, container_number: containerNumber, booking_number: String(body.booking_number || '').trim() || null, bol_number: String(body.bol_number || '').trim() || null, carrier: String(body.carrier || '').trim() || null, product: String(body.product || '').trim() || null, active: true, last_status: 'Registrado', operational_status: 'Registrado', last_location: null, last_event_at: null, shipsgo_status: 'pending' }] });
      let shipment = created?.[0];
      if (shipment) {
        await history(shipment, 'created', 'Contenedor registrado', containerNumber);
        await audit('shipment_created', shipment, { container_number: containerNumber, actor: admin.username });
        try {
          const tracking = await registerShipsGo(containerNumber, shipment.carrier);
          const now = new Date().toISOString();
          await supabase('shipments', { method: 'PATCH', query: `?id=eq.${shipment.id}`, body: { shipsgo_status: 'active', shipsgo_tracking_id: tracking.id, shipsgo_link_mode: tracking.mode, shipsgo_error: null, updated_at: now } });
          await history(shipment, tracking.mode === 'linked' ? 'shipsgo_linked' : 'shipsgo_created', tracking.mode === 'linked' ? 'Tracking existente vinculado en ShipsGo' : 'Tracking creado en ShipsGo', tracking.id || null, 'shipsgo');
          await audit('shipsgo_tracking_ready', shipment, { tracking_id: tracking.id, mode: tracking.mode });
          shipment = { ...shipment, shipsgo_status: 'active', shipsgo_tracking_id: tracking.id, shipsgo_link_mode: tracking.mode };
        } catch (error) {
          await supabase('shipments', { method: 'PATCH', query: `?id=eq.${shipment.id}`, body: { shipsgo_status: 'failed', shipsgo_error: error.message, updated_at: new Date().toISOString() } });
          await history(shipment, 'shipsgo_failed', 'No se pudo activar el tracking en ShipsGo', error.message, 'shipsgo');
          await audit('shipsgo_tracking_failed', shipment, { error: error.message });
          shipment = { ...shipment, shipsgo_status: 'failed', shipsgo_error: error.message };
        }
      }
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
        const now = new Date().toISOString();
        const contentSid = process.env.TWILIO_RELEASE_CONTENT_SID;
        const basePatch = { operational_status: 'Liberado', last_status: 'Liberado', released_at: now, release_method: 'manual', released_by_admin_id: admin.admin_id || null, released_by_username: admin.username || null, updated_at: now };
        if (!contentSid) {
          await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { ...basePatch, release_notification_status: 'pending', release_notification_error: 'Plantilla pendiente de aprobación' } });
          await logNotification(shipment, 'release', { status: 'pending', error: 'Plantilla pendiente de aprobación' });
          await history(shipment, 'released', 'Contenedor liberado manualmente', `Administrador: ${admin.username || 'desconocido'} · Notificación pendiente de plantilla`);
          await audit('shipment_released_pending_notification', shipment, { actor: admin.username, method: 'manual' });
          return ok(res, { released: true, notification_status: 'pending_template' });
        }
        try {
          const sent = await sendWhatsApp({ to: shipment.clients.phone, contentSid, variables: { '1': shipment.clients.name, '2': shipment.container_number } });
          await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { ...basePatch, release_notification_status: 'sent', release_notification_error: null } });
          await logNotification(shipment, 'release', { status: sent.status || 'queued', sid: sent.sid, template_sid: contentSid, sent_at: now });
          await history(shipment, 'released', 'Contenedor liberado manualmente', `Administrador: ${admin.username || 'desconocido'} · WhatsApp: ${sent.sid}`);
          await audit('shipment_released', shipment, { sid: sent.sid, actor: admin.username, method: 'manual' });
          return ok(res, { released: true, sid: sent.sid });
        } catch (error) {
          await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { ...basePatch, release_notification_status: 'failed', release_notification_error: error.message } });
          await logNotification(shipment, 'release', { status: 'failed', error: error.message, template_sid: contentSid });
          await history(shipment, 'release_failed', 'Contenedor liberado; falló la notificación', error.message);
          await audit('shipment_released_notification_failed', shipment, { error: error.message, actor: admin.username, method: 'manual' });
          return ok(res, { released: true, notification_status: 'failed', notification_error: error.message });
        }
      }

      if (action === 'retry_shipsgo') {
        const tracking = await registerShipsGo(shipment.container_number, shipment.carrier);
        await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { shipsgo_status: 'active', shipsgo_tracking_id: tracking.id, shipsgo_link_mode: tracking.mode, shipsgo_error: null, updated_at: new Date().toISOString() } });
        await history(shipment, 'shipsgo_ready', 'Tracking de ShipsGo activado', tracking.id || null, 'shipsgo');
        return ok(res, { tracking });
      }

      if (action === 'deliver' || action === 'reactivate') {
        const active = action === 'reactivate'; const now = new Date().toISOString(); const status = active ? 'Activo' : 'Entregado';
        await supabase('shipments', { method: 'PATCH', query: `?id=eq.${id}`, body: { active, operational_status: status, last_status: status, delivered_at: active ? null : now, updated_at: now } });
        await history(shipment, active ? 'reactivated' : 'delivered', active ? 'Contenedor reactivado' : 'Contenedor entregado');
        await audit(active ? 'shipment_reactivated' : 'shipment_delivered', shipment, { actor: admin.username });
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