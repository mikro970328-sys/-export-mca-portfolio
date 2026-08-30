import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { HOUR, DAY, alertKey, validDate, elapsedHours, repeatDue, loadConditionMap, reconcileAlert, closeCondition, changedAction } from './_alert-lifecycle.js';

const CLIENT_ALERT_AFTER=48*HOUR;
const CLIENT_CRITICAL_AFTER=7*DAY;
const TRACKING_ALERT_AFTER=12*HOUR;
const TRACKING_REPEAT_EVERY=12*HOUR;
const TASK_REPEAT_EVERY=24*HOUR;

const EVENT_CLIENT='client_without_shipment';
const EVENT_TRACKING='shipment_stale_tracking';
const EVENT_CUSTOMS_LEGACY='shipment_customs_documents_missing';
const EVENT_TASK_BLOCKED='task_blocked';
const EVENT_TASK_OVERDUE='task_overdue';
const EVENT_ROUTE_INVALID='workflow_route_invalid';
const LEGACY_EVENTS=['tracking_stale'];

function cronAuthorized(req){const secret=process.env.CRON_SECRET;return Boolean(secret)&&req.headers.authorization===`Bearer ${secret}`;}
function severityForPriority(priority){return ['critical','high'].includes(String(priority||'').toLowerCase())?'critical':'warning';}
function countChanged(result){return changedAction(result)?1:0;}

async function processClientAlerts(conditions,now,nowMs){
  const [clients,shipments]=await Promise.all([
    supabase('clients',{query:'?select=id,name,company,created_at,active&order=created_at.asc&limit=5000'}),
    supabase('shipments',{query:'?select=id,client_id&limit=5000'})
  ]);
  const withShipment=new Set((shipments||[]).map(row=>row.client_id).filter(Boolean));
  const seen=new Set();let changed=0;

  for(const client of clients||[]){
    const key=alertKey(EVENT_CLIENT,client.id);seen.add(key);
    const previous=conditions.get(key);const createdAt=validDate(client.created_at);
    const activeCondition=client.active!==false&&!withShipment.has(client.id)&&createdAt&&nowMs-createdAt.getTime()>=CLIENT_ALERT_AFTER;
    if(!activeCondition){if(previous)changed+=countChanged(await closeCondition(previous,client.active===false?'client_inactive':withShipment.has(client.id)?'shipment_assigned':'within_threshold',now));continue;}
    const hours=elapsedHours(createdAt,nowMs),critical=nowMs-createdAt.getTime()>=CLIENT_CRITICAL_AFTER,severity=critical?'critical':'warning';
    const result=await reconcileAlert({
      dedupeKey:key,conditionActive:true,eventType:EVENT_CLIENT,clientId:client.id,entityType:'client',entityId:client.id,
      severity,title:critical?'Cliente sin contenedor por 7 días':'Cliente sin contenedor por 48 horas',
      message:`${client.name||'Cliente'} lleva ${hours} horas sin un contenedor asociado.`,
      dueAt:new Date(createdAt.getTime()+CLIENT_ALERT_AFTER).toISOString(),
      payload:{client_name:client.name,company:client.company,hours_without_shipment:hours,required_action:'review_client_logistics'},
      trigger:Boolean(previous&&previous.severity!==severity),now
    });
    changed+=countChanged(result);
  }
  for(const row of conditions.values())if(row.event_type===EVENT_CLIENT&&!seen.has(row.dedupe_key))changed+=countChanged(await closeCondition(row,'entity_not_present',now));
  return {checked:(clients||[]).length,changed};
}

