import { authorizeAdmin, fail, ok, readJson, sendWhatsApp, supabase } from './_lib.js';
import { reconcileOperationLifecycle } from './_operation-lifecycle.js';
import { claimNotificationDelivery, releaseNotificationDelivery } from './_notification-delivery.js';
import { assertShipmentBusinessAction, loadShipmentActionCapabilityMap, loadShipmentActionCapabilities } from './_shipment-actions.js';

const cleanText = value => String(value ?? '').trim() || null;
const cleanClientId = value => cleanText(value);
const isIsoContainer = value => /^[A-Z]{4}\d{7}$/.test(String(value || '').trim().toUpperCase());
const normalizeShipmentReference = value => {
  const cleaned = String(value ?? '').trim().toUpperCase().replace(/\s+/g,' ');
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

async function history(shipment,eventType,title,details=null,source='admin') {
  try {
    await supabase('shipment_history', {
      method:'POST',
      body:[{ shipment_id:shipment.id,client_id:shipment.client_id || null,event_type:eventType,title,details,source }]
    });
  } catch (error) {
    console.error('SHIPMENT_HISTORY_FAILED',error.message);
  }
}

async function audit(action,shipment,details={}) {
  try {
    await supabase('audit_log',{ method:'POST',body:[{ action,entity_type:'shipment',entity_id:shipment.id,details }] });
  } catch (error) {
    console.error('SHIPMENT_AUDIT_FAILED',error.message);
  }
}

async function logNotification(shipment,type,data={}) {
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
        notification_scope:'message',
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
          event_code:data.event_code || null,
          delivery_key:data.delivery_key || null,
          tracking_source:'erp'
        },
        error_message:data.error || null,
        sent_at:data.sent_at || null,
        attempt_count:1,
        last_attempt_at:new Date().toISOString()
      }]
    });
  } catch (error) {
    console.error('SHIPMENT_NOTIFICATION_LOG_FAILED',error.message);
  }
}

async function releaseShipment(shipment,admin) {
  const now = new Date().toISOString();
  const basePatch = {
    operational_status:'Liberado',
    last_status:'Liberado',
    released_at:now,
    release_method:'manual',
    released_by_admin_id:admin.admin_id || null,
    released_by_username:admin.username || null,
    updated_at:now
  };

  if (!shipment.client_id || !shipment.clients?.active || !shipment.clients?.phone) {
    await supabase('shipments',{ method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{ ...basePatch,release_notification_status:'not_requested',release_notification_error:null } });
    await history(shipment,'released','Contenedor liberado manualmente',`Administrador: ${admin.username || 'desconocido'} · Sin cliente; WhatsApp omitido`);
    await audit('shipment_released_without_client',shipment,{ actor:admin.username,method:'manual' });
    return { released:true,notification_status:'not_requested' };
  }

  const contentSid = process.env.TWILIO_RELEASE_CONTENT_SID;
  if (!contentSid) {
    await supabase('shipments',{ method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{ ...basePatch,release_notification_status:'pending',release_notification_error:'Plantilla pendiente de configuración' } });
    await logNotification(shipment,'release',{ status:'pending',error:'Plantilla pendiente de configuración',event_code:'RELEASE' });
    await history(shipment,'released','Contenedor liberado manualmente',`Administrador: ${admin.username || 'desconocido'} · Notificación pendiente de plantilla`);
    await audit('shipment_released_pending_notification',shipment,{ actor:admin.username,method:'manual' });
    return { released:true,notification_status:'pending_template' };
  }

  const claim = await claimNotificationDelivery(shipment.id,'RELEASE','Liberado','shipment_release');
  if (!claim.claimed) {
    await supabase('shipments',{ method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{ ...basePatch,release_notification_status:'already_notified',release_notification_error:null } });
    await history(shipment,'released','Contenedor liberado manualmente',`Administrador: ${admin.username || 'desconocido'} · WhatsApp ya notificado anteriormente`);
    await audit('shipment_released_without_duplicate_notification',shipment,{ actor:admin.username,method:'manual',delivery_key:claim.deliveryKey });
    return { released:true,notification_status:'already_notified' };
  }

  try {
    const sent = await sendWhatsApp({ to:shipment.clients.phone,contentSid,variables:{ '1':shipment.clients.name || 'Cliente','2':shipment.container_number } });
    await supabase('shipments',{ method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{ ...basePatch,release_notification_status:'sent',release_notification_error:null } });
    await logNotification(shipment,'release',{ status:sent.status || 'queued',sid:sent.sid,template_sid:contentSid,sent_at:now,event_code:'RELEASE',delivery_key:claim.deliveryKey });
    await history(shipment,'released','Contenedor liberado manualmente',`Administrador: ${admin.username || 'desconocido'} · WhatsApp: ${sent.sid}`);
    await audit('shipment_released',shipment,{ sid:sent.sid,actor:admin.username,method:'manual',delivery_key:claim.deliveryKey });
    return { released:true,sid:sent.sid,notification_status:sent.status || 'queued' };
  } catch (error) {
    await releaseNotificationDelivery(shipment.id,claim.deliveryKey);
    await supabase('shipments',{ method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{ ...basePatch,release_notification_status:'failed',release_notification_error:error.message } });
    await logNotification(shipment,'release',{ status:'failed',error:error.message,template_sid:contentSid,event_code:'RELEASE',delivery_key:claim.deliveryKey });
    await history(shipment,'release_failed','Contenedor liberado; falló la notificación',error.message);
    await audit('shipment_released_notification_failed',shipment,{ error:error.message,actor:admin.username,method:'manual',delivery_key:claim.deliveryKey });
    return { released:true,notification_status:'failed',notification_error:error.message };
  }
}

