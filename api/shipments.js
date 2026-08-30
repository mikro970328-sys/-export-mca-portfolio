import { authorizeAdmin, fail, ok, readJson, sendWhatsApp, supabase } from './_lib.js';
import { reconcileOperationLifecycle } from './_operation-lifecycle.js';
import { deleteShipsGoTracking, registerShipsGo } from './_shipsgo.js';

const cleanText = value => String(value ?? '').trim() || null;
const cleanClientId = value => cleanText(value);
const isIsoContainer = value => /^[A-Z]{4}\d{7}$/.test(String(value || '').trim().toUpperCase());
const normalizeShipmentReference = value => {
  const cleaned = String(value ?? '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!cleaned || cleaned.length > 40 || !/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(cleaned)) throw new Error('CONTAINER_REFERENCE_INVALID');
  return cleaned;
};

function cleanQuantity(value) {
  if (value === undefined) return undefined;
  if (value === null || String(value).trim() === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('Cantidad inválida');
  return parsed;
}

function cleanDate(value) {
  if (value === undefined) return undefined;
  const text = cleanText(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error('Fecha de salida inválida');
  return text;
}

async function history(shipment, eventType, title, details = null, source = 'admin') {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{ shipment_id:shipment.id, client_id:shipment.client_id || null, event_type:eventType, title, details, source }]
    });
  } catch (error) {
    console.error('SHIPMENT_HISTORY_FAILED', error.message);
  }
}

async function audit(action, shipment, details = {}) {
  try {
    await supabase('audit_log', { method:'POST', body:[{ action, entity_type:'shipment', entity_id:shipment.id, details }] });
  } catch (error) {
    console.error('SHIPMENT_AUDIT_FAILED', error.message);
  }
}

async function logNotification(shipment, type, data = {}) {
  if (!shipment.client_id) return;
  try {
    await supabase('notifications', {
      method:'POST',
      body:[{
        shipment_id:shipment.id,
        client_id:shipment.client_id,
        event_type:type,
        event_status:type,
        channel:'whatsapp',
        recipient:shipment.clients?.phone || null,
        recipient_phone:shipment.clients?.phone || null,
        status:data.status || 'pending',
        delivery_status:data.status || 'pending',
        provider_message_id:data.sid || null,
        twilio_message_sid:data.sid || null,
        template_sid:data.template_sid || null,
        payload:{
          container_number:shipment.container_number,
          client_name:shipment.clients?.name || null,
          status:data.payload?.status || shipment.last_status || shipment.operational_status || null,
          location:data.payload?.location || shipment.last_location || null,
          manual_test:Boolean(data.payload?.manual_test)
        },
        error_message:data.error || null,
        sent_at:data.sent_at || null,
        attempt_count:1,
        last_attempt_at:new Date().toISOString()
      }]
    });
  } catch (error) {
    console.error('SHIPMENT_NOTIFICATION_LOG_FAILED', error.message);
  }
}

function templateConfig(type, shipment, body = {}) {
  const name = shipment.clients?.name || 'Cliente';
  const container = shipment.container_number || 'No disponible';
  const status = String(body.status || shipment.last_status || shipment.operational_status || 'En tránsito').trim();
  const map = {
    welcome:{ sid:process.env.TWILIO_WELCOME_CONTENT_SID, label:'Bienvenida', variables:{ '1':name } },
    registered:{ sid:process.env.TWILIO_REGISTERED_CONTENT_SID, label:'Contenedor registrado', variables:{ '1':name, '2':container } },
    tracking:{ sid:process.env.TWILIO_CONTENT_SID, label:'Actualización de tracking', variables:{ '1':container, '2':status } },
    release:{ sid:process.env.TWILIO_RELEASE_CONTENT_SID, label:'Mercancía disponible', variables:{ '1':name, '2':container } },
    delivered:{ sid:process.env.TWILIO_DELIVERED_CONTENT_SID, label:'Mercancía entregada', variables:{ '1':name, '2':container } }
  };
  return map[type] || null;
}

