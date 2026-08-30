import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';
import { DAY, alertKey, validDate, elapsedDays, loadConditionMap, reconcileAlert, closeCondition, changedAction } from './_alert-lifecycle.js';

const WARNING_AFTER=3*DAY;
const CRITICAL_AFTER=5*DAY;
const EVENT_TYPE='shipment_manual_tracking_stale';

function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret)&&req.headers.authorization===`Bearer ${secret}`;}

async function runCheck(){
  const now=new Date().toISOString(),nowMs=Date.now();
  const [shipments,conditions]=await Promise.all([
    supabase('shipments',{query:'?select=id,client_id,container_number,last_status,operational_status,last_event_at,created_at,shipsgo_status,shipsgo_link_mode,active,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'}),
    loadConditionMap([EVENT_TYPE])
  ]);
  const seen=new Set();let changed=0;
  for(const shipment of shipments||[]){
    const key=alertKey(EVENT_TYPE,shipment.id);seen.add(key);const previous=conditions.get(key);
    const manual=shipment.shipsgo_status==='manual'||shipment.shipsgo_link_mode==='manual';
    const reference=validDate(shipment.last_event_at||shipment.created_at);
    const activeCondition=Boolean(manual&&reference&&nowMs-reference.getTime()>=WARNING_AFTER);
    if(!activeCondition){if(previous&&changedAction(await closeCondition(previous,!manual?'automatic_tracking_enabled':'manual_tracking_updated',now)))changed+=1;continue;}
    const days=elapsedDays(reference,nowMs),severity=nowMs-reference.getTime()>=CRITICAL_AFTER?'critical':'warning';
    const result=await reconcileAlert({
      dedupeKey:key,conditionActive:true,eventType:EVENT_TYPE,clientId:shipment.client_id||null,shipmentId:shipment.id,entityType:'shipment',entityId:shipment.id,
      severity,title:severity==='critical'?'Tracking manual sin actualizar por 5 días':'Tracking manual sin actualizar por 3 días',
      message:`El contenedor ${shipment.container_number||'sin número'} lleva ${days} días sin registrar un nuevo evento manual.`,
      dueAt:new Date(reference.getTime()+WARNING_AFTER).toISOString(),
      payload:{container_number:shipment.container_number||null,client_name:shipment.clients?.name||null,last_status:shipment.last_status||shipment.operational_status||null,last_event_at:reference.toISOString(),days_without_update:days,required_action:'update_manual_tracking'},
      trigger:Boolean(previous&&(previous.severity!==severity||Number(previous.payload?.days_without_update||0)!==days)),now
    });
    if(changedAction(result))changed+=1;
  }
  for(const row of conditions.values())if(!seen.has(row.dedupe_key)&&changedAction(await closeCondition(row,'shipment_inactive_or_missing',now)))changed+=1;
  return {shipments_checked:(shipments||[]).length,alerts_changed:changed,warning_after_days:3,critical_after_days:5};
}

export default async function handler(req,res){
  const isCron=cronAuthorized(req),admin=isCron?{username:'vercel-cron',admin_id:null}:await authorizeAdmin(req,res,'notifications.manage');if(!admin)return;
  if(req.method!=='GET')return fail(res,405,'Método no permitido');
  try{const result=await runCheck();await writeAudit(admin,'manual_tracking_alerts_check','system',null,result);return ok(res,result);}
  catch(error){console.error('MANUAL_TRACKING_ALERTS_ERROR',error);return fail(res,400,'No se pudieron comprobar las actualizaciones del tracking manual',error.message);}
}
