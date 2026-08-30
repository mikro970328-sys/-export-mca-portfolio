import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';
import { DAY, alertKey, repeatDue, loadConditionMap, reconcileAlert, closeCondition, changedAction } from './_alert-lifecycle.js';

const EVENT_TYPE='shipsgo_tracking_failed';
const REPEAT_EVERY=DAY;

function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret)&&req.headers.authorization===`Bearer ${secret}`;}
function isShipsGoFailure(shipment){const status=String(shipment.shipsgo_status||'').trim().toLowerCase();return status==='failed'||Boolean(String(shipment.shipsgo_error||'').trim());}

async function runCheck(){
  const now=new Date().toISOString(),nowMs=Date.now();
  const [shipments,conditions]=await Promise.all([
    supabase('shipments',{query:'?select=id,client_id,container_number,shipsgo_status,shipsgo_error,shipsgo_tracking_id,shipsgo_link_mode,active,clients(id,name)&active=eq.true&order=updated_at.asc&limit=5000'}),
    loadConditionMap([EVENT_TYPE])
  ]);
  const seen=new Set();let changed=0;
  for(const shipment of shipments||[]){
    const key=alertKey(EVENT_TYPE,shipment.id);seen.add(key);const previous=conditions.get(key);
    const manual=String(shipment.shipsgo_status||'').toLowerCase()==='manual',failed=!manual&&isShipsGoFailure(shipment);
    if(!failed){if(previous&&changedAction(await closeCondition(previous,manual?'manual_mode_enabled':'shipsgo_recovered',now)))changed+=1;continue;}
    const error=String(shipment.shipsgo_error||'ShipsGo no pudo mantener el tracking automático').trim();
    const result=await reconcileAlert({
      dedupeKey:key,conditionActive:true,eventType:EVENT_TYPE,clientId:shipment.client_id||null,shipmentId:shipment.id,entityType:'shipment',entityId:shipment.id,
      severity:'critical',title:'Error de tracking en ShipsGo',message:`El contenedor ${shipment.container_number||'sin número'} tiene un error de ShipsGo y requiere reconexión o cambio a seguimiento manual.`,
      payload:{container_number:shipment.container_number||null,client_name:shipment.clients?.name||null,shipsgo_status:shipment.shipsgo_status||null,shipsgo_tracking_id:shipment.shipsgo_tracking_id||null,shipsgo_error:error,required_action:shipment.shipsgo_tracking_id?'reconnect_or_enable_manual':'connect_or_enable_manual'},
      trigger:Boolean(previous&&(repeatDue(previous,REPEAT_EVERY,nowMs)||previous.payload?.shipsgo_error!==error)),now
    });
    if(changedAction(result))changed+=1;
  }
  for(const row of conditions.values())if(!seen.has(row.dedupe_key)&&changedAction(await closeCondition(row,'shipment_inactive_or_missing',now)))changed+=1;
  return {shipments_checked:(shipments||[]).length,alerts_changed:changed};
}

export default async function handler(req,res){
  const isCron=cronAuthorized(req),admin=isCron?{username:'vercel-cron',admin_id:null}:await authorizeAdmin(req,res,'notifications.manage');if(!admin)return;
  if(req.method!=='GET')return fail(res,405,'Método no permitido');
  try{const result=await runCheck();await writeAudit(admin,'shipsgo_error_alerts_check','system',null,result);return ok(res,result);}
  catch(error){console.error('SHIPSGO_ERROR_ALERTS_ERROR',error);return fail(res,400,'No se pudieron comprobar los errores de ShipsGo',error.message);}
}
