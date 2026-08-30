import { authorizeAdmin, fail, ok, readJson, sendWhatsApp, supabase, writeAudit } from './_lib.js';

const selectFields=[
  '*',
  'clients(id,name,company,phone,email)',
  'shipments(id,container_number,operational_status,last_status,last_location)'
].join(',');

function value(row,...keys){for(const key of keys)if(row?.[key]!==undefined&&row?.[key]!==null&&row?.[key]!=='')return row[key];return null;}
function normalizeStatus(row){return String(value(row,'status','delivery_status')||'pending').toLowerCase();}
function normalizeAlertStatus(row){if(row.notification_scope!=='operational')return null;return String(row.alert_status||(row.resolved_at?'resolved':'pending')).toLowerCase();}
function notificationType(row){return String(value(row,'event_type','event_status')||'tracking');}
function templateFor(type,row){const envMap={welcome:'TWILIO_WELCOME_CONTENT_SID',registered:'TWILIO_REGISTERED_CONTENT_SID',release:'TWILIO_RELEASE_CONTENT_SID',delivered:'TWILIO_DELIVERED_CONTENT_SID',tracking:'TWILIO_CONTENT_SID'};return value(row,'template_sid')||process.env[envMap[type]||envMap.tracking];}
function variablesFor(type,row){const client=row.clients||{},shipment=row.shipments||{},payload=row.payload||{},name=client.name||payload.client_name||'Cliente',container=shipment.container_number||payload.container_number||'No disponible';if(type==='welcome')return {'1':name};if(type==='registered'||type==='release'||type==='delivered')return {'1':name,'2':container};return {'1':name,'2':container,'3':value(row,'event_status')||payload.status||shipment.last_status||shipment.operational_status||'Actualización disponible','4':value(row,'event_location')||payload.location||shipment.last_location||'No disponible'};}

async function getNotification(id){const rows=await supabase('notifications',{query:`?select=${encodeURIComponent(selectFields)}&id=eq.${encodeURIComponent(id)}&limit=1`});return rows?.[0]||null;}
async function rpc(name,body){return supabase(`rpc/${name}`,{method:'POST',body,prefer:'return=representation'});}

async function canonicalOperationalNotifications({clientId='',shipmentId='',entityType='',entityId=''}={}){
  const clauses=[];
  if(clientId)clauses.push(`client_id=eq.${encodeURIComponent(clientId)}`);
  if(shipmentId)clauses.push(`shipment_id=eq.${encodeURIComponent(shipmentId)}`);
  if(entityType)clauses.push(`entity_type=eq.${encodeURIComponent(entityType)}`);
  if(entityId)clauses.push(`entity_id=eq.${encodeURIComponent(entityId)}`);
  const registry=await supabase('operational_alert_conditions',{query:`?select=notification_id,condition_active,condition_opened_at,condition_closed_at,condition_cycle_count,last_evaluated_at${clauses.length?`&${clauses.join('&')}`:''}&order=updated_at.desc&limit=2000`});
  const conditionById=new Map((registry||[]).map(row=>[String(row.notification_id),row]));
  const ids=[...conditionById.keys()];if(!ids.length)return[];
  const chunks=[];for(let i=0;i<ids.length;i+=100)chunks.push(ids.slice(i,i+100));
  const pages=await Promise.all(chunks.map(group=>supabase('notifications',{query:`?select=${encodeURIComponent(selectFields)}&id=in.(${group.join(',')})&order=created_at.desc&limit=100`})));
  return pages.flat().map(row=>({...row,...conditionById.get(String(row.id))})).sort((a,b)=>new Date(b.created_at||0)-new Date(a.created_at||0));
}

async function updateOperationalNotification(admin,row,action,body){
  if(row.notification_scope!=='operational')return{error:'Esta acción solo aplica a alertas operativas',status:400};
  const now=new Date().toISOString();let snoozedUntil=null;
  if(action==='snooze'){
    const hours=Math.max(1,Math.min(168,Number(body.hours||24)));
    if(!Number.isFinite(hours))return{error:'Cantidad de horas no válida',status:400};
    snoozedUntil=new Date(Date.now()+hours*60*60*1000).toISOString();
  }
  try{
    const result=await rpc('act_on_operational_alert',{p_notification_id:row.id,p_actor:admin.admin_id,p_action:action,p_reason:body.reason||null,p_snoozed_until:snoozedUntil,p_now:now});
    const normalized=Array.isArray(result)?result[0]||null:result;
    const refreshed=await getNotification(row.id);
    const auditAction={mark_read:'operational_notification_read',resolve:'operational_notification_resolved',snooze:'operational_notification_snoozed',reopen:'operational_notification_reopened'}[action];
    await writeAudit(admin,auditAction,'notification',row.id,{event_type:notificationType(row),entity_type:row.entity_type,entity_id:row.entity_id,result:normalized,reason:body.reason||null,snoozed_until:snoozedUntil});
    return{notification:refreshed||row,result:normalized};
  }catch(error){
    const raw=String(error?.message||error||'');
    if(raw.includes('ALERT_CONDITION_CLOSED'))return{error:'La condición que originó esta alerta ya no está activa.',status:400};
    if(raw.includes('ALERT_NOT_CANONICAL'))return{error:'Esta alerta pertenece al historial legacy y ya no admite acciones.',status:400};
    if(raw.includes('ALERT_ACTOR_INVALID'))return{error:'La cuenta actual no puede modificar alertas.',status:403};
    throw error;
  }
}

export default async function handler(req,res){
  try{
    const mode=String(req.query?.mode||'').trim().toLowerCase();let notificationPatchBody=null;let permission;
    if(mode==='notifications'){
      if(req.method==='PATCH'){notificationPatchBody=await readJson(req);const action=String(notificationPatchBody.action||'').trim().toLowerCase();permission=action==='mark_read'?'notifications.read':'notifications.manage';}
      else permission='notifications.read';
    }else if(String(req.query?.shipment_id||'').trim())permission='logistics.read';
    else if(String(req.query?.client_id||'').trim())permission='clients.read';
    else permission='administration.audit.read';

    const admin=await authorizeAdmin(req,res,permission);if(!admin)return;

    if(mode==='notifications'){
      if(req.method==='GET'){
        const status=String(req.query?.status||'').trim().toLowerCase(),alertStatus=String(req.query?.alert_status||'').trim().toLowerCase(),scope=String(req.query?.scope||'').trim().toLowerCase(),clientId=String(req.query?.client_id||'').trim(),shipmentId=String(req.query?.shipment_id||'').trim(),entityType=String(req.query?.entity_type||'').trim().toLowerCase(),entityId=String(req.query?.entity_id||'').trim();
        let rows;
        if(scope==='operational'){
          rows=await canonicalOperationalNotifications({clientId,shipmentId,entityType,entityId});
        }else{
          const clauses=[];if(clientId)clauses.push(`client_id=eq.${encodeURIComponent(clientId)}`);if(shipmentId)clauses.push(`shipment_id=eq.${encodeURIComponent(shipmentId)}`);if(scope)clauses.push(`notification_scope=eq.${encodeURIComponent(scope)}`);if(alertStatus)clauses.push(`alert_status=eq.${encodeURIComponent(alertStatus)}`);if(entityType)clauses.push(`entity_type=eq.${encodeURIComponent(entityType)}`);if(entityId)clauses.push(`entity_id=eq.${encodeURIComponent(entityId)}`);
          rows=await supabase('notifications',{query:`?select=${encodeURIComponent(selectFields)}${clauses.length?`&${clauses.join('&')}`:''}&order=created_at.desc&limit=300`});
        }
        rows=(rows||[]).map(row=>({...row,normalized_status:normalizeStatus(row),normalized_alert_status:normalizeAlertStatus(row),notification_type:notificationType(row)}));
        if(alertStatus)rows=rows.filter(row=>row.normalized_alert_status===alertStatus);
        if(status)rows=rows.filter(row=>row.normalized_status===status);
        return ok(res,{notifications:rows.slice(0,300)});
      }

      if(req.method==='PATCH'){
        const body=notificationPatchBody||{},id=String(body.id||'').trim(),action=String(body.action||'').trim().toLowerCase();if(!id)return fail(res,400,'Falta el identificador de la notificación');
        const row=await getNotification(id);if(!row)return fail(res,404,'Notificación no encontrada');
        if(['mark_read','resolve','snooze','reopen'].includes(action)){const result=await updateOperationalNotification(admin,row,action,body);if(result.error)return fail(res,result.status||400,result.error);return ok(res,result);}
        if(action!=='retry')return fail(res,400,'Acción no válida');
        if(row.notification_scope==='operational')return fail(res,400,'Las alertas operativas no se reenvían por WhatsApp');

        const client=row.clients||{},type=notificationType(row),to=value(row,'recipient','recipient_phone')||client.phone;if(!to)return fail(res,400,'La notificación no tiene destinatario');
        const contentSid=templateFor(type,row);if(!contentSid)return fail(res,400,`Falta configurar la plantilla para ${type}`);
        const attempt=Number(row.attempt_count||0)+1,retryAt=new Date().toISOString();
        try{
          const sent=await sendWhatsApp({to,contentSid,variables:variablesFor(type,row)});const patch={status:sent.status||'queued',delivery_status:sent.status||'queued',provider_message_id:sent.sid,twilio_message_sid:sent.sid,error_message:null,attempt_count:attempt,last_attempt_at:retryAt,sent_at:retryAt,updated_at:retryAt};
          await supabase('notifications',{method:'PATCH',query:`?id=eq.${encodeURIComponent(id)}`,body:patch});await writeAudit(admin,'notification_retry_sent','notification',id,{type,sid:sent.sid,attempt});return ok(res,{retried:true,sid:sent.sid,status:sent.status||'queued'});
        }catch(error){await supabase('notifications',{method:'PATCH',query:`?id=eq.${encodeURIComponent(id)}`,body:{status:'failed',delivery_status:'failed',error_message:error.message,attempt_count:attempt,last_attempt_at:retryAt,updated_at:retryAt}});await writeAudit(admin,'notification_retry_failed','notification',id,{type,error:error.message,attempt});return fail(res,400,'No se pudo reenviar la notificación',error.message);}
      }
      return fail(res,405,'Método no permitido');
    }

    if(req.method!=='GET')return fail(res,405,'Método no permitido');
    const shipmentId=String(req.query?.shipment_id||'').trim(),clientId=String(req.query?.client_id||'').trim();if(!shipmentId&&!clientId)return fail(res,400,'Indica shipment_id o client_id');
    const filter=shipmentId?`shipment_id=eq.${encodeURIComponent(shipmentId)}`:`client_id=eq.${encodeURIComponent(clientId)}`;
    const tasks=[supabase('shipment_history',{query:`?select=*&${filter}&order=created_at.desc&limit=200`}),supabase('notifications',{query:`?select=*&${filter}&order=created_at.desc&limit=200`})];if(clientId)tasks.push(supabase('audit_log',{query:`?select=*&entity_type=eq.client&entity_id=eq.${encodeURIComponent(clientId)}&order=created_at.desc&limit=200`}));
    const [events,notifications,auditEvents=[]]=await Promise.all(tasks);return ok(res,{events:events||[],notifications:notifications||[],audit_events:auditEvents||[]});
  }catch(error){console.error('HISTORY_API_ERROR',error);return fail(res,400,'No se pudo procesar la solicitud',error.message);}
}
