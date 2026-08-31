import { authorizeAdmin, fail, ok, readJson, sendWhatsApp, supabase } from './_lib.js';
import { reconcileOperationLifecycle } from './_operation-lifecycle.js';
import { claimNotificationDelivery, releaseNotificationDelivery, whatsappMilestoneAllowed } from './_notification-delivery.js';
import { assertShipmentBusinessAction } from './_shipment-actions.js';

const EVENTS = {
  load: { order:1, status:'Cargado en el buque', eventType:'LOAD' },
  departed: { order:2, status:'Salió del puerto', eventType:'DEPA', templateEnv:'TWILIO_DEPARTED_CONTENT_SID', templateType:'tracking' },
  arrived: { order:3, status:'Llegó al puerto', eventType:'ARRV' },
  discharged: { order:4, status:'Descargado del buque', eventType:'DISC' },
  released: { order:5, status:'Liberado', eventType:'RELEASE', templateEnv:'TWILIO_RELEASE_CONTENT_SID', templateType:'release' },
  delivered: { order:6, status:'Entregado', eventType:'DELIVERED' }
};

const EVENT_LIST = Object.entries(EVENTS).map(([key,value]) => ({ key,...value }));
function eventForStatus(status){const normalized=String(status||'').trim().toLowerCase();return EVENT_LIST.find(event=>event.status.toLowerCase()===normalized)||null;}

