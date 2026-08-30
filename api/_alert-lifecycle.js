import { supabase } from './_lib.js';

export const HOUR=60*60*1000;
export const DAY=24*HOUR;

export function alertKey(type,entityId){return `${type}:${entityId}`;}
export function validDate(value){const date=new Date(value||0);return Number.isNaN(date.getTime())?null:date;}
export function elapsedHours(from,nowMs=Date.now()){return Math.max(0,Math.floor((nowMs-from.getTime())/HOUR));}
export function elapsedDays(from,nowMs=Date.now()){return Math.max(0,Math.floor((nowMs-from.getTime())/DAY));}
export function repeatDue(row,intervalMs,nowMs=Date.now()){
  const last=validDate(row?.last_triggered_at||row?.notification_updated_at||row?.notification_created_at);
  return !last||nowMs-last.getTime()>=intervalMs;
}

export async function loadConditionMap(eventTypes=[]){
  const types=[...new Set((eventTypes||[]).filter(Boolean))];
  const filter=types.length?`&event_type=in.(${types.map(value=>encodeURIComponent(value)).join(',')})`:'';
  const rows=await supabase('operational_alert_condition_state',{query:`?select=*&limit=10000${filter}`});
  return new Map((rows||[]).map(row=>[row.dedupe_key,row]));
}

export async function reconcileAlert({
  dedupeKey,conditionActive,eventType,clientId=null,shipmentId=null,entityType=null,entityId=null,
  severity='warning',title='',message='',dueAt=null,payload={},trigger=false,resolutionReason='condition_cleared',now=null
}){
  const result=await supabase('rpc/reconcile_operational_alert_condition',{
    method:'POST',
    body:{
      p_dedupe_key:dedupeKey,
      p_condition_active:Boolean(conditionActive),
      p_event_type:eventType,
      p_client_id:clientId,
      p_shipment_id:shipmentId,
      p_entity_type:entityType,
      p_entity_id:entityId,
      p_severity:severity,
      p_title:title,
      p_message:message,
      p_due_at:dueAt,
      p_payload:payload||{},
      p_trigger:Boolean(trigger),
      p_resolution_reason:resolutionReason,
      ...(now?{p_now:now}:{})
    },
    prefer:'return=representation'
  });
  return Array.isArray(result)?result[0]||null:result;
}

export async function closeCondition(row,reason='condition_cleared',now=null){
  if(!row?.dedupe_key)return null;
  return reconcileAlert({
    dedupeKey:row.dedupe_key,
    conditionActive:false,
    eventType:row.event_type,
    clientId:row.client_id||null,
    shipmentId:row.shipment_id||null,
    entityType:row.entity_type||null,
    entityId:row.entity_id||null,
    severity:row.severity||'warning',
    title:row.title||'Alerta operativa',
    message:row.message||'',
    dueAt:row.due_at||null,
    payload:row.payload||{},
    resolutionReason:reason,
    now
  });
}

export function changedAction(result){return Boolean(result&&result.action&&!['noop','refreshed','snoozed','suppressed_manual'].includes(result.action));}
