import fs from 'node:fs';

const read = path => fs.readFileSync(path,'utf8');
const assert = (condition,message) => { if(!condition) throw new Error(message); };

const migration = read('supabase/migrations/20260830215500_p10_user_notification_inbox.sql');
const integrity = read('supabase/migrations/20260830220500_p10_notification_source_version_integrity.sql');
const inboxApi = read('api/notification-inbox.js');
const reconcileApi = read('api/notification-reconcile.js');
const inboxUi = read('admin/notification-inbox.js');
const erp = read('admin/erp.js');
const vercel = read('vercel.json');

for (const table of ['notification_preferences','notification_inbox_items','notification_channel_deliveries']) {
  assert(migration.includes(`create table public.${table}`),`P10: falta ${table}`);
}
assert(migration.includes('notification_inbox_semantic_unique'), 'P10: falta dedupe semántico del inbox');
assert(migration.includes('recipient_admin_id,source_type,source_id,source_version,escalation_level'), 'P10: dedupe no cubre fuente/versión/destinatario/escalación');
assert(migration.includes("source_type in ('task','alert','system')"), 'P10: source_type inválido');
assert(migration.includes('notification_task_recipients'), 'P10: falta resolución canónica de destinatarios de tareas');
assert(migration.includes("permission_key='notifications.read'"), 'P10: miembros de equipo deben requerir notifications.read');
assert(migration.includes('required_permissions'), 'P10: destinatarios de workflow deben respetar permisos requeridos');
assert(migration.includes("array['notifications.manage']::text[]"), 'P10: falta fallback/escalación de supervisión');
assert(migration.includes("c.condition_active=true and n.alert_status='pending'"), 'P10: no debe entregar alertas resueltas/pospuestas como nuevas');
assert(migration.includes('condition_cycle_count::text'), 'P10: alertas deben versionarse por ciclo P9');
assert(migration.includes('assignment_state_changed_at'), 'P10: tareas deben versionarse por cambio real de asignación');

assert(integrity.includes("i.source_version=to_char(t.assignment_state_changed_at"), 'P10: asignaciones superseded deben quedar históricas');
assert(integrity.includes('i.source_version=c.condition_cycle_count::text'), 'P10: ciclos P9 anteriores deben quedar históricos');
assert(integrity.includes("else 'superseded'"), 'P10: la vista debe exponer fuentes superseded');

for (const table of ['notification_preferences','notification_inbox_items','notification_channel_deliveries']) {
  assert(migration.includes(`revoke all on public.${table} from public,anon,authenticated`),`P10: grants inseguros en ${table}`);
}
for (const fn of ['notification_user_eligible','notification_task_recipients','reconcile_user_notifications','act_on_notification_inbox','mark_all_notification_inbox_read','set_notification_preferences']) {
  assert(migration.includes(`revoke execute on function public.${fn}`),`P10: falta revoke del RPC ${fn}`);
  assert(migration.includes(`grant execute on function public.${fn}`),`P10: falta grant service_role del RPC ${fn}`);
}
assert(!migration.match(/grant\s+.*\s+to\s+(public|anon|authenticated)/i), 'P10: no se permiten grants a PUBLIC/anon/authenticated');

assert(inboxApi.includes("authorizeAdmin(req,res,'notifications.read')"), 'P10: inbox API debe revalidar notifications.read');
assert(inboxApi.includes("rpc('reconcile_user_notifications'"), 'P10: inbox debe usar reconciliador canónico DB');
assert(inboxApi.includes("rpc('act_on_notification_inbox'"), 'P10: lectura personal debe mutarse por RPC');
assert(reconcileApi.includes("authorizeAdmin(req,res,'notifications.manage')"), 'P10: reconciliación manual requiere notifications.manage');
assert(reconcileApi.includes('CRON_SECRET'), 'P10: reconciliación cron debe autenticar CRON_SECRET');
assert(reconcileApi.includes("rpc/reconcile_user_notifications"), 'P10: API reconcile debe delegar al owner DB');

assert(!inboxUi.includes('setInterval('), 'P10: el inbox no puede crear otro scheduler periódico del navegador');
assert(!inboxUi.includes('MutationObserver'), 'P10: el inbox no puede usar MutationObserver');
assert(!inboxUi.match(/\b(prompt|alert|confirm)\s*\(/), 'P10: no se permiten prompt/alert/confirm en el flujo modernizado');
assert(inboxUi.includes('OperationalNavigation.openEntity'), 'P10: navegación debe delegar a P6');
assert(inboxUi.includes('TasksWorkspace.open'), 'P10: tareas deben abrir el owner de tareas');
assert(inboxUi.includes("'/api/notification-inbox'"), 'P10: UI debe usar API propia del inbox');
assert(!inboxUi.includes("fetch('/rest/v1/"), 'P10: UI no puede hablar directo con Supabase');

const notificationsBlock = erp.slice(erp.indexOf("if (accessCan('notifications.read'))"), erp.indexOf('await Promise.all(tasks)'));
assert(notificationsBlock.includes('notification-inbox.js'), 'P10: bootstrap autorizado no carga el inbox');
assert(notificationsBlock.includes('notification-inbox.css'), 'P10: bootstrap autorizado no carga estilos P10');
assert(!erp.includes("accessCan('notifications.manage') && loadScript('/admin/notification-inbox"), 'P10: inbox read no debe exigir manage');
assert(vercel.includes('"path": "/api/notification-reconcile"'), 'P10: falta cron backend de reconciliación');

console.log('P10 user notifications architecture: OK');
