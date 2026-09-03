import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { classifyPushFailure, privacySafePushPayload, webPushConfig } from '../api/_web-push.js';

const read = path => fs.readFileSync(path, 'utf8');
const migration = read('supabase/migrations/20260903233021_b10_1_web_push_notifications.sql');
const subscriptionsApi = read('api/push-subscriptions.js');
const dispatchApi = read('api/push-dispatch.js');
const inboxApi = read('api/notification-inbox.js');
const inboxUi = read('admin/notification-inbox.js');
const sessionRuntime = read('admin/admin-shell-runtime.js');
const alertStability = read('admin/alert-phase2-stability.js');
const serviceWorker = read('sw.js');
const manifest = JSON.parse(read('admin/manifest.webmanifest'));
const vercel = JSON.parse(read('vercel.json'));
const pkg = JSON.parse(read('package.json'));
const envExample = read('.env.example');

for (const table of ['push_subscriptions','push_delivery_queue','web_push_runtime_state']) {
  assert.match(migration, new RegExp(`create table public\\.${table}\\b`), `falta ${table}`);
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), `falta RLS en ${table}`);
  assert.match(migration, new RegExp(`revoke all on public\\.${table} from public,anon,authenticated`), `permisos inseguros en ${table}`);
}
for (const fn of ['upsert_push_subscription','deactivate_push_subscription','push_notification_recipient_eligible','reconcile_web_push_notifications','claim_push_deliveries','complete_push_delivery']) {
  assert(migration.includes(`revoke execute on function public.${fn}`), `falta revoke para ${fn}`);
  assert(migration.includes(`grant execute on function public.${fn}`), `falta grant service_role para ${fn}`);
}
for (const marker of [
  'push_delivery_recipient_match_unique',
  'for update of q skip locked',
  "item.created_at>=subscription.activated_at",
  "s.session_version=u.session_version",
  'push_notification_recipient_eligible',
  'item.source_active=true and item.is_unread=true',
  "when item.source_active=false then 'source_inactive'",
  "source_epoch=greatest(state.source_epoch,p_now-interval '5 minutes')",
  "'task_due'",
  "'tracking_status_changed'",
  "'document_available'",
  "'integration_failure'",
  "'push.delivery.'||v_status"
]) assert(migration.includes(marker), `falta contrato SQL: ${marker}`);
assert(!/grant\s+.*\s+to\s+(public|anon|authenticated)/i.test(migration), 'no se permiten grants a roles públicos');
assert(!/jsonb_build_object\([^)]*(endpoint|p256dh|auth_secret)/is.test(migration), 'auditoría no puede copiar secretos push');

assert(subscriptionsApi.includes("authorizeAdmin(req, res, 'notifications.read')"), 'API de dispositivos debe revalidar notifications.read');
assert(subscriptionsApi.includes('p_session_version:admin.session_version'), 'suscripción debe ligarse a la sesión vigente');
assert(subscriptionsApi.includes("url.protocol !== 'https:'"), 'API de dispositivos debe validar el endpoint como URL HTTPS');
assert(subscriptionsApi.includes("hostname.endsWith('.internal')"), 'API de dispositivos debe rechazar endpoints internos');
assert(!subscriptionsApi.includes('PUSH_VAPID_PRIVATE_KEY'), 'API de dispositivos no puede leer ni devolver la clave privada');
assert(dispatchApi.includes('CRON_SECRET'), 'cron push debe validar CRON_SECRET');
assert(dispatchApi.includes('claim_push_deliveries'), 'dispatcher debe reclamar la cola de forma atómica');
assert(dispatchApi.includes('complete_push_delivery'), 'dispatcher debe cerrar cada lease');
assert(inboxApi.includes('set_notification_preferences_v2'), 'preferencias deben incluir categorías B10.1');

for (const marker of ['Notification.requestPermission()',"permission!=='granted'",'pushManager.subscribe','userVisibleOnly:true','applicationServerKey','deactivatePushForLogout','deactivatePushForInvalidSession','navigator.standalone']) {
  assert(inboxUi.includes(marker), `UI: falta ${marker}`);
}
assert(sessionRuntime.includes('response.status === 401'), 'el runtime debe reconocer 401 como transición de autenticación');
assert(sessionRuntime.includes("export-mca:auth-invalid"), 'el runtime debe emitir transición de autenticación');
assert(alertStability.includes("window.addEventListener('export-mca:auth-invalid', stop)"), 'el sondeo debe detenerse al expirar la sesión');
assert(alertStability.includes('if (!hasSession()) return null'), 'el sondeo no debe operar sin sesión');