async function processTrackingAlerts(conditions,now,nowMs){
  const shipments=await supabase('shipments',{query:'?select=id,client_id,container_number,shipsgo_status,shipsgo_link_mode,last_event_at,created_at,active,clients(id,name)&active=eq.true&order=created_at.asc&limit=5000'});
  const seen=new Set();let changed=0;
  for(const shipment of shipments||[]){
    const key=alertKey(EVENT_TRACKING,shipment.id);seen.add(key);const previous=conditions.get(key);
    const manual=shipment.shipsgo_status==='manual'||shipment.shipsgo_link_mode==='manual';
    const reference=validDate(shipment.last_event_at||shipment.created_at);
    const activeCondition=!manual&&reference&&nowMs-reference.getTime()>=TRACKING_ALERT_AFTER;
    if(!activeCondition){if(previous)changed+=countChanged(await closeCondition(previous,manual?'manual_mode_enabled':'tracking_updated',now));continue;}
    const hours=elapsedHours(reference,nowMs),interval=Math.max(1,Math.floor(hours/12));
    const result=await reconcileAlert({
      dedupeKey:key,conditionActive:true,eventType:EVENT_TRACKING,clientId:shipment.client_id||null,shipmentId:shipment.id,entityType:'shipment',entityId:shipment.id,
      severity:'critical',title:`Tracking sin actualización por ${hours} horas`,
      message:`El contenedor ${shipment.container_number} no recibe una actualización automática desde hace ${hours} horas.`,
      dueAt:new Date(reference.getTime()+TRACKING_ALERT_AFTER).toISOString(),
      payload:{container_number:shipment.container_number,client_name:shipment.clients?.name||null,hours_without_update:hours,reference_at:reference.toISOString(),repeat_interval:interval,required_action:'review_or_enable_manual'},
      trigger:Boolean(previous&&(repeatDue(previous,TRACKING_REPEAT_EVERY,nowMs)||Number(previous.payload?.hours_without_update||0)!==hours)),now
    });
    changed+=countChanged(result);
  }
  for(const row of conditions.values())if(row.event_type===EVENT_TRACKING&&!seen.has(row.dedupe_key))changed+=countChanged(await closeCondition(row,'shipment_inactive_or_missing',now));
  return {checked:(shipments||[]).length,changed};
}