async function writeHistory(shipment,event,admin,details,correctionType){
  try{const title=correctionType==='rollback'?`Corrección manual · ${event.status}`:correctionType==='same'?`Tracking ERP actualizado · ${event.status}`:`Tracking ERP · ${event.status}`;await supabase('shipment_history',{method:'POST',body:[{shipment_id:shipment.id,client_id:shipment.client_id||null,event_type:correctionType==='rollback'?`manual_correction_${event.eventType.toLowerCase()}`:`manual_${event.eventType.toLowerCase()}`,title,details,source:'admin'}]});}catch(error){console.error('ERP_TRACKING_HISTORY_FAILED',error.message);}
}
async function writeAudit(shipment,event,admin,details={},correctionType='forward'){
  try{await supabase('audit_log',{method:'POST',body:[{actor_admin_id:admin.admin_id||null,actor_username:admin.username||null,action:correctionType==='rollback'?'tracking_event_corrected':'tracking_event_confirmed',entity_type:'shipment',entity_id:shipment.id,details:{event:event.eventType,status:event.status,correction_type:correctionType,...details}}]});}catch(error){console.error('ERP_TRACKING_AUDIT_FAILED',error.message);}
}
async function logNotification(shipment,event,data={}){
  if(!shipment.client_id||!event.templateType)return;
  try{await supabase('notifications',{method:'POST',body:[{shipment_id:shipment.id,client_id:shipment.client_id,event_type:event.templateType,event_status:event.status,channel:'whatsapp',notification_scope:'message',recipient:shipment.clients?.phone||null,recipient_phone:shipment.clients?.phone||null,status:data.status||'pending',delivery_status:data.status||'pending',provider_message_id:data.sid||null,twilio_message_sid:data.sid||null,template_sid:data.templateSid||null,payload:{container_number:shipment.container_number,client_name:shipment.clients?.name||null,status:event.status,location:data.location||null,tracking_source:'erp',event_code:event.eventType,delivery_key:data.deliveryKey||null,correction_type:data.correctionType||'forward'},error_message:data.error||null,sent_at:data.sentAt||null,attempt_count:1,last_attempt_at:new Date().toISOString()}]});}catch(error){console.error('ERP_TRACKING_NOTIFICATION_LOG_FAILED',error.message);}
}
function variablesFor(event,shipment){if(event.eventType==='DEPA')return {'1':shipment.container_number};return {'1':shipment.clients?.name||'Cliente','2':shipment.container_number};}
function correctionPatch(shipment,eventKey,event,location,admin,now){
  const patch={operational_status:event.status,last_status:event.status,last_location:location,last_event_at:now,updated_at:now,active:eventKey!=='delivered'};
  if(event.order<EVENTS.discharged.order)patch.discharged_at=null;else if(eventKey==='discharged')patch.discharged_at=shipment.discharged_at||now;
  if(event.order<EVENTS.released.order){patch.released_at=null;patch.release_method=null;patch.released_by_admin_id=null;patch.released_by_username=null;patch.release_notification_status='pending';patch.release_notification_error=null;}else if(eventKey==='released'){patch.released_at=shipment.released_at||now;patch.release_method='erp_tracking';patch.released_by_admin_id=admin.admin_id||null;patch.released_by_username=admin.username||null;}
  if(event.order<EVENTS.delivered.order)patch.delivered_at=null;else if(eventKey==='delivered'){patch.active=false;patch.delivered_at=shipment.delivered_at||now;}
  return patch;
}
async function patchReleaseNotification(shipmentId,status,error=null){await supabase('shipments',{method:'PATCH',query:`?id=eq.${encodeURIComponent(shipmentId)}`,body:{release_notification_status:status,release_notification_error:error,updated_at:new Date().toISOString()}});}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,'logistics.write');if(!admin)return;if(req.method!=='PATCH')return fail(res,405,'Método no permitido');
  try{
    const body=await readJson(req),id=String(body.id||'').trim(),eventKey=String(body.event||'').trim().toLowerCase(),event=EVENTS[eventKey],location=String(body.location||'').trim()||null;
    if(!id)return fail(res,400,'Falta el identificador del contenedor');
    if(!event)return fail(res,400,'Evento de tracking no válido');
    if(body.notify_whatsapp===true&&!whatsappMilestoneAllowed(event.eventType))return fail(res,400,'Este hito no envía WhatsApp. Solo se notifican salida del puerto y liberación.');
    const notifyWhatsApp=whatsappMilestoneAllowed(event.eventType);
    const rows=await supabase('shipments',{query:`?select=*,clients(id,name,phone,active)&id=eq.${encodeURIComponent(id)}&limit=1`});
    const shipment=rows?.[0];if(!shipment)return fail(res,404,'Contenedor no encontrado');
    await assertShipmentBusinessAction(shipment.id,'manual_tracking');

    const previousStatus=shipment.last_status||shipment.operational_status||'Registrado',previousEvent=eventForStatus(previousStatus),previousOrder=previousEvent?.order||0,correctionType=previousOrder>event.order?'rollback':previousOrder===event.order?'same':'forward',now=new Date().toISOString(),patch=correctionPatch(shipment,eventKey,event,location,admin,now);
    await supabase('shipments',{method:'PATCH',query:`?id=eq.${encodeURIComponent(id)}`,body:patch});
    await reconcileOperationLifecycle(shipment.operation_id,admin,{source:`erp_tracking_${eventKey}`,shipment_id:shipment.id});
    const correctionDetail=`Estado anterior: ${previousStatus} · Estado nuevo: ${event.status}`;

    if(!notifyWhatsApp){await writeHistory(shipment,event,admin,`${correctionDetail} · Confirmado por ${admin.username||'administrador'} · Este hito no genera WhatsApp`,correctionType);await writeAudit(shipment,event,admin,{previous_status:previousStatus,notification_status:'not_applicable',notified:false,location},correctionType);return ok(res,{updated:true,event:eventKey,status:event.status,previous_status:previousStatus,correction_type:correctionType,notification_status:'not_applicable',notified:false});}
    if(!shipment.client_id||!shipment.clients?.active||!shipment.clients?.phone){const recipientError='El contenedor no tiene un cliente con WhatsApp activo';if(event.eventType==='RELEASE')await patchReleaseNotification(shipment.id,'unavailable_recipient',recipientError);await writeHistory(shipment,event,admin,`${correctionDetail} · Confirmado por ${admin.username||'administrador'} · WhatsApp no enviado: ${recipientError}`,correctionType);await writeAudit(shipment,event,admin,{previous_status:previousStatus,notification_status:'unavailable_recipient',notified:false,error:recipientError,location},correctionType);return ok(res,{updated:true,event:eventKey,status:event.status,previous_status:previousStatus,correction_type:correctionType,notification_status:'unavailable_recipient',notification_error:recipientError,notified:false});}
    const templateSid=process.env[event.templateEnv];
    if(!templateSid){const configError=`Falta ${event.templateEnv} en Vercel`;if(event.eventType==='RELEASE')await patchReleaseNotification(shipment.id,'pending',configError);await logNotification(shipment,event,{status:'pending',templateSid:null,location,error:configError,correctionType});await writeHistory(shipment,event,admin,`${correctionDetail} · Confirmado por ${admin.username||'administrador'} · WhatsApp pendiente: ${configError}`,correctionType);await writeAudit(shipment,event,admin,{previous_status:previousStatus,notification_status:'pending_template',notified:false,location},correctionType);return ok(res,{updated:true,event:eventKey,status:event.status,previous_status:previousStatus,correction_type:correctionType,notification_status:'pending_template',missing_variable:event.templateEnv,notified:false});}
    const claim=await claimNotificationDelivery(shipment.id,event.eventType,event.status,'erp_tracking');
    if(!claim.claimed){if(event.eventType==='RELEASE')await patchReleaseNotification(shipment.id,'already_notified');await writeHistory(shipment,event,admin,`${correctionDetail} · Confirmado por ${admin.username||'administrador'} · WhatsApp no reenviado: esta etapa ya había sido notificada`,correctionType);await writeAudit(shipment,event,admin,{previous_status:previousStatus,notification_status:claim.reason||'already_notified',notified:false,location},correctionType);return ok(res,{updated:true,event:eventKey,status:event.status,previous_status:previousStatus,correction_type:correctionType,notification_status:claim.reason||'already_notified',notified:false});}
    try{const sent=await sendWhatsApp({to:shipment.clients.phone,contentSid:templateSid,variables:variablesFor(event,shipment)});if(event.eventType==='RELEASE')await patchReleaseNotification(shipment.id,'sent');await logNotification(shipment,event,{status:sent.status||'queued',sid:sent.sid,templateSid,sentAt:now,location,deliveryKey:claim.deliveryKey,correctionType});await writeHistory(shipment,event,admin,`${correctionDetail} · Confirmado por ${admin.username||'administrador'} · WhatsApp: ${sent.sid}`,correctionType);await writeAudit(shipment,event,admin,{previous_status:previousStatus,notification_status:sent.status||'queued',notified:true,sid:sent.sid,delivery_key:claim.deliveryKey,location},correctionType);return ok(res,{updated:true,event:eventKey,status:event.status,previous_status:previousStatus,correction_type:correctionType,notification_status:sent.status||'queued',notified:true,sid:sent.sid});}catch(error){await releaseNotificationDelivery(shipment.id,claim.deliveryKey);if(event.eventType==='RELEASE')await patchReleaseNotification(shipment.id,'failed',error.message);await logNotification(shipment,event,{status:'failed',templateSid,location,deliveryKey:claim.deliveryKey,error:error.message,correctionType});await writeHistory(shipment,event,admin,`${correctionDetail} · Confirmado por ${admin.username||'administrador'} · Falló WhatsApp: ${error.message}`,correctionType);await writeAudit(shipment,event,admin,{previous_status:previousStatus,notification_status:'failed',notified:false,delivery_key:claim.deliveryKey,error:error.message,location},correctionType);return ok(res,{updated:true,event:eventKey,status:event.status,previous_status:previousStatus,correction_type:correctionType,notification_status:'failed',notification_error:error.message,notified:false});}
  }catch(error){console.error('ERP_TRACKING_EVENT_ERROR',error);const raw=String(error.message||'');if(raw.includes('SHIPMENT_ALREADY_DELIVERED'))return fail(res,409,'Este contenedor ya fue marcado como entregado.');return fail(res,400,'No se pudo confirmar el evento de tracking',error.message);}
}
