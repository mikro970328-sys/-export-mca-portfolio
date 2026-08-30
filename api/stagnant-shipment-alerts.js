import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';
import { DAY, alertKey, validDate, elapsedDays, repeatDue, loadConditionMap, reconcileAlert, closeCondition, changedAction } from './_alert-lifecycle.js';

const EVENT_TYPE='shipment_stagnant_status';
const RULES=[
  {match:['registrado','registered'],warningDays:5,criticalDays:7},
  {match:['cargado en el buque','loaded on vessel'],warningDays:3,criticalDays:5},
  {match:['salió del puerto','salio del puerto','departed'],warningDays:7,criticalDays:10},
  {match:['llegó al puerto','llego al puerto','arrived'],warningDays:3,criticalDays:5},
  {match:['liberado','released'],warningDays:3,criticalDays:5}
];

function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret)&&req.headers.authorization===`Bearer ${secret}`;}
function normalizedStatus(shipment){return String(shipment.last_status||shipment.operational_status||'').trim().toLowerCase();}
function ruleFor(status){return RULES.find(rule=>rule.match.some(value=>status.includes(value)))||null;}

async function runCheck(){
  const now=new Date().toISOString(),nowMs=Date.now();
  const [shipments,conditions]=await Promise.all([
    supabase('shipments',{query:'?select=id,client_id,container_number,last_status,operational_status,last_event_at,created_at,updated_at,shipsgo_status,active,released_at,delivered_at,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'}),
    loadConditionMap([EVENT_TYPE])
  ]);
  const seen=new Set();let changed=0;
  for(const shipment of shipments||[]){
    const key=alertKey(EVENT_TYPE,shipment.id);seen.add(key);const previous=conditions.get(key),status=normalizedStatus(shipment);
    const excluded=shipment.shipsgo_status==='manual'||status.includes('descargado')||status.includes('discharged')||Boolean(shipment.delivered_at);
    const rule=excluded?null:ruleFor(status),reference=rule?validDate(shipment.last_event_at||shipment.updated_at||shipment.created_at):null;
    const days=reference?elapsedDays(reference,nowMs):0,activeCondition=Boolean(rule&&reference&&days>=rule.warningDays);
    if(!activeCondition){if(previous&&changedAction(await closeCondition(previous,excluded?'covered_by_specific_rule_or_completed':rule?'status_advanced_or_within_threshold':'status_not_monitored',now)))changed+=1;continue;}
    const severity=days>=rule.criticalDays?'critical':'warning',referenceIso=reference.toISOString(),statusLabel=shipment.last_status||shipment.operational_status||'Sin estado';
    const referenceChanged=Boolean(previous&&previous.payload?.status_reference_at&&previous.payload.status_reference_at!==referenceIso);
    const result=await reconcileAlert({
      dedupeKey:key,conditionActive:true,eventType:EVENT_TYPE,clientId:shipment.client_id||null,shipmentId:shipment.id,entityType:'shipment',entityId:shipment.id,
      severity,title:severity==='critical'?'Contenedor detenido en el mismo estado':'Contenedor sin avance operativo',
      message:`El contenedor ${shipment.container_number||'sin número'} lleva ${days} días en “${statusLabel}” sin registrar un nuevo evento.`,
      dueAt:new Date(reference.getTime()+rule.warningDays*DAY).toISOString(),
      payload:{container_number:shipment.container_number||null,client_name:shipment.clients?.name||null,operational_status:statusLabel,status_reference_at:referenceIso,days_in_status:days,warning_days:rule.warningDays,critical_days:rule.criticalDays,required_action:'review_shipment_status'},
      trigger:Boolean(previous&&(referenceChanged||previous.severity!==severity||repeatDue(previous,DAY,nowMs))),now
    });
    if(changedAction(result))changed+=1;
  }
  for(const row of conditions.values())if(!seen.has(row.dedupe_key)&&changedAction(await closeCondition(row,'shipment_inactive_or_missing',now)))changed+=1;
  return {shipments_checked:(shipments||[]).length,alerts_changed:changed};
}

export default async function handler(req,res){
  const isCron=cronAuthorized(req),admin=isCron?{username:'vercel-cron',admin_id:null}:await authorizeAdmin(req,res,'notifications.manage');if(!admin)return;
  if(req.method!=='GET')return fail(res,405,'Método no permitido');
  try{const result=await runCheck();await writeAudit(admin,'stagnant_shipment_alerts_check','system',null,result);return ok(res,result);}
  catch(error){console.error('STAGNANT_SHIPMENT_ALERTS_ERROR',error);return fail(res,400,'No se pudieron comprobar los contenedores detenidos',error.message);}
}
