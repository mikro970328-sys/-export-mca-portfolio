import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const failures=[];
const requireText=(src,text,label=text)=>{if(!src.includes(text))failures.push(`falta ${label}`);};
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

const erp=read('admin/erp.js');
const loader=read('admin/admin-data-loader.js');
const dashboard=read('admin/dashboard-operational-state.js');
const inbox=read('admin/notification-inbox.js');

requireText(erp,"/admin/admin-data-loader.js?v=20260830-hotfix2",'loader resiliente v2 en bootstrap');
requireText(erp,'const coreResult = await window.ExportMcaAdminData.loadCore();','carga núcleo bajo owner dedicado');
requireText(erp,'authenticatedShellReady = true;','frontera de shell autenticado');
requireText(erp,'if (!authenticatedShellReady) {','solo fallos previos a autenticación pueden volver al login');
requireText(erp,"window.dispatchEvent(new CustomEvent('export-mca:admin-degraded'",'estado degradado sin expulsar sesión');
requireText(erp,'revealAdminShell();','revelado explícito del shell');
requireText(erp,'ensureVisibleSection();','garantía de sección visible');
requireText(erp,'window.ExportMcaAdminData.loadDashboard().catch','dashboard desacoplado del boot');
forbid(erp,/await\s+window\.loadAll\s*\(/,'erp.js no debe volver a bloquear boot con loadAll legacy');

const revealIndex=erp.indexOf('revealAdminShell();');
const dataLoaderIndex=erp.indexOf("loadScript('/admin/admin-data-loader.js?v=20260830-hotfix2'");
const loadCoreIndex=erp.indexOf('const coreResult = await window.ExportMcaAdminData.loadCore();');
if(revealIndex<0||dataLoaderIndex<0||loadCoreIndex<0||!(revealIndex<dataLoaderIndex&&revealIndex<loadCoreIndex)){
  failures.push('el shell autenticado debe revelarse antes de módulos/datos no críticos');
}

requireText(loader,"request('/api/clients')",'carga de clientes');
requireText(loader,"request('/api/shipments')",'carga de shipments');
requireText(loader,"accessCan('clients.read')",'permiso clients.read');
requireText(loader,"accessCan('logistics.read')",'permiso logistics.read');
requireText(loader,"accessCan('administration.users.manage')",'permiso administration.users.manage');
requireText(loader,'async function settled(key, promise)','aislamiento de fallos por fuente');
requireText(loader,'const errors = results.filter(result => !result.ok)','reporte de carga degradada');
requireText(loader,'async function loadDashboard()','dashboard separado');
const coreStart=loader.indexOf('async function loadCore()');
const dashboardStart=loader.indexOf('async function loadDashboard()');
const core=coreStart>=0&&dashboardStart>coreStart?loader.slice(coreStart,dashboardStart):'';
if(!core)failures.push('no se pudo aislar loadCore');
if(core.includes('/api/dashboard'))failures.push('loadCore no puede depender de /api/dashboard');
if(core.includes('Promise.all(jobs)')&&!core.includes('settled('))failures.push('loadCore no puede tener fallo total por una sola fuente');
requireText(loader,'window.loadAll = loadAll;','compatibilidad legacy bajo owner nuevo');

requireText(dashboard,'function renderLoading()','estado loading dashboard');
requireText(dashboard,'function renderError(error)','estado error dashboard');
requireText(dashboard,'id="dashboardRetry"','acción de reintento dashboard');
requireText(dashboard,"else renderLoading();",'initialize nunca deja dashboard vacío');
forbid(dashboard,/insertAdjacentHTML\(['"]afterbegin['"]/,'dashboard no debe acumular errores encima de contenido vacío');

requireText(inbox,"$('operationalAlertBellWrap')?.remove();",'retiro de bell P9');
requireText(inbox,"window.addEventListener('export-mca:modules-ready'",'limpieza final después de módulos');
requireText(inbox,"button.id='notificationInboxBell'",'campana P10 única');
forbid(inbox,/\bMutationObserver\b/,'hotfix no debe usar MutationObserver');
for(const [name,src] of [['admin-data-loader.js',loader],['dashboard-operational-state.js',dashboard],['notification-inbox.js',inbox]]){
  forbid(src,/\b(?:alert|prompt|confirm)\s*\(/,`${name} no debe introducir diálogos nativos`);
}

if(failures.length){
  console.error('Admin shell resilience gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('Admin shell resilience gate passed.');