function translatedError(error) {
  const raw=String(error?.message||error||'Error');
  const map=[
    ['SHIPMENT_ALREADY_DELIVERED','Este contenedor ya fue marcado como entregado.'],
    ['SHIPMENT_NOT_DELIVERED','Este contenedor no está entregado y no puede reactivarse.'],
    ['SHIPMENT_ALREADY_RELEASED','Este contenedor ya fue marcado como liberado.'],
    ['SHIPMENT_ALREADY_HAS_CLIENT','Este contenedor ya tiene un cliente asignado.'],
    ['SHIPMENT_LINKED_TO_LOAD','No se puede eliminar este contenedor porque está vinculado a un Cargue.'],
    ['SHIPMENT_ACTION_NOT_ALLOWED','Esta acción no está permitida para el contenedor.'],
    ['SHIPMENT_ACTION_INVALID','Acción de contenedor no válida.'],
    ['CONTAINER_REFERENCE_INVALID','La referencia del contenedor no es válida. Usa letras/números y, si necesitas, espacios, guion, punto, slash o underscore.']
  ];
  return map.find(([key])=>raw.includes(key))?.[1]||raw;
}

export default async function handler(req,res) {
  const admin = await authorizeAdmin(req,res,req.method === 'GET' ? 'logistics.read' : 'logistics.write');
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const [data,capabilityBundle] = await Promise.all([
        supabase('shipments',{ query:'?select=*,clients(id,name,company,phone,email,welcome_status,active)&order=created_at.desc' }),
        loadShipmentActionCapabilityMap(admin)
      ]);
      const shipments=(data||[]).map(shipment=>({
        ...shipment,
        capabilities:capabilityBundle.map.get(String(shipment.id))||{actions:{}}
      }));
      return ok(res,{ shipments,write_access:capabilityBundle.write_access });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return fail(res,400,'Falta el identificador del contenedor');
      const rows = await supabase('shipments',{ query:`?select=id,client_id,container_number&id=eq.${encodeURIComponent(id)}&limit=1` });
      const shipment = rows?.[0];
      if (!shipment) return fail(res,404,'Contenedor no encontrado');
      await assertShipmentBusinessAction(shipment.id,'delete');

      await supabase('notifications',{ method:'DELETE',query:`?shipment_id=eq.${encodeURIComponent(id)}` });
      await supabase('shipment_history',{ method:'DELETE',query:`?shipment_id=eq.${encodeURIComponent(id)}` });
      const deleted = await supabase('shipments',{ method:'DELETE',query:`?id=eq.${encodeURIComponent(id)}&select=id,container_number` });
      if (!deleted?.length) return fail(res,404,'Contenedor no encontrado');
      await audit('shipment_deleted',shipment,{ container_number:shipment.container_number,actor:admin.username,deletion_scope:'erp_only' });
      return ok(res,{ deleted:true,shipment:deleted[0] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      if (body.action === 'send_test_whatsapp') return fail(res,410,'El envío manual arbitrario de WhatsApp fue retirado.');

      const clientId = cleanClientId(body.client_id);
      const containerNumber = normalizeShipmentReference(body.container_number);
      const quantity = cleanQuantity(body.quantity);
      const departureDate = cleanDate(body.departure_date);
      const duplicate = await supabase('shipments',{ query:`?select=id&container_number=eq.${encodeURIComponent(containerNumber)}&active=eq.true&limit=1` });
      if (duplicate?.length) return fail(res,409,'Esa referencia de contenedor ya tiene una operación activa');

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
          last_event_at:null
        }]
      });

      const shipment = created?.[0];
      if (shipment) {
        await history(shipment,clientId ? 'created' : 'created_unassigned',clientId ? 'Contenedor registrado' : 'Contenedor registrado sin cliente',clientId ? containerNumber : `${containerNumber} · Sin cliente`);
        await audit('shipment_created',shipment,{ container_number:containerNumber,client_id:clientId,unassigned:!clientId,provisional:!isIsoContainer(containerNumber),tracking_source:'erp',actor:admin.username });
        if (!isIsoContainer(containerNumber)) await history(shipment,'tracking_reference_provisional','Referencia provisional de contenedor','El seguimiento continuará dentro del ERP hasta registrar el número definitivo.');
        shipment.capabilities=await loadShipmentActionCapabilities(admin,shipment.id);
      }
      return ok(res,{ shipment });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return fail(res,400,'Falta el identificador del contenedor');
      const rows = await supabase('shipments',{ query:`?select=*,clients(id,name,phone,active)&id=eq.${encodeURIComponent(id)}&limit=1` });
      const shipment = rows?.[0];
      if (!shipment) return fail(res,404,'Contenedor no encontrado');
      const action = body.action || 'edit';

      if (action === 'manual_notification') return fail(res,410,'Las notificaciones manuales arbitrarias fueron retiradas. Usa los hitos de salida o liberación.');
      if (action === 'retry_shipsgo') return fail(res,410,'ShipsGo fue retirado de la plataforma.');

      if (action === 'release') {
        await assertShipmentBusinessAction(shipment.id,'release');
        const result = await releaseShipment(shipment,admin);
        await reconcileOperationLifecycle(shipment.operation_id,admin,{ source:'shipment_released',shipment_id:shipment.id });
        return ok(res,result);
      }

      if (action === 'deliver' || action === 'reactivate') {
        await assertShipmentBusinessAction(shipment.id,action);
        const active = action === 'reactivate';
        const now = new Date().toISOString();
        const status = active ? 'Activo' : 'Entregado';
        await supabase('shipments',{ method:'PATCH',query:`?id=eq.${encodeURIComponent(id)}`,body:{ active,operational_status:status,last_status:status,delivered_at:active ? null : now,updated_at:now } });
        await history(shipment,active ? 'reactivated' : 'delivered',active ? 'Contenedor reactivado' : 'Contenedor entregado');
        await audit(active ? 'shipment_reactivated' : 'shipment_delivered',shipment,{ actor:admin.username });
        await reconcileOperationLifecycle(shipment.operation_id,admin,{ source:active ? 'shipment_reactivated' : 'shipment_delivered',shipment_id:shipment.id });
        return ok(res,{ active,status });
      }

      const assigningClient=shipment.client_id===null && body.client_id!==undefined && cleanClientId(body.client_id)!==null;
      await assertShipmentBusinessAction(shipment.id,assigningClient?'assign_client':'edit');

      const patch = { updated_at:new Date().toISOString() };
      if (body.client_id !== undefined) patch.client_id = cleanClientId(body.client_id);
      let changedReference = null;
      if (body.container_number !== undefined) {
        const reference = normalizeShipmentReference(body.container_number);
        const duplicate = await supabase('shipments',{ query:`?select=id&container_number=eq.${encodeURIComponent(reference)}&active=eq.true&id=neq.${encodeURIComponent(id)}&limit=1` });
        if (duplicate?.length) return fail(res,409,'Esa referencia de contenedor ya tiene una operación activa');
        patch.container_number = reference;
        changedReference = reference !== shipment.container_number ? reference : null;
      }
      for (const field of ['booking_number','bol_number','carrier','product','quantity_unit']) if (body[field] !== undefined) patch[field] = cleanText(body[field]);
      if (body.quantity !== undefined) patch.quantity = cleanQuantity(body.quantity);
      if (body.departure_date !== undefined) patch.departure_date = cleanDate(body.departure_date);
      if (body.operational_status !== undefined) {
        patch.operational_status = String(body.operational_status).trim();
        patch.last_status = patch.operational_status;
      }

      const clientChanged = Object.prototype.hasOwnProperty.call(patch,'client_id') && patch.client_id !== shipment.client_id;
      const updated = await supabase('shipments',{ method:'PATCH',query:`?id=eq.${encodeURIComponent(id)}&select=*`,body:patch });
      const resultShipment = updated?.[0] || { ...shipment,...patch };

      if (clientChanged) {
        const assigned = Boolean(patch.client_id);
        await history({ ...shipment,client_id:patch.client_id },assigned ? 'client_assigned' : 'client_unassigned',assigned ? 'Cliente asignado al contenedor' : 'Cliente removido del contenedor',assigned ? `Cliente: ${patch.client_id} · Asignado por ${admin.username || 'administrador'}` : `Sin cliente · Cambio por ${admin.username || 'administrador'}`);
        await audit(assigned ? 'shipment_client_assigned' : 'shipment_client_unassigned',shipment,{ previous_client_id:shipment.client_id || null,client_id:patch.client_id || null,actor:admin.username });
      }

      if (changedReference && !isIsoContainer(changedReference)) {
        await history(resultShipment,'tracking_reference_provisional','Referencia provisional de contenedor','El seguimiento continuará dentro del ERP hasta registrar el número definitivo.');
      }

      await history(shipment,'updated','Datos del contenedor actualizados',JSON.stringify(patch));
      await audit('shipment_updated',shipment,patch);
      resultShipment.capabilities=await loadShipmentActionCapabilities(admin,resultShipment.id);
      return ok(res,{ shipment:resultShipment });
    }

    return fail(res,405,'Método no permitido');
  } catch (error) {
    console.error('[shipments]',error);
    const message=translatedError(error);
    const status=String(error?.message||'').includes('SHIPMENT_LINKED_TO_LOAD')?409:400;
    return fail(res,status,message);
  }
}
