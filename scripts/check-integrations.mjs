import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const exists=rel=>fs.existsSync(path.join(root,rel));
const read=rel=>fs.readFileSync(path.join(root,rel),'utf8');
const requireText=(file,text,label=text)=>{if(!read(file).includes(text))failures.push(`${file}: falta ${label}`);};
const forbid=(file,re,label)=>{if(re.test(read(file)))failures.push(`${file}: ${label}`);};

const retiredFiles=[
  'api/_shipsgo.js',
  'api/_integration-events.js',
  'api/shipsgo-webhook.js',
  'api/shipsgo-error-alerts.js',
  'api/tracking-mode.js'
];
for(const file of retiredFiles)if(exists(file))failures.push(`${file}: ShipsGo retirado no puede permanecer en runtime`);

const runtimeFiles=[
  'api/shipments-register.js',
  'api/loads.js',
  'api/direct-shipment-dispatch.js',
  'api/manual-tracking-event.js',
  'api/manual-tracking-alerts.js',
  'api/stagnant-shipment-alerts.js',
  'admin/containers-module.js',
  'vercel.json',
  '.env.example'
];
for(const file of runtimeFiles){
  if(!exists(file)){failures.push(`${file}: falta owner runtime`);continue;}
  forbid(file,/shipsgo/i,'no puede conservar dependencia, copy ni acción ShipsGo');
  forbid(file,/\/api\/tracking-mode/i,'no puede conservar modo de proveedor');
  forbid(file,/retry_shipsgo/i,'no puede conservar reconexión a proveedor');
}

// Only immutable history/tombstones may still name the retired provider.
const shipsGoTextAllowlist=new Set([
  'api/tracking-alerts.js',                 // closes historical alert cycles
  'api/shipments.js',                       // rejects the retired legacy action explicitly
  'admin/shipment-timeline.js',             // renders immutable historical provider events
  'admin/operational-alert-center.js'       // renders immutable historical provider alert labels
]);
function walkRuntime(dir){
  const absolute=path.join(root,dir);
  if(!fs.existsSync(absolute))return;
  for(const entry of fs.readdirSync(absolute,{withFileTypes:true})){
    const rel=path.join(dir,entry.name).replaceAll('\\','/');
    if(entry.isDirectory()){walkRuntime(rel);continue;}
    if(!/\.(?:js|mjs|html|json)$/.test(entry.name))continue;
    const src=read(rel);
    if(/shipsgo/i.test(src)&&!shipsGoTextAllowlist.has(rel))failures.push(`${rel}: referencia ShipsGo residual fuera de allowlist histórica`);
  }
}
walkRuntime('api');
walkRuntime('admin');

const historicalAlertCenter=read('admin/operational-alert-center.js');
if(!historicalAlertCenter.includes("shipsgo_tracking_failed:'Error ShipsGo'"))failures.push('admin/operational-alert-center.js: debe conservar etiqueta histórica del proveedor para auditoría');
forbid('admin/operational-alert-center.js',/\/api\/(?:shipsgo|tracking-mode)|retry_shipsgo|SHIPSGO_/i,'allowlist histórica no puede esconder consumo activo del proveedor');

const notificationOwner='api/_notification-delivery.js';
for(const text of ["new Set(['DEPA', 'RELEASE'])",'whatsappDeliveryKey','claim_notification_dispatch','release_notification_dispatch_claim'])requireText(notificationOwner,text);
for(const blocked of ['LOAD','ARRV','DISC','DELIVERED','GTOT'])forbid(notificationOwner,new RegExp(`['\"]${blocked}['\"]`),`no puede habilitar ${blocked} para WhatsApp`);

const manual='api/manual-tracking-event.js';
for(const text of ['TWILIO_DEPARTED_CONTENT_SID','TWILIO_RELEASE_CONTENT_SID','whatsappMilestoneAllowed',"tracking_source:'erp'"])requireText(manual,text);
for(const forbidden of ['TWILIO_CONTENT_SID','TWILIO_DELIVERED_CONTENT_SID','TWILIO_REGISTERED_CONTENT_SID'])forbid(manual,new RegExp(forbidden),`no puede usar ${forbidden}`);
requireText(manual,"load: { order:1, status:'Cargado en el buque', eventType:'LOAD' }");
requireText(manual,"arrived: { order:3, status:'Llegó al puerto', eventType:'ARRV' }");
requireText(manual,"discharged: { order:4, status:'Descargado del buque', eventType:'DISC' }");
requireText(manual,"delivered: { order:6, status:'Entregado', eventType:'DELIVERED' }");