assert.equal(pkg.dependencies['web-push'], '3.6.7', 'web-push debe estar fijado exactamente');
assert.equal(manifest.id, '/admin/', 'el manifest debe tener identidad PWA estable');
for (const size of ['192x192','512x512']) {
  const icon=manifest.icons.find(entry=>entry.sizes===size);
  assert(icon, `el manifest debe incluir icono ${size}`);
  assert(fs.existsSync(icon.src.replace(/^\//,'')), `no existe el icono ${size}`);
}
assert(vercel.crons.some(job => job.path === '/api/push-dispatch' && job.schedule === '*/5 * * * *'), 'falta cron push cada cinco minutos');
for (const key of ['PUSH_VAPID_PUBLIC_KEY','PUSH_VAPID_PRIVATE_KEY','PUSH_VAPID_SUBJECT']) assert(envExample.includes(`${key}=`), `falta ${key} en .env.example`);

const safePayload = JSON.parse(privacySafePushPayload({
  inbox_item_id:'123e4567-e89b-42d3-a456-426614174000',
  unread_count:1004,
  severity:'critical',
  deep_link:'/admin/pwa.html?notification=123e4567-e89b-42d3-a456-426614174000',
  title:'Cliente secreto', message:'Contenedor sensible', endpoint:'https://push.example/secret'
}));
assert.deepEqual(Object.keys(safePayload).sort(), ['kind','notificationId','severity','unreadCount','url','version'].sort());
assert.equal(safePayload.unreadCount, 999);
assert(!JSON.stringify(safePayload).includes('Cliente secreto'));
assert(!JSON.stringify(safePayload).includes('Contenedor sensible'));
assert(!JSON.stringify(safePayload).includes('push.example'));

assert.equal(classifyPushFailure({statusCode:410},1).status, 'expired');
assert.equal(classifyPushFailure({statusCode:404},1).status, 'expired');
assert.equal(classifyPushFailure({statusCode:503},1).status, 'retry');
assert.equal(classifyPushFailure({statusCode:503},5).status, 'failed');
assert.equal(classifyPushFailure({statusCode:400},1).status, 'failed');
const retryAfter = classifyPushFailure({statusCode:429,headers:{'retry-after':'120'}},1,new Date('2026-09-03T00:00:00Z'));
assert.equal(retryAfter.nextAttemptAt, '2026-09-03T00:02:00.000Z');
assert.equal(webPushConfig({}).ready, false);
assert.equal(webPushConfig({PUSH_VAPID_PUBLIC_KEY:'A'.repeat(87),PUSH_VAPID_PRIVATE_KEY:'B'.repeat(43),PUSH_VAPID_SUBJECT:'https://admin.exportmca.com'}).ready, true);

const listeners = {};
const shown = [];
const opened = [];
const badgeValues = [];
const workerContext = {
  URL,
  caches:{open:async()=>({addAll:async()=>{}}),keys:async()=>[],delete:async()=>true,match:async()=>null},
  self:{
    location:{origin:'https://admin.exportmca.com'},
    addEventListener:(name,handler)=>{listeners[name]=handler;},
    skipWaiting:()=>{},
    registration:{showNotification:async(title,options)=>{shown.push({title,options});}},
    clients:{claim:async()=>{},matchAll:async()=>[],openWindow:async url=>{opened.push(url);}},
    navigator:{setAppBadge:async count=>{badgeValues.push(count);},clearAppBadge:async()=>{badgeValues.push(0);}}
  }
};
vm.runInNewContext(serviceWorker,workerContext,{filename:'sw.js'});
let pushWork;
listeners.push({data:{json:()=>({notificationId:'123e4567-e89b-42d3-a456-426614174000',url:'https://evil.example',title:'Dato privado',unreadCount:7})},waitUntil:value=>{pushWork=value;}});
await pushWork;
assert.equal(shown[0].title,'Export MCA ERP');
assert.equal(shown[0].options.body,'Tienes una actualización operativa pendiente.');
assert.equal(shown[0].options.data.url,'/admin/pwa.html?notification=123e4567-e89b-42d3-a456-426614174000');
assert.equal(badgeValues.at(-1),7);
let clickWork;
listeners.notificationclick({notification:{data:{notificationId:'123e4567-e89b-42d3-a456-426614174000',url:'https://evil.example'},close:()=>{}},waitUntil:value=>{clickWork=value;}});
await clickWork;
assert.equal(opened[0],'https://admin.exportmca.com/admin/pwa.html?notification=123e4567-e89b-42d3-a456-426614174000');

assert(serviceWorker.includes("self.addEventListener('push'"), 'service worker sin evento push');
assert(serviceWorker.includes("self.addEventListener('notificationclick'"), 'service worker sin clic seguro');
assert(serviceWorker.includes('EXPORT_MCA_BADGE_CLEAR'), 'service worker sin limpieza de badge');

const windowListeners = {};
const documentListeners = {};
let alertApiMode = 'unauthorized';
let alertErrors = 0;
let intervalCalls = 0;
let clearedIntervals = 0;
const alertContext = {
  navigator:{onLine:true},
  localStorage:{getItem:key=>key==='export_mca_token'?'session-token':null},
  setTimeout,
  setInterval:()=>{intervalCalls+=1;return intervalCalls;},
  clearInterval:value=>{if(value)clearedIntervals+=1;},
  console:{error:()=>{alertErrors+=1;}},
  document:{
    readyState:'loading',hidden:false,
    documentElement:{classList:{contains:value=>value==='auth-session'}},
    addEventListener:(name,handler)=>{documentListeners[name]=handler;}
  },
  window:{
    api:async()=>{if(alertApiMode==='unauthorized'){const error=new Error('No autorizado');error.status=401;error.authTransition=true;throw error;}return{ok:true};},
    loadNotifications:async()=>{},
    addEventListener:(name,handler)=>{windowListeners[name]=handler;}
  }
};
vm.runInNewContext(alertStability,alertContext,{filename:'alert-phase2-stability.js'});
await documentListeners.DOMContentLoaded();
assert.equal(alertErrors,0,'un 401 no debe registrarse como error operativo');
assert.equal(alertContext.window.AlertPhase2Stability.isScheduled(),false,'un 401 debe dejar cero sondeos activos');
assert.equal(intervalCalls,0,'no debe crearse un intervalo después del 401');
alertApiMode='ok';
await alertContext.window.AlertPhase2Stability.resume();
assert.equal(alertContext.window.AlertPhase2Stability.isScheduled(),true,'el sondeo debe rearmarse con sesión válida');
windowListeners['export-mca:session-ending']();
assert.equal(alertContext.window.AlertPhase2Stability.isScheduled(),false,'logout debe detener el sondeo');
assert(clearedIntervals>=1,'logout debe limpiar el intervalo real');

console.log('B10.1 secure Web Push contract: OK');