async function activateTracking(shipment, actor = null) {
  if (!isIsoContainer(shipment.container_number)) {
    await supabase('shipments', { method:'PATCH', query:`?id=eq.${encodeURIComponent(shipment.id)}`, body:{ shipsgo_status:'manual', shipsgo_error:null, updated_at:new Date().toISOString() } });
    return { ...shipment, shipsgo_status:'manual', shipsgo_error:null };
  }
  try {
    const tracking = await registerShipsGo(shipment.container_number, shipment.shipsgo_tracking_id || null);
    const trackingId = tracking.id || shipment.shipsgo_tracking_id || null;
    await supabase('shipments', { method:'PATCH', query:`?id=eq.${encodeURIComponent(shipment.id)}`, body:{ shipsgo_status:'active', shipsgo_tracking_id:trackingId, shipsgo_link_mode:tracking.mode, shipsgo_error:null, updated_at:new Date().toISOString() } });
    await history(shipment, tracking.mode === 'created' ? 'shipsgo_created' : 'shipsgo_linked', tracking.mode === 'created' ? 'Tracking creado en ShipsGo' : 'Tracking existente vinculado en ShipsGo', trackingId || null, 'shipsgo');
    await audit('shipsgo_tracking_ready', shipment, { tracking_id:trackingId, mode:tracking.mode, actor });
    return { ...shipment, shipsgo_status:'active', shipsgo_tracking_id:trackingId, shipsgo_link_mode:tracking.mode, shipsgo_error:null };
  } catch (error) {
    await supabase('shipments', { method:'PATCH', query:`?id=eq.${encodeURIComponent(shipment.id)}`, body:{ shipsgo_status:'failed', shipsgo_error:error.message, updated_at:new Date().toISOString() } });
    await history(shipment, 'shipsgo_failed', 'No se pudo activar el tracking en ShipsGo', error.message, 'shipsgo');
    await audit('shipsgo_tracking_failed', shipment, { error:error.message, actor });
    return { ...shipment, shipsgo_status:'failed', shipsgo_error:error.message };
  }
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, req.method === 'GET' ? 'logistics.read' : 'logistics.write');
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const data = await supabase('shipments', { query:'?select=*,clients(id,name,company,phone,email,welcome_status,active)&order=created_at.desc' });
      return ok(res, { shipments:data || [] });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador del contenedor');
      const rows = await supabase('shipments', { query:`?select=id,client_id,container_number,shipsgo_tracking_id&id=eq.${encodeURIComponent(id)}&limit=1` });
      const shipment = rows?.[0];
      if (!shipment) return fail(res, 404, 'Contenedor no encontrado');

      let shipsgoResult;
      try {
        shipsgoResult = await deleteShipsGoTracking(shipment);
      } catch (error) {
        await audit('shipment_delete_blocked_shipsgo', shipment, { container_number:shipment.container_number, shipsgo_tracking_id:shipment.shipsgo_tracking_id || null, actor:admin.username, error:error.message });
        return fail(res, 502, 'No se pudo borrar el tracking en ShipsGo. El contenedor no fue eliminado del ERP.', error.message);
      }

      await audit('shipment_deleted', shipment, { container_number:shipment.container_number, shipsgo_tracking_id:shipsgoResult.tracking_id || shipment.shipsgo_tracking_id || null, shipsgo_deleted:shipsgoResult.deleted, actor:admin.username, deletion_scope:'erp_and_shipsgo' });
      await supabase('notifications', { method:'DELETE', query:`?shipment_id=eq.${encodeURIComponent(id)}` });
      await supabase('shipment_history', { method:'DELETE', query:`?shipment_id=eq.${encodeURIComponent(id)}` });
      const deleted = await supabase('shipments', { method:'DELETE', query:`?id=eq.${encodeURIComponent(id)}&select=id,container_number` });
      if (!deleted?.length) return fail(res, 404, 'Contenedor no encontrado');
      return ok(res, { deleted:true, shipment:deleted[0], shipsgo_deleted:shipsgoResult.deleted, shipsgo_tracking_id:shipsgoResult.tracking_id || null, shipsgo_reason:shipsgoResult.reason || null });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body.action === 'send_test_whatsapp') {
        const notificationAdmin = await authorizeAdmin(req, res, 'notifications.manage');
        if (!notificationAdmin) return;
        const to = String(body.to || '').trim();
        const container = normalizeShipmentReference(body.container_number);
        const status = String(body.status || '').trim();
        if (!to) return fail(res, 400, 'Falta el número de destino');
        if (!status) return fail(res, 400, 'Falta el estado del envío');
        const sent = await sendWhatsApp({ to, contentSid:body.content_sid || process.env.TWILIO_CONTENT_SID, variables:{ '1':container, '2':status } });
        return ok(res, { sent:true, sid:sent.sid, status:sent.status, to:sent.to });
      }

      const clientId = cleanClientId(body.client_id);
      const containerNumber = normalizeShipmentReference(body.container_number);
      const quantity = cleanQuantity(body.quantity);
      const departureDate = cleanDate(body.departure_date);
      const duplicate = await supabase('shipments', { query:`?select=id&container_number=eq.${encodeURIComponent(containerNumber)}&active=eq.true&limit=1` });
      if (duplicate?.length) return fail(res, 409, 'Esa referencia de contenedor ya tiene una operación activa');

      const created = await supabase('shipments', {
        method:'POST',
        body:[{
          client_id:clientId,
          container_number:containerNumber,
          booking_number:cleanText(body.booking_number),
          bol_number:cleanText(body.bol_number),
          carrier:cleanText(body.carrier),
          product:cleanText(body.product),
          quantity:quantity === undefined ? null : quantity,
          quantity_unit:cleanText(body.quantity_unit),
          departure_date:departureDate === undefined ? null : departureDate,
          active:true,
          last_status:'Registrado',
          operational_status:'Registrado',
          last_location:null,
          last_event_at:null,
          shipsgo_status:isIsoContainer(containerNumber) ? 'pending' : 'manual'
        }]
      });

      let shipment = created?.[0];
      if (shipment) {
        await history(shipment, clientId ? 'created' : 'created_unassigned', clientId ? 'Contenedor registrado' : 'Contenedor registrado sin cliente', clientId ? containerNumber : `${containerNumber} · Sin cliente`);
        await audit('shipment_created', shipment, { container_number:containerNumber, client_id:clientId, unassigned:!clientId, provisional:!isIsoContainer(containerNumber), actor:admin.username });
        shipment = await activateTracking(shipment, admin.username);
        if (!isIsoContainer(containerNumber)) await history(shipment, 'tracking_manual_reference', 'Referencia provisional de contenedor', 'Tracking automático pendiente de número ISO real.');
      }
      return ok(res, { shipment });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador del contenedor');
      const rows = await supabase('shipments', { query:`?select=*,clients(id,name,phone,active)&id=eq.${encodeURIComponent(id)}&limit=1` });
      const shipment = rows?.[0];
      if (!shipment) return fail(res, 404, 'Contenedor no encontrado');
      const action = body.action || 'edit';

      if (action === 'manual_notification') {
        const notificationAdmin = await authorizeAdmin(req, res, 'notifications.manage');
        if (!notificationAdmin) return;
        const type = String(body.notification_type || '').trim().toLowerCase();
        const config = templateConfig(type, shipment, body);
        if (!config) return fail(res, 400, 'Tipo de plantilla no válido');
        if (!shipment.client_id || !shipment.clients?.phone) return fail(res, 400, 'El contenedor no tiene un cliente con WhatsApp válido');
        if (!config.sid) return fail(res, 400, `Falta configurar la plantilla ${type} en Vercel`);
        const now = new Date().toISOString();
        try {
          const sent = await sendWhatsApp({ to:shipment.clients.phone, contentSid:config.sid, variables:config.variables });
          await logNotification(shipment, type, { status:sent.status || 'queued', sid:sent.sid, template_sid:config.sid, sent_at:now, payload:{ status:body.status, location:body.location, manual_test:true } });
          await history(shipment, `whatsapp_${type}`, `WhatsApp manual · ${config.label}`, `SID: ${sent.sid} · Estado: ${sent.status || 'queued'}`, 'whatsapp');
          await audit('manual_whatsapp_template_sent', shipment, { type, sid:sent.sid, actor:admin.username, test_mode:true });
          return ok(res, { sent:true, type, label:config.label, sid:sent.sid, status:sent.status || 'queued' });
        } catch (error) {
          await logNotification(shipment, type, { status:'failed', error:error.message, template_sid:config.sid, payload:{ status:body.status, location:body.location, manual_test:true } });
          await history(shipment, `whatsapp_${type}_failed`, `Falló WhatsApp manual · ${config.label}`, error.message, 'whatsapp');
          await audit('manual_whatsapp_template_failed', shipment, { type, error:error.message, actor:admin.username, test_mode:true });
          return fail(res, 400, `No se pudo enviar ${config.label}`, error.message);
        }
      }

      if (action === 'release') {
        if (shipment.released_at) return fail(res, 409, 'Este contenedor ya fue marcado como liberado');
        const now = new Date().toISOString();
        const basePatch = { operational_status:'Liberado', last_status:'Liberado', released_at:now, release_method:'manual', released_by_admin_id:admin.admin_id || null, released_by_username:admin.username || null, updated_at:now };
        if (!shipment.client_id || !shipment.clients?.active || !shipment.clients?.phone) {
          await supabase('shipments', { method:'PATCH', query:`?id=eq.${id}`, body:{ ...basePatch, release_notification_status:'not_requested', release_notification_error:null } });
          await history(shipment, 'released', 'Contenedor liberado manualmente', `Administrador: ${admin.username || 'desconocido'} · Sin cliente; WhatsApp omitido`);
          await audit('shipment_released_without_client', shipment, { actor:admin.username, method:'manual' });
          return ok(res, { released:true, notification_status:'not_requested' });
        }
        const contentSid = process.env.TWILIO_RELEASE_CONTENT_SID;
        if (!contentSid) {
          await supabase('shipments', { method:'PATCH', query:`?id=eq.${id}`, body:{ ...basePatch, release_notification_status:'pending', release_notification_error:'Plantilla pendiente de aprobación' } });
          await logNotification(shipment, 'release', { status:'pending', error:'Plantilla pendiente de aprobación' });
          await history(shipment, 'released', 'Contenedor liberado manualmente', `Administrador: ${admin.username || 'desconocido'} · Notificación pendiente de plantilla`);
          await audit('shipment_released_pending_notification', shipment, { actor:admin.username, method:'manual' });
          return ok(res, { released:true, notification_status:'pending_template' });
        }
        try {
          const sent = await sendWhatsApp({ to:shipment.clients.phone, contentSid, variables:{ '1':shipment.clients.name, '2':shipment.container_number } });
          await supabase('shipments', { method:'PATCH', query:`?id=eq.${id}`, body:{ ...basePatch, release_notification_status:'sent', release_notification_error:null } });
          await logNotification(shipment, 'release', { status:sent.status || 'queued', sid:sent.sid, template_sid:contentSid, sent_at:now });
          await history(shipment, 'released', 'Contenedor liberado manualmente', `Administrador: ${admin.username || 'desconocido'} · WhatsApp: ${sent.sid}`);
          await audit('shipment_released', shipment, { sid:sent.sid, actor:admin.username, method:'manual' });
          return ok(res, { released:true, sid:sent.sid });
        } catch (error) {
          await supabase('shipments', { method:'PATCH', query:`?id=eq.${id}`, body:{ ...basePatch, release_notification_status:'failed', release_notification_error:error.message } });
          await logNotification(shipment, 'release', { status:'failed', error:error.message, template_sid:contentSid });
          await history(shipment, 'release_failed', 'Contenedor liberado; falló la notificación', error.message);
          await audit('shipment_released_notification_failed', shipment, { error:error.message, actor:admin.username, method:'manual' });
          return ok(res, { released:true, notification_status:'failed', notification_error:error.message });
        }
      }

      if (action === 'retry_shipsgo') {
        if (!isIsoContainer(shipment.container_number)) return fail(res, 400, 'El tracking automático requiere un número ISO de 4 letras y 7 números. La referencia provisional puede seguir en modo manual.');
        const trackingShipment = await activateTracking(shipment, admin.username);
        if (trackingShipment.shipsgo_status === 'failed') return fail(res, 400, 'No se pudo activar ShipsGo', trackingShipment.shipsgo_error);
        return ok(res, { tracking:{ id:trackingShipment.shipsgo_tracking_id, mode:trackingShipment.shipsgo_link_mode } });
      }

      if (action === 'deliver' || action === 'reactivate') {
        const active = action === 'reactivate';
        const now = new Date().toISOString();
        const status = active ? 'Activo' : 'Entregado';
        await supabase('shipments', { method:'PATCH', query:`?id=eq.${id}`, body:{ active, operational_status:status, last_status:status, delivered_at:active ? null : now, updated_at:now } });
        await history(shipment, active ? 'reactivated' : 'delivered', active ? 'Contenedor reactivado' : 'Contenedor entregado');
        await audit(active ? 'shipment_reactivated' : 'shipment_delivered', shipment, { actor:admin.username });
        await reconcileOperationLifecycle(shipment.operation_id, admin, { source:active ? 'shipment_reactivated' : 'shipment_delivered', shipment_id:shipment.id });
        return ok(res, { active, status });
      }

      const patch = { updated_at:new Date().toISOString() };
      if (body.client_id !== undefined) patch.client_id = cleanClientId(body.client_id);
      let changedReference = null;
      if (body.container_number !== undefined) {
        const reference = normalizeShipmentReference(body.container_number);
        const duplicate = await supabase('shipments', { query:`?select=id&container_number=eq.${encodeURIComponent(reference)}&active=eq.true&id=neq.${encodeURIComponent(id)}&limit=1` });
        if (duplicate?.length) return fail(res, 409, 'Esa referencia de contenedor ya tiene una operación activa');
        patch.container_number = reference;
        changedReference = reference !== shipment.container_number ? reference : null;
        if (changedReference && !shipment.shipsgo_tracking_id) {
          patch.shipsgo_status = isIsoContainer(reference) ? 'pending' : 'manual';
          patch.shipsgo_error = null;
        }
      }
      for (const field of ['booking_number','bol_number','carrier','product','quantity_unit']) if (body[field] !== undefined) patch[field] = cleanText(body[field]);
      if (body.quantity !== undefined) patch.quantity = cleanQuantity(body.quantity);
      if (body.departure_date !== undefined) patch.departure_date = cleanDate(body.departure_date);
      if (body.operational_status !== undefined) {
        patch.operational_status = String(body.operational_status).trim();
        patch.last_status = patch.operational_status;
      }

      const clientChanged = Object.prototype.hasOwnProperty.call(patch, 'client_id') && patch.client_id !== shipment.client_id;
      const updated = await supabase('shipments', { method:'PATCH', query:`?id=eq.${id}&select=*`, body:patch });
      let resultShipment = updated?.[0] || { ...shipment, ...patch };

      if (clientChanged) {
        const assigned = Boolean(patch.client_id);
        await history({ ...shipment, client_id:patch.client_id }, assigned ? 'client_assigned' : 'client_unassigned', assigned ? 'Cliente asignado al contenedor' : 'Cliente removido del contenedor', assigned ? `Cliente: ${patch.client_id} · Asignado por ${admin.username || 'administrador'}` : `Sin cliente · Cambio por ${admin.username || 'administrador'}`);
        await audit(assigned ? 'shipment_client_assigned' : 'shipment_client_unassigned', shipment, { previous_client_id:shipment.client_id || null, client_id:patch.client_id || null, actor:admin.username });
      }

      if (changedReference && !shipment.shipsgo_tracking_id && isIsoContainer(changedReference)) {
        resultShipment = await activateTracking(resultShipment, admin.username);
      } else if (changedReference && !isIsoContainer(changedReference)) {
        await history(resultShipment, 'tracking_manual_reference', 'Referencia provisional de contenedor', 'Tracking automático pendiente de número ISO real.');
      }

      await history(shipment, 'updated', 'Datos del contenedor actualizados', JSON.stringify(patch));
      await audit('shipment_updated', shipment, patch);
      return ok(res, { shipment:resultShipment });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    const message = error.message === 'CONTAINER_REFERENCE_INVALID'
      ? 'La referencia del contenedor no es válida. Usa letras/números y, si necesitas, espacios, guion, punto, slash o underscore.'
      : error.message;
    return fail(res, 400, message);
  }
}