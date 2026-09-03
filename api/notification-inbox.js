import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { reconcileAllNotifications } from './_notification-reconcile.js';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS=new Set(['mark_read','mark_unread','dismiss']);

const urlFor=req=>new URL(req.url||'/api/notification-inbox','http://localhost');
const boolValue=(value,fallback)=>value===undefined||value===null?fallback:Boolean(value);
const cleanText=(value,max=320)=>{
  if(value===null||value===undefined)return null;
  const text=String(value).trim();
  return text?text.slice(0,max):null;
};

async function rpc(name,body){return supabase(`rpc/${name}`,{method:'POST',body,prefer:'return=representation'});}

async function loadPreferences(adminId){
  const rows=await supabase('notification_preferences',{
    query:`?select=*&admin_user_id=eq.${encodeURIComponent(adminId)}&limit=1`
  });
  return rows?.[0]||{
    admin_user_id:adminId,
    in_app_enabled:true,
    task_assignments_enabled:true,
    operational_alerts_enabled:true,
    escalations_enabled:true,
    push_enabled:false,
    tracking_updates_enabled:true,
    document_updates_enabled:true,
    integration_failures_enabled:true,
    whatsapp_enabled:false,
    whatsapp_recipient:null,
    email_enabled:false,
    email_recipient:null
  };
}

async function loadFocusItem(adminId,id){
  if(!id)return null;
  const rows=await supabase('notification_inbox_workspace',{
    query:`?select=*&recipient_admin_id=eq.${encodeURIComponent(adminId)}&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  return rows?.[0]||null;
}

async function loadInbox(adminId,searchParams){
  const includeDismissed=searchParams.get('include_dismissed')==='true';
  const unreadOnly=searchParams.get('unread')==='true';
  const sourceType=String(searchParams.get('source_type')||'').trim().toLowerCase();
  const clauses=[`recipient_admin_id=eq.${encodeURIComponent(adminId)}`];
  if(!includeDismissed)clauses.push('dismissed_at=is.null');
  if(unreadOnly)clauses.push('read_at=is.null');
  if(['task','alert','system'].includes(sourceType))clauses.push(`source_type=eq.${sourceType}`);

  const rows=await supabase('notification_inbox_workspace',{
    query:`?select=*&${clauses.join('&')}&order=created_at.desc&limit=300`
  });
  const items=rows||[];
  return {
    items,
    counts:{
      total:items.length,
      unread:items.filter(item=>item.is_unread===true).length,
      task:items.filter(item=>item.source_type==='task').length,
      alert:items.filter(item=>item.source_type==='alert').length
    }
  };
}

function mapError(error){
  const raw=String(error?.message||error||'');
  const code=raw.match(/(NOTIFICATION_[A-Z0-9_]+)/)?.[1]||null;
  if(code==='NOTIFICATION_NOT_FOUND')return{status:404,message:'Notificación no encontrada'};
  if(code==='NOTIFICATION_ACTOR_INVALID')return{status:403,message:'La cuenta actual no puede modificar notificaciones'};
  if(code==='NOTIFICATION_ACTION_INVALID')return{status:400,message:'Acción de notificación no válida'};
  if(code==='NOTIFICATION_PHONE_INVALID')return{status:400,message:'El número de WhatsApp no es válido'};
  if(code==='NOTIFICATION_PHONE_REQUIRED')return{status:400,message:'Indica un número de WhatsApp para activar ese canal'};
  if(code==='NOTIFICATION_EMAIL_INVALID')return{status:400,message:'El correo no es válido'};
  if(code==='NOTIFICATION_EMAIL_REQUIRED')return{status:400,message:'Indica un correo para activar ese canal'};
  if(code==='PUSH_ACTIVE_DEVICE_REQUIRED')return{status:409,message:'Activa al menos un dispositivo antes de habilitar Web Push'};
  return null;
}

export default async function handler(req,res){
  try{
    const admin=await authorizeAdmin(req,res,'notifications.read');
    if(!admin)return;
    const url=urlFor(req);

    if(req.method==='GET'){
      const focusId=String(url.searchParams.get('notification_id')||'').trim();
      if(focusId&&!UUID_RE.test(focusId))return fail(res,400,'Identificador de notificación no válido');
      const reconciliation=await reconcileAllNotifications();
      const [inbox,preferences,focusItem]=await Promise.all([
        loadInbox(admin.admin_id,url.searchParams),
        loadPreferences(admin.admin_id),
        loadFocusItem(admin.admin_id,focusId)
      ]);
      return ok(res,{...inbox,preferences,focus_item:focusItem,reconciliation});
    }

    if(req.method==='PATCH'){
      const body=await readJson(req);
      const action=String(body.action||'').trim().toLowerCase();

      if(ACTIONS.has(action)){
        const id=String(body.id||'').trim();
        if(!UUID_RE.test(id))return fail(res,400,'Identificador de notificación no válido');
        const result=await rpc('act_on_notification_inbox',{
          p_notification_id:id,p_actor:admin.admin_id,p_action:action,p_now:new Date().toISOString()
        });
        const normalized=Array.isArray(result)?result[0]||null:result;
        await writeAudit(admin,`notification.inbox.${action}`,'notification_inbox_item',id,{});
        return ok(res,{item:normalized});
      }

      if(action==='mark_all_read'){
        const result=await rpc('mark_all_notification_inbox_read',{
          p_actor:admin.admin_id,p_now:new Date().toISOString()
        });
        const count=Array.isArray(result)?Number(result[0]||0):Number(result||0);
        await writeAudit(admin,'notification.inbox.mark_all_read','notification_inbox',null,{count});
        return ok(res,{updated:count});
      }

      if(action==='preferences'){
        const now=new Date().toISOString();
        const current=await loadPreferences(admin.admin_id);
        const result=await rpc('set_notification_preferences_v2',{
          p_actor:admin.admin_id,
          p_in_app_enabled:boolValue(body.in_app_enabled,current.in_app_enabled),
          p_task_assignments_enabled:boolValue(body.task_assignments_enabled,current.task_assignments_enabled),
          p_operational_alerts_enabled:boolValue(body.operational_alerts_enabled,current.operational_alerts_enabled),
          p_escalations_enabled:boolValue(body.escalations_enabled,current.escalations_enabled),
          p_whatsapp_enabled:boolValue(body.whatsapp_enabled,current.whatsapp_enabled),
          p_whatsapp_recipient:cleanText(body.whatsapp_recipient,32),
          p_email_enabled:boolValue(body.email_enabled,current.email_enabled),
          p_email_recipient:cleanText(body.email_recipient,320),
          p_push_enabled:boolValue(body.push_enabled,current.push_enabled),
          p_tracking_updates_enabled:boolValue(body.tracking_updates_enabled,current.tracking_updates_enabled),
          p_document_updates_enabled:boolValue(body.document_updates_enabled,current.document_updates_enabled),
          p_integration_failures_enabled:boolValue(body.integration_failures_enabled,current.integration_failures_enabled),
          p_now:now
        });
        const preferences=Array.isArray(result)?result[0]||null:result;
        await writeAudit(admin,'notification.preferences.update','admin_user',admin.admin_id,{
          in_app_enabled:preferences?.in_app_enabled,
          task_assignments_enabled:preferences?.task_assignments_enabled,
          operational_alerts_enabled:preferences?.operational_alerts_enabled,
          escalations_enabled:preferences?.escalations_enabled,
          whatsapp_enabled:preferences?.whatsapp_enabled,
          email_enabled:preferences?.email_enabled,
          push_enabled:preferences?.push_enabled,
          tracking_updates_enabled:preferences?.tracking_updates_enabled,
          document_updates_enabled:preferences?.document_updates_enabled,
          integration_failures_enabled:preferences?.integration_failures_enabled
        });
        return ok(res,{preferences});
      }

      return fail(res,400,'Acción de notificación no válida');
    }

    return fail(res,405,'Método no permitido');
  }catch(error){
    const mapped=mapError(error);
    if(mapped)return fail(res,mapped.status,mapped.message);
    console.error('NOTIFICATION_INBOX_ERROR',error);
    return fail(res,500,'No se pudo procesar el inbox de notificaciones');
  }
}