const shipments='api/shipments.js';
for(const text of ["tracking_source:'erp'",'assertShipmentCanBeDeleted','TWILIO_RELEASE_CONTENT_SID',"claimNotificationDelivery(shipment.id,'RELEASE'"])requireText(shipments,text);
forbid(shipments,/registerShipsGo|deleteShipsGoTracking|activateTracking\s*\(/,'no puede llamar tracking externo');
requireText(shipments,"body.action === 'send_test_whatsapp') return fail(res,410",'debe bloquear envío arbitrario de WhatsApp heredado');
requireText(shipments,"action === 'manual_notification') return fail(res,410",'debe bloquear plantillas manuales heredadas');
requireText(shipments,"action === 'retry_shipsgo') return fail(res,410",'debe bloquear reconexión heredada sin llamar proveedor');

// Welcome is intentionally manual and repeatable. Saving a client must never send it.
const clientsFile='api/clients.js';
const clients=read(clientsFile);
requireText(clientsFile,'TWILIO_WELCOME_CONTENT_SID','debe conservar plantilla de bienvenida');
requireText(clientsFile,"body.action === 'resend_welcome'",'debe conservar acción manual y repetible de bienvenida');
requireText(clientsFile,"return ok(res, { client, welcome: { status: 'pending' } });",'crear cliente debe dejar bienvenida pendiente sin enviarla');
const clientPostStart=clients.indexOf("if (req.method === 'POST')");
const clientPatchStart=clients.indexOf("if (req.method === 'PATCH')");
const clientPost=clientPostStart>=0&&clientPatchStart>clientPostStart?clients.slice(clientPostStart,clientPatchStart):'';
if(!clientPost)failures.push('api/clients.js: no se pudo aislar POST de creación de cliente');
else if(/sendWelcome\s*\(|sendWhatsApp\s*\(/.test(clientPost))failures.push('api/clients.js: guardar cliente no puede enviar bienvenida automáticamente');

const clientsUiFile='admin/clients-module.js';
const clientsUi=read(clientsUiFile);
for(const text of ["action==='welcome')welcome(id)",'Reenviar bienvenida','Enviar bienvenida'])requireText(clientsUiFile,text,'debe conservar acción manual Enviar/Reenviar bienvenida');
const saveStart=clientsUi.indexOf('async function save()');
const menuStart=clientsUi.indexOf('function ensureMenu()',saveStart);
const saveBlock=saveStart>=0&&menuStart>saveStart?clientsUi.slice(saveStart,menuStart):'';
if(!saveBlock)failures.push('admin/clients-module.js: no se pudo aislar flujo Guardar cliente');
else if(/\bwelcome\s*\(|resend_welcome/.test(saveBlock))failures.push('admin/clients-module.js: Guardar cliente no puede disparar bienvenida');

const twilio='api/twilio-status.js';
for(const text of ['validateTwilioRequest({','rpc/reconcile_twilio_delivery_status'])requireText(twilio,text);

const ui='admin/containers-module.js';
for(const text of ['Seguimiento ERP',"{key:'departed',label:'Salió del puerto',whatsapp:true}","{key:'released',label:'Liberado',whatsapp:true}"])requireText(ui,text);
forbid(ui,/Reconectar|Volver a automático|Cambiar a manual/i,'no puede ofrecer acciones de proveedor retirado');
forbid(ui,/manualTrackingNotify/,'WhatsApp ya no es checkbox arbitrario');

const alerts='api/tracking-alerts.js';
requireText(alerts,"'shipsgo_tracking_failed'",'debe cerrar condición histórica de proveedor');
forbid(alerts,/shipsgo_status|shipsgo_link_mode/i,'alertas activas no pueden depender del proveedor retirado');
requireText(alerts,"closeCondition(row,'external_tracking_retired'",'debe retirar condiciones automáticas antiguas');

const manualAlerts='api/manual-tracking-alerts.js';
requireText(manualAlerts,"tracking_source:'erp'",'supervisión debe usar tracking ERP');
forbid(manualAlerts,/shipsgo_status|shipsgo_link_mode/i,'supervisión ERP no puede filtrar por proveedor');

const migration='supabase/migrations/20260831102000_p19_retire_shipsgo_limit_whatsapp.sql';
if(!exists(migration))failures.push(`${migration}: falta migración P19`);
else{
  for(const text of ["v_key not in ('tracking:DEPA','tracking:RELEASE')","NOTIFICATION_DELIVERY_KEY_NOT_ALLOWED","'external_tracking_retired'","'shipsgo_tracking_failed'"])requireText(migration,text);
}
const fixture='supabase/tests/p19_integration_scope.sql';
if(!exists(fixture))failures.push(`${fixture}: falta fixture P19`);
else{
  for(const text of ['begin;','rollback;','P19_LOAD_CLAIM_WAS_NOT_BLOCKED','P19_DELIVERED_CLAIM_WAS_NOT_BLOCKED','shipment_fixture_residue','claim_fixture_residue'])requireText(fixture,text);
  forbid(fixture,/\bcommit\s*;/i,'fixture reversible no puede hacer COMMIT');
}

const env=read('.env.example');
for(const required of ['TWILIO_WELCOME_CONTENT_SID','TWILIO_DEPARTED_CONTENT_SID','TWILIO_RELEASE_CONTENT_SID','TWILIO_STATUS_CALLBACK_URL'])if(!env.includes(required))failures.push(`.env.example: falta ${required}`);
for(const forbidden of ['SHIPSGO_','TWILIO_CONTENT_SID','TWILIO_DELIVERED_CONTENT_SID','TWILIO_REGISTERED_CONTENT_SID'])if(env.includes(forbidden))failures.push(`.env.example: no debe contener ${forbidden}`);

const vercel=read('vercel.json');
if(/shipsgo/i.test(vercel))failures.push('vercel.json: no puede conservar cron ShipsGo');

if(failures.length){
  console.error('P19 integration scope gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('P19 integration scope gate passed: ShipsGo retired; WhatsApp limited to manual/repeatable welcome plus automatic departure and release.');