async function processTaskExceptionAlerts(conditions,now,nowMs){
  const [tasks,routes]=await Promise.all([
    supabase('operational_task_attention',{query:'?select=*&is_open=eq.true&limit=5000'}),
    supabase('workflow_task_route_directory',{query:'?select=*&enabled=eq.true&order=label.asc'})
  ]);
  const seenBlocked=new Set(),seenOverdue=new Set(),seenRoutes=new Set();let changed=0;

  for(const task of tasks||[]){
    const blockedKey=alertKey(EVENT_TASK_BLOCKED,task.id),overdueKey=alertKey(EVENT_TASK_OVERDUE,task.id);
    const blockedPrevious=conditions.get(blockedKey),overduePrevious=conditions.get(overdueKey);
    if(task.status==='blocked'){
      seenBlocked.add(blockedKey);
      const result=await reconcileAlert({
        dedupeKey:blockedKey,conditionActive:true,eventType:EVENT_TASK_BLOCKED,entityType:'operational_task',entityId:task.id,
        severity:severityForPriority(task.priority),title:'Tarea operativa bloqueada',
        message:`${task.title} está bloqueada${task.blocked_reason?`: ${task.blocked_reason}`:'.'}`,
        dueAt:task.due_at||null,
        payload:{task_id:task.id,task_title:task.title,priority:task.priority,workflow_key:task.workflow_key||null,assigned_team_name:task.assigned_team_name||null,assigned_admin_name:task.assigned_admin_name||null,blocked_reason:task.blocked_reason||null,blocked_minutes:task.blocked_minutes,required_action:'review_blocked_task'},
        trigger:Boolean(blockedPrevious&&(repeatDue(blockedPrevious,TASK_REPEAT_EVERY,nowMs)||blockedPrevious.payload?.blocked_reason!==task.blocked_reason)),now
      });changed+=countChanged(result);
    }else if(blockedPrevious){changed+=countChanged(await closeCondition(blockedPrevious,'task_unblocked_or_closed',now));}

    if(task.is_overdue_attention===true){
      seenOverdue.add(overdueKey);
      const result=await reconcileAlert({
        dedupeKey:overdueKey,conditionActive:true,eventType:EVENT_TASK_OVERDUE,entityType:'operational_task',entityId:task.id,
        severity:severityForPriority(task.priority),title:'Tarea operativa vencida',
        message:`${task.title} venció su SLA y sigue pendiente.`,dueAt:task.due_at||null,
        payload:{task_id:task.id,task_title:task.title,priority:task.priority,workflow_key:task.workflow_key||null,assigned_team_name:task.assigned_team_name||null,assigned_admin_name:task.assigned_admin_name||null,due_in_minutes:task.due_in_minutes,required_action:'review_overdue_task'},
        trigger:Boolean(overduePrevious&&repeatDue(overduePrevious,TASK_REPEAT_EVERY,nowMs)),now
      });changed+=countChanged(result);
    }else if(overduePrevious){changed+=countChanged(await closeCondition(overduePrevious,'task_no_longer_overdue',now));}
  }
  for(const row of conditions.values()){
    if(row.event_type===EVENT_TASK_BLOCKED&&!seenBlocked.has(row.dedupe_key))changed+=countChanged(await closeCondition(row,'task_closed_or_missing',now));
    if(row.event_type===EVENT_TASK_OVERDUE&&!seenOverdue.has(row.dedupe_key))changed+=countChanged(await closeCondition(row,'task_closed_or_missing',now));
  }

  for(const route of routes||[]){
    const key=alertKey(EVENT_ROUTE_INVALID,route.workflow_key),previous=conditions.get(key);
    const activeCount=Number(route.active_task_count||0),invalid=activeCount>0&&route.routing_access_compatible===false;
    seenRoutes.add(key);
    if(!invalid){if(previous)changed+=countChanged(await closeCondition(previous,'workflow_routing_operational',now));continue;}
    const unassigned=!route.assigned_team_id&&!route.assigned_admin_id;
    const result=await reconcileAlert({
      dedupeKey:key,conditionActive:true,eventType:EVENT_ROUTE_INVALID,severity:route.default_priority==='critical'?'critical':'warning',
      title:unassigned?'Handoff sin routing operativo':'Handoff con permisos incompatibles',
      message:unassigned?`${route.label} tiene ${activeCount} tarea${activeCount===1?'':'s'} activa${activeCount===1?'':'s'} sin equipo ni responsable.`:`${route.label} tiene trabajo activo, pero el routing configurado no tiene acceso suficiente.`,
      payload:{workflow_key:route.workflow_key,workflow_label:route.label,active_task_count:activeCount,assigned_team_id:route.assigned_team_id||null,assigned_team_name:route.assigned_team_name||null,assigned_admin_id:route.assigned_admin_id||null,assigned_admin_name:route.assigned_admin_name||null,required_permissions:route.required_permissions||[],routing_access_compatible:route.routing_access_compatible,team_member_count:route.team_member_count,team_eligible_member_count:route.team_eligible_member_count,required_action:'configure_workflow_route'},
      trigger:Boolean(previous&&(repeatDue(previous,TASK_REPEAT_EVERY,nowMs)||Number(previous.payload?.active_task_count||0)!==activeCount||Boolean(previous.payload?.assigned_team_id)!==Boolean(route.assigned_team_id))),now
    });changed+=countChanged(result);
  }
  for(const row of conditions.values())if(row.event_type===EVENT_ROUTE_INVALID&&!seenRoutes.has(row.dedupe_key))changed+=countChanged(await closeCondition(row,'workflow_route_removed_or_disabled',now));
  return {tasks_checked:(tasks||[]).length,routes_checked:(routes||[]).length,changed};
}

