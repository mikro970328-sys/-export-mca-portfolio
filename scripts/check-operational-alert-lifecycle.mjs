import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const reconcileCorrection='supabase/migrations/20260830211700_p9_alert_reconcile_column_qualification.sql';
const actionCorrection='supabase/migrations/20260830211800_p9_alert_action_column_qualification.sql';
const required=[
  'supabase/migrations/20260830211500_p9_operational_alert_condition_registry.sql',
  'supabase/migrations/20260830211600_p9_alert_cycle_seed_normalization.sql',
  'api/_alert-lifecycle.js',
  'api/tracking-alerts.js',
  'api/manual-tracking-alerts.js',
  'api/discharge-release-alerts.js',
  'api/shipsgo-error-alerts.js',
  'api/stagnant-shipment-alerts.js',
  'api/history.js',
  'admin/operational-alert-center.js',
  'admin/alert-phase2-stability.js'
];
for(const file of [...required,reconcileCorrection,actionCorrection])if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta archivo P9`);

if(!failures.length){
  const migration=read(required[0]),normalization=read(required[1]),qualification=read(reconcileCorrection),actionQualification=read(actionCorrection),helper=read(required[2]),tracking=read(required[3]),history=read(required[8]),center=read(required[9]),stability=read(required[10]);
  for(const requiredText of [
    'create table public.operational_alert_conditions',
    'dedupe_key text primary key',
    'notification_id uuid not null unique',
    'condition_active boolean not null',
    'condition_cycle_count integer not null',
    'operational_alert_condition_state',
    'reconcile_operational_alert_condition',
    'act_on_operational_alert',
    "resolved_source in ('manual','condition','system')",
    "resolved_reason='superseded_by_task_workflow'",
    'with (security_invoker=true)',
    'pg_advisory_xact_lock',
    "v_action:='suppressed_manual'",
    "v_action:='rearmed'",
    "raise exception 'ALERT_CONDITION_CLOSED'"
  ])if(!migration.includes(requiredText))failures.push(`migración P9: falta ${requiredText}`);

  for(const requiredText of [
    'set condition_cycle_count=1',
    "n.resolved_source='manual'",
    'condition_active=true',
    'condition_closed_at=null'
  ])if(!normalization.includes(requiredText))failures.push(`normalización P9: falta ${requiredText}`);

  for(const requiredText of [
    'create or replace function public.reconcile_operational_alert_condition',
    'update public.notifications n',
    'coalesce(n.occurrence_count,0)',
    'else n.occurrence_count end',
    'else n.last_triggered_at end',
    'else n.read_at end'
  ])if(!qualification.includes(requiredText))failures.push(`calificación reconcile P9: falta ${requiredText}`);
  if(/coalesce\(occurrence_count,0\)|else occurrence_count end/.test(qualification))failures.push('calificación reconcile P9: occurrence_count sigue sin calificar');

  for(const requiredText of [
    'create or replace function public.act_on_operational_alert',
    'from public.operational_alert_conditions c',
    'where c.notification_id=p_notification_id',
    'from public.notifications n',
    'where n.id=p_notification_id'
  ])if(!actionQualification.includes(requiredText))failures.push(`calificación action P9: falta ${requiredText}`);
  if(/where\s+notification_id\s*=\s*p_notification_id/.test(actionQualification))failures.push('calificación action P9: notification_id sigue sin calificar');

  const reconcileSignature='public.reconcile_operational_alert_condition(text,boolean,text,uuid,uuid,text,uuid,text,text,text,timestamptz,jsonb,boolean,text,timestamptz)';
  const actionSignature='public.act_on_operational_alert(uuid,uuid,text,text,timestamptz,timestamptz)';
  for(const signature of [reconcileSignature,actionSignature]){
    if(!migration.includes(`revoke execute on function ${signature} from public,anon,authenticated`))failures.push(`P9: falta revoke ${signature}`);
    if(!migration.includes(`grant execute on function ${signature} to service_role`))failures.push(`P9: falta grant service_role ${signature}`);
  }
  if(!qualification.includes(`revoke execute on function ${reconcileSignature} from public,anon,authenticated`))failures.push('P9: migración reconcile correctiva debe conservar revoke');
  if(!qualification.includes(`grant execute on function ${reconcileSignature} to service_role`))failures.push('P9: migración reconcile correctiva debe conservar grant service_role');
  if(!actionQualification.includes(`revoke execute on function ${actionSignature} from public,anon,authenticated`))failures.push('P9: migración action correctiva debe conservar revoke');
  if(!actionQualification.includes(`grant execute on function ${actionSignature} to service_role`))failures.push('P9: migración action correctiva debe conservar grant service_role');

  for(const text of ['operational_alert_condition_state','rpc/reconcile_operational_alert_condition','closeCondition','changedAction'])if(!helper.includes(text))failures.push(`helper P9: falta ${text}`);

  const checkerFiles=required.slice(3,8);
  for(const file of checkerFiles){
    const code=read(file);
    if(!code.includes("from './_alert-lifecycle.js'"))failures.push(`${file}: no usa lifecycle común`);
    if(/resolved_at=is\.null/.test(code))failures.push(`${file}: no debe cargar identidad por resolved_at is null`);
    if(/method\s*:\s*['"]POST['"][\s\S]{0,250}notification_scope\s*:\s*['"]operational['"]/.test(code)||/notification_scope\s*:\s*['"]operational['"][\s\S]{0,250}method\s*:\s*['"]POST['"]/.test(code))failures.push(`${file}: inserción directa de alerta operativa`);
  }

  for(const text of ['task_blocked','task_overdue','workflow_route_invalid','operational_task_attention','workflow_task_route_directory'])if(!tracking.includes(text))failures.push(`tracking-alerts P9: falta política ${text}`);
  if(!tracking.includes("task.status==='blocked'"))failures.push('P9: bloqueo debe evaluarse por estado real de la tarea');
  if(!tracking.includes('task.is_overdue_attention===true'))failures.push('P9: vencimiento debe evaluarse independientemente del attention_state');
  if(/task\.attention_state===['"]overdue['"]/.test(tracking))failures.push('P9: attention_state no debe ocultar vencimiento cuando la tarea también está bloqueada');
  if(tracking.includes('processCustomsDocumentAlerts'))failures.push('tracking-alerts P9: documentos Cuba no deben seguir como alerta inmediata');
  if(/EVENT_TASK_UNASSIGNED|task_unassigned/.test(tracking))failures.push('P9: unassigned no genera alerta individual');
  if(/due_soon/.test(tracking)&&/EVENT_TASK/.test(tracking))failures.push('P9: due_soon no genera alerta individual');

  for(const text of ['operational_alert_conditions','act_on_operational_alert','condition_active','condition_cycle_count'])if(!history.includes(text))failures.push(`history P9: falta ${text}`);
  if(/patch\.alert_status\s*=\s*['"]resolved['"]/.test(history))failures.push('history P9: resolve operacional no debe mutar lifecycle directo');

  if(center.includes('/api/tracking-alerts?action=check'))failures.push('alert center P9: no debe ser owner del checker');
  if(center.includes('setInterval('))failures.push('alert center P9: no debe tener polling propio');
  if(!center.includes('alertActionDialog'))failures.push('alert center P9: falta diálogo propio de resolve/snooze');
  const actionStart=center.indexOf('async function executeAlertAction');
  const actionEnd=center.indexOf('async function retryMessage');
  if(actionStart<0||actionEnd<=actionStart)failures.push('alert center P9: no se pudo delimitar acciones');
  else if(/prompt\s*\(|confirm\s*\(|alert\s*\(/.test(center.slice(actionStart,actionEnd)))failures.push('alert center P9: acciones de alerta usan diálogo nativo');
  if(!center.includes("row.condition_active===true"))failures.push('alert center P9: reopen debe depender de condición activa');

  if(!stability.includes('/api/tracking-alerts?action=check'))failures.push('stability P9: debe ser owner del checker de navegador');
  if(!stability.includes('setInterval('))failures.push('stability P9: falta scheduler único');
}

if(failures.length){console.error('P9 operational alert lifecycle check failed:\n'+failures.map(x=>`- ${x}`).join('\n'));process.exit(1);}
console.log('P9 operational alert lifecycle check passed.');