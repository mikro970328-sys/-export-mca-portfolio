import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  owner:'admin/operational-alert-center.js',
  styles:'admin/operational-alert-center.css',
  loader:'admin/erp.js',
  api:'api/history.js',
  browserstack:'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux7-alert-center-visual-owner.yml'
};

const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,value,label=value)=>{if(!source.includes(value))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) failures.push(`falta ${file}`);
}

const owner=read(files.owner);
const styles=read(files.styles);
const loader=read(files.loader);
const api=read(files.api);
const browserstack=read(files.browserstack);
const browserstackGate=read(files.browserstackGate);
const workflow=read(files.workflow);

[
  "section.dataset.alertOwner = 'operational-alert-center.js'",
  'class="alert-center-shell native-workspace-shell"',
  'class="alert-center-hero native-workspace-hero"',
  'id="alertCenterOperationalState"',
  'id="alertCenterLastUpdated"',
  'class="alert-summary-grid native-workspace-summary"',
  'id="alertMetricActive"',
  'id="alertMetricCritical"',
  'id="alertMetricUnread"',
  'id="alertMetricDelivery"',
  'class="alert-center-command"',
  'id="alertCenterSearch" type="search"',
  'class="notification-view-tabs" role="tablist"',
  'role="tab" aria-selected=',
  'id="alertCenterPanel"',
  'id="alertCenterResultCount"',
  'id="alertCenterResults"',
  'class="operational-alert-card',
  'class="alert-message-card',
  'function visibleAlerts(',
  'function visibleMessages(',
  'function summaryMetrics(',
  'function renderResultRegion(',
  'function managedDialog(',
  "event.key==='Escape'",
  "event.key!=='Tab'",
  "owner:'operational-alert-center.js'",
  'window.OperationalAlertCenter=Object.freeze',
  'window.loadNotifications=loadNotifications',
  'window.loadOperationalAlertCenter=loadNotifications'
].forEach(value=>requireText(owner,value,`owner visual ${value}`));

[
  "notification_scope==='operational'",
  "['pending','snoozed'].includes(alertStatus(row))",
  'row.condition_active===true',
  "api('/api/history?mode=notifications&scope=operational')",
  "api('/api/history?mode=notifications')",
  "await patchAlert(id,'retry')",
  'function alertActionDialog(row,action)',
  'function retryMessageDialog(row)',
  'data-alert-action="mark_read"',
  'data-message-retry=',
  'OPERATIONAL_ALERT_CENTER_UI_FAILED',
  'OPERATIONAL_ALERT_ACTION_FAILED',
  'MESSAGE_RETRY_FAILED',
  'UNIFIED_ALERT_CENTER_LOAD_ERROR',
  'No se pudo actualizar la alerta. Intenta nuevamente.',
  'No se pudo reintentar el mensaje. Intenta nuevamente.',
  'No se pudieron actualizar las alertas y mensajes. Intenta nuevamente.'
].forEach(value=>requireText(owner,value,`límite operativo ${value}`));

if ((owner.match(/error\?\.message/g)||[]).length!==0) failures.push('el owner no debe interpretar mensajes técnicos del backend');
forbid(owner,/\berror\.message\b|\be\.message\b/,'la Central de Alertas renderiza errores técnicos directamente');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'la Central de Alertas usa diálogos nativos');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'la Central de Alertas inyecta CSS desde JavaScript');
forbid(owner,/\.style(?:\.|\[)/,'la Central de Alertas muta estilos inline');
forbid(owner,/\bMutationObserver\b|\bResizeObserver\b/,'la Central de Alertas observa y recompone el DOM');
forbid(owner,/\sstyle\s*=/i,'la Central de Alertas conserva atributos style');
forbid(owner,/setInterval\s*\(|\/api\/tracking-alerts\?action=check/,'la Central de Alertas invade el scheduler P9');
forbid(owner,/<table|message-table-wrap/,'mensajes conserva una tabla ancha no responsiva');

[
  '#notificationsSection',
  '.alert-center-shell',
  '.alert-center-hero.native-workspace-hero',
  '.alert-center-hero-state',
  '.alert-summary-grid.native-workspace-summary',
  '.alert-summary.native-workspace-summary-card',
  '.alert-center-command',
  '.notification-view-tabs',
  '.alert-center-search',
  '.alert-center-panel.native-workspace-panel',
  '.alert-center-panel-head',
  '.alert-center-results',
  '.operational-alert-card',
  '.alert-message-card',
  '.alert-center-empty',
  '.alert-center-loading',
  '.alert-bell-wrap',
  '.alert-popover',
  '.alert-item-meta',
  '.alert-action-overlay',
  '.alert-action-panel',
  '.alert-center-feedback.bad',
  ':focus-visible',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:520px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value=>requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del owner');
forbid(styles,/@import|font-family\s*:\s*Arial|(?:linear|radial)-gradient/i,'operational-alert-center.css conserva importación tardía o estética legacy');

[
  "/admin/operational-alert-center.css?v=20260903-ux7alerts1",
  "/admin/operational-alert-center.js?v=20260903-ux7alerts1"
].forEach(value=>requireText(loader,value,`loader canónico ${value}`));

[
  "permission=action==='mark_read'?'notifications.read':'notifications.manage'",
  "console.error('HISTORY_MESSAGE_RETRY_FAILED'",
  "return fail(res,400,'No se pudo reenviar la notificación');",
  "console.error('HISTORY_API_ERROR',error)",
  "return fail(res,500,'No se pudo procesar la solicitud');"
].forEach(value=>requireText(api,value,`API de alertas ${value}`));
forbid(api,/return fail\(res,\s*(?:400|500),[^\n]*error\.message/,'api/history.js filtra detalles inesperados al cliente');

[
  "openSection(page, 'notificationsSection')",
  'Alert Center has one visual owner and responsive exception cards',
  'alert-center-iphone-safari',
  "alertState.owner !== 'operational-alert-center.js'",
  'alertState.metricCount !== 4',
  "item.path === '/api/history'",
  "checkpoint('alert-center-readonly'",
  'submitted:false',
  'OPERATIONAL_ALERT_CENTER_UI_FAILED'
].forEach(value=>requireText(browserstack,value,`certificación iPhone ${value}`));

[
  "openSection(page, 'notificationsSection')",
  'Alert Center has one visual owner and responsive exception cards',
  'OPERATIONAL_ALERT_CENTER_UI_FAILED'
].forEach(value=>requireText(browserstackGate,value,`gate BrowserStack ${value}`));

requireText(workflow,'node scripts/check-ux7-alert-center-visual-owner.mjs','workflow del owner de alertas');
requireText(workflow,'npm install --ignore-scripts --no-audit --no-fund','instalación reproducible de dependencias del workflow');

const openBraces=(styles.match(/{/g)||[]).length;
const closeBraces=(styles.match(/}/g)||[]).length;
if (openBraces!==closeBraces) failures.push(`operational-alert-center.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

const context=vm.createContext({
  window:{},
  document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null},
  console,
  Set,
  Map,
  Date,
  Intl,
  Promise,
  Array,
  String,
  Number,
  Object,
  Boolean,
  setTimeout:()=>0
});
context.window.window=context.window;

try {
  vm.runInContext(owner,context,{filename:files.owner});
  const alertOwner=context.window.OperationalAlertCenter;
  if (!alertOwner||alertOwner.owner!=='operational-alert-center.js') {
    failures.push('fixture: el owner canónico no quedó expuesto');
  } else {
    const alerts=[
      {id:'a1',notification_scope:'operational',severity:'critical',normalized_alert_status:'pending',title:'Tarea vencida',entity_type:'operational_task',payload:{task_title:'Validar BL'}},
      {id:'a2',notification_scope:'operational',severity:'warning',normalized_alert_status:'snoozed',read_at:'2026-09-03T10:00:00Z',title:'Contenedor sin avance',entity_type:'shipment',shipments:{container_number:'MSCU1234567'}},
      {id:'a3',notification_scope:'operational',severity:'critical',normalized_alert_status:'resolved',condition_active:true,title:'Tracking revisado'}
    ];
    const messages=[
      {id:'m1',notification_scope:'message',status:'failed',clients:{name:'Carla Díaz'},notification_type:'tracking'},
      {id:'m2',notification_scope:'message',status:'delivered',clients:{name:'Luis Pérez'},notification_type:'release'},
      {id:'m3',notification_scope:'message',status:'pending',error_message:'provider detail',clients:{name:'Eva Cruz'},notification_type:'welcome'}
    ];
    const metrics=alertOwner.summaryMetrics(alerts,messages);
    if (JSON.stringify(metrics)!==JSON.stringify({active:2,critical:1,unread:1,deliveryIssues:2})) failures.push(`fixture: métricas inesperadas ${JSON.stringify(metrics)}`);
    const critical=alertOwner.visibleAlerts(alerts,'critical','tarea');
    if (critical.length!==1||critical[0].id!=='a1') failures.push('fixture: filtro de alertas críticas o búsqueda perdió su contrato');
    const resolved=alertOwner.visibleAlerts(alerts,'resolved','tracking');
    if (resolved.length!==1||resolved[0].id!=='a3') failures.push('fixture: filtro de alertas resueltas perdió su contrato');
    const issues=alertOwner.visibleMessages(messages,'issues','carla');
    if (issues.length!==1||issues[0].id!=='m1') failures.push('fixture: filtro de incidencias de entrega perdió su contrato');
    const initial=alertOwner.getState();
    if (initial.activeView!=='operational'||initial.loading||initial.loaded) failures.push('fixture: estado inicial del owner no es seguro');
  }
} catch (error) {
  failures.push(`fixture runtime: ${error?.stack||error}`);
}

if (failures.length) {
  console.error(`UX-7 Alert Center visual owner gate failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Alert Center visual owner gate passed.');
console.log('- Alerts and WhatsApp delivery history share one responsive native owner with four operational metrics.');
console.log('- Runtime fixtures verify lifecycle filters, search, delivery issues and safe initial state without mutations.');
console.log('- Permissions, canonical P9 lifecycle, audited actions and backend error boundaries remain authoritative.');
