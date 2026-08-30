import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';
import { DAY, alertKey, validDate, elapsedDays, repeatDue, loadConditionMap, reconcileAlert, closeCondition, changedAction } from './_alert-lifecycle.js';

const RELEASE_ALERT_AFTER=5*DAY;
const EVENT_TYPE='shipment_discharged_not_released';

function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret)&&req.headers.authorization===`Bearer ${secret}`;}

async function runCheck(){
  const now=new Date().toISOString(),nowMs=Date.now();
  const [shipments,conditions]=await Promise.all([
    supabase('shipments',{query:'?select=id,client_id,container_number,discharged_at,released_at,active,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'}),
    loadConditionMap([EVENT_TYPE])
  ]);
  const seen=new Set();let changed=0;
  for(const shipment of shipments||[]){
    const key=alertKey(EVENT_TYPE,shipment.id);seen.add(key);const previous=conditions.get(key),dischargedAt=validDate(shipment.discharged_at);
    const activeCondition=Boolean(dischargedAt&&!shipment.released_at&&nowMs-dischargedAt.getTime()>=RELEASE_ALERT_AFTER);
    if(!activeCondition){if(previous&&changedAction(await closeCondition(previous,shipment.released_at?'shipment_released':'within_threshold_or_not_discharged',now)))changed+=1;continue;}
    const days=elapsedDays(dischargedAt,nowMs);
    const result=await reconcileAlert({
      dedupeKey:key,conditionActive:true,eventType:EVENT_TYPE,clientId:shipment.client_id||null,shipmentId:shipment.id,entityType:'shipment',entityId:shipment.id,
      severity:'critical',title:'Contenedor descargado pendiente de liberación',
      message:`El contenedor ${shipment.container_number||'sin número'} fue descargado hace ${days} días y todavía no ha sido liberado.`,
      dueAt:new Date(dischargedAt.getTime()+RELEASE_ALERT_AFTER).toISOString(),
      payload:{container_number:shipment.container_number||null,client_name:shipment.clients?.name||null,discharged_at:dischargedAt.toISOString(),days_since_discharge:days,required_action:'release_shipment'},
      trigger:Boolean(previous&&(repeatDue(previous,DAY,nowMs)||Number(previous.payload?.days_since_discharge||0)!==days)),now
    });
    if(changedAction(result))changed+=1;
  }
  for(const row of conditions.values())if(!seen.has(row.dedupe_key)&&changedAction(await closeCondition(row,'shipment_inactive_or_missing',now)))changed+=1;
  return {shipments_checked:(shipments||[]).length,alerts_changed:changed,threshold_days:5};
}

export default async function handler(req,res){
  const isCron=cronAuthorized(req),admin=isCron?{username:'vercel-cron',admin_id:null}:await authorizeAdmin(req,res,'notifications.manage');if(!admin)return;
  if(req.method!=='GET')return fail(res,405,'Método no permitido');
  try{const result=await runCheck();await writeAudit(admin,'discharge_release_alerts_check','system',null,result);return ok(res,result);}
  catch(error){console.error('DISCHARGE_RELEASE_ALERTS_ERROR',error);return fail(res,400,'No se pudo comprobar la liberación después de la descarga',error.message);}
}