async function retireLegacyAlerts(conditions,now){
  let changed=0;
  for(const row of conditions.values()){
    if(row.event_type===EVENT_CUSTOMS_LEGACY)changed+=countChanged(await closeCondition(row,'superseded_by_task_workflow',now));
    if(LEGACY_EVENTS.includes(row.event_type))changed+=countChanged(await closeCondition(row,'legacy_alert_retired',now));
  }
  return changed;
}

async function runCheck(){
  const now=new Date().toISOString(),nowMs=Date.now();
  const conditions=await loadConditionMap([EVENT_CLIENT,EVENT_TRACKING,EVENT_CUSTOMS_LEGACY,EVENT_TASK_BLOCKED,EVENT_TASK_OVERDUE,EVENT_ROUTE_INVALID,...LEGACY_EVENTS]);
  const [clients,tracking,tasks,legacyResolved]=await Promise.all([
    processClientAlerts(conditions,now,nowMs),processTrackingAlerts(conditions,now,nowMs),processTaskExceptionAlerts(conditions,now,nowMs),retireLegacyAlerts(conditions,now)
  ]);
  return {clients_checked:clients.checked,tracking_checked:tracking.checked,tasks_checked:tasks.tasks_checked,routes_checked:tasks.routes_checked,client_alerts_changed:clients.changed,tracking_alerts_changed:tracking.changed,task_alerts_changed:tasks.changed,legacy_alerts_changed:legacyResolved};
}

async function actOnAlert(admin,id,action,body={}){
  const now=new Date().toISOString();
  const snoozedUntil=action==='snooze'?new Date(Date.now()+Math.max(1,Math.min(168,Number(body.hours||24)))*HOUR).toISOString():null;
  const result=await supabase('rpc/act_on_operational_alert',{method:'POST',body:{p_notification_id:id,p_actor:admin.admin_id,p_action:action,p_reason:body.reason||null,p_snoozed_until:snoozedUntil,p_now:now},prefer:'return=representation'});
  return Array.isArray(result)?result[0]||null:result;
}

export default async function handler(req,res){
  const isCron=cronAuthorized(req),action=String(req.query?.action||'').trim().toLowerCase();
  const permission=req.method==='GET'&&!isCron&&action!=='check'?'notifications.read':'notifications.manage';
  const admin=isCron?{username:'vercel-cron',admin_id:null}:await authorizeAdmin(req,res,permission);if(!admin)return;
  try{
    if(req.method==='GET'){
      if(isCron||action==='check'){const result=await runCheck();await writeAudit(admin,'operational_alerts_check','system',null,result);return ok(res,result);}
      const registry=await supabase('operational_alert_conditions',{query:'?select=notification_id&limit=5000'});const ids=(registry||[]).map(row=>row.notification_id).filter(Boolean);
      if(!ids.length)return ok(res,{alerts:[]});
      const rows=await supabase('notifications',{query:`?select=*,clients(id,name),shipments(id,container_number,shipsgo_status,last_event_at)&id=in.(${ids.join(',')})&alert_status=in.(pending,snoozed)&order=created_at.desc&limit=500`});
      return ok(res,{alerts:rows||[]});
    }
    if(req.method==='PATCH'){
      const body=await readJson(req),id=String(body.id||'').trim(),bodyAction=String(body.action||'resolve').trim().toLowerCase();if(!id)return fail(res,400,'Falta el identificador de la alerta');
      if(!['mark_read','resolve','snooze','reopen'].includes(bodyAction))return fail(res,400,'Acción no válida');
      const result=await actOnAlert(admin,id,bodyAction,body);await writeAudit(admin,`operational_alert_${bodyAction}`,'notification',id,{result});return ok(res,{notification:result});
    }
    return fail(res,405,'Método no permitido');
  }catch(error){console.error('OPERATIONAL_ALERTS_ERROR',error);return fail(res,400,'No se pudieron procesar las alertas operativas',error.message);}
}
