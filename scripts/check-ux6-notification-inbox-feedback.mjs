import fs from 'node:fs';

const files={
  owner:'admin/notification-inbox.js',
  styles:'admin/notification-inbox.css',
  loader:'admin/erp.js',
  index:'admin/index.html',
  inboxApi:'api/notification-inbox.js',
  reconcileOwner:'api/_notification-reconcile.js',
  historyApi:'api/history.js',
  workflow:'.github/workflows/ux6-notification-inbox-feedback.yml'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const owner=read(files.owner);
const styles=read(files.styles);
const loader=read(files.loader);
const index=read(files.index);
const inboxApi=read(files.inboxApi);
const reconcileOwner=read(files.reconcileOwner);
const historyApi=read(files.historyApi);
const workflow=read(files.workflow);

for(const text of [
  'const inboxErrorMessages = Object.freeze({',
  'const safeInboxErrors = new Set([',
  'function safeInboxMessage(',
  'NOTIFICATION_INBOX_UI_FAILED',
  "context='operation'",
  "raw.split(' · ')[0].trim()",
  'function historyStatus(',
  'function historyDetail(',
  "Boolean(row.error_message)",
  "'No se pudo entregar. Puedes reintentar el mensaje.'",
  "'Entrega pendiente.'",
  "'Entrega confirmada.'",
  "error.code='NOTIFICATION_DESTINATION_UNAVAILABLE'",
  "'load_history'",
  "'refresh'",
  "'item_action'",
  "'mark_all_read'",
  "'retry_history'",
  "'save_preferences'",
  "'open_work'"
])requireText(owner,text,`contrato seguro del Inbox ${text}`);

if((owner.match(/error\?\.message/g)||[]).length!==1)failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b/,'Inbox vuelve a renderizar error.message directamente');
forbid(owner,/esc\(row\.error_message/,'Inbox vuelve a mostrar el error técnico del proveedor');
forbid(owner,/<th>Error<\/th>/,'Historial vuelve a presentar una columna de error técnico');
forbid(owner,/\sstyle\s*=/i,'Inbox conserva estilos inline');
forbid(owner,/\.style(?:\.|\[)/,'Inbox vuelve a mutar presentación desde JavaScript');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Inbox vuelve a inyectar CSS desde JavaScript');
forbid(owner,/\bMutationObserver\b/,'Inbox vuelve a observar y recomponer el DOM');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Inbox vuelve a usar diálogos nativos');

for(const text of [
  'window.__notificationInboxInstalled',
  "window.NotificationInbox=Object.freeze",
  "owner:'notification-inbox.js'",
  "'/api/notification-inbox'",
  "'/api/history?mode=notifications&scope=message'",
  'OperationalNavigation.openEntity',
  'TasksWorkspace.open',
  "can?.('notifications.manage')"
])requireText(owner,text,`ownership canónico ${text}`);

requireText(styles,'.notification-preferences-actions{margin-top:12px}','presentación dedicada de acciones de preferencias');
requireText(loader,"/admin/notification-inbox.css?v=20260903-ux7icons2",'revisión del CSS del Inbox');
requireText(loader,"/admin/notification-inbox.js?v=20260903-b10push1",'revisión del owner del Inbox');
requireText(index,'/admin/erp.js?v=20260905-accessflow1','revisión del loader ERP');

for(const text of [
  "authorizeAdmin(req,res,'notifications.read')",
  "rpc('act_on_notification_inbox'",
  "return fail(res,500,'No se pudo procesar el inbox de notificaciones')"
])requireText(inboxApi,text,`boundary canónico del Inbox ${text}`);
requireText(inboxApi,'reconcileAllNotifications','boundary canónico del reconciliador compuesto');
requireText(reconcileOwner,"call('reconcile_user_notifications'",'preservación del RPC P10');
for(const text of [
  "permission=action==='mark_read'?'notifications.read':'notifications.manage'",
  "if(action!=='retry')return fail(res,400,'Acción no válida')",
  "sendWhatsApp({to,contentSid,variables:variablesFor(type,row)})"
])requireText(historyApi,text,`contrato de historial y reintento ${text}`);

for(const text of [
  'node scripts/check-ux6-notification-inbox-feedback.mjs',
  'node scripts/check-user-notifications.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-ux6-shell-ownership.mjs',
  'node scripts/check-ux6b-native-workspace-foundation.mjs',
  'node scripts/check-ux6-access-feedback.mjs',
  'node scripts/check-ux6-tasks-feedback.mjs',
  'node scripts/check-ux6-modal-dismissal.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,text,`workflow ${text}`);

if(failures.length){
  console.error('UX-6 Notification Inbox feedback gate failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-6 Notification Inbox feedback gate passed.');
console.log('- Inbox, preferencias e historial conservan un solo owner sin estilos ni observers compensatorios.');
console.log('- Los fallos inesperados quedan en diagnóstico y el historial no expone errores del proveedor.');
console.log('- Alertas, tareas, permisos, preferencias y reintentos canónicos permanecen intactos.');
