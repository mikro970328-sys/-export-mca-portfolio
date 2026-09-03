import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = {
  clients: 'admin/clients-module.js',
  containers: 'admin/containers-module.js',
  shipmentEditor: 'admin/shipment-editor.js',
  modalDismissal: 'admin/modal-dismissal.js',
  navigation: 'admin/navigation-shell.js',
  navigationCss: 'admin/navigation-shell.css',
  sectionState: 'admin/section-state.js',
  dashboard: 'admin/dashboard-operational-state.js',
  dashboardApi: 'api/dashboard.js',
  shipmentDocumentReadiness: 'api/shipment-document-readiness.js',
  shipmentDocuments: 'api/shipment-documents.js',
  shipmentReadinessMigration: 'supabase/migrations/20260830031800_ux2d_container_customs_document_readiness.sql',
  loader: 'admin/erp.js',
  index: 'admin/index.html',
  shellRuntime: 'admin/admin-shell-runtime.js',
  alerts: 'admin/operational-alert-center.js'
};

const retiredOwners = [
  'admin/registration-form-shell.js',
  'admin/mobile-interaction-core.js',
  'admin/operations-module.js',
  'admin/shipment-row-details.js',
  'admin/tracking-fallback.js',
  'admin/manual-tracking-switch.js',
  'admin/separate-container-tracking.js',
  'admin/shipment-actions-menu.js',
  'admin/responsive-columns-control.js',
  'admin/client-extra-fields.js',
  'admin/client-actions-menu.js',
  'admin/client-information.js',
  'admin/expedientes-module.js',
  'admin/invoice-expediente.js',
  'admin/workers-responsive.js',
  'admin/workers-actions-menu.js',
  'admin/commercial-documents-shell.js',
  'admin/commercial-documents-loads.js',
  'admin/commercial-documents-invoices.js',
  'admin/warehouse-embedded.js'
];

const errors = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const hasOwner = (source, owner) => new RegExp(`owner\\s*:\\s*['\"]${owner.replaceAll('.', '\\.')}['\"]`).test(source);

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) errors.push(`Falta el archivo requerido: ${file}`);
}

for (const file of [
  files.clients,
  files.containers,
  files.shipmentEditor,
  files.modalDismissal,
  files.navigation,
  files.sectionState,
  files.dashboard,
  files.dashboardApi,
  files.shipmentDocumentReadiness,
  files.shipmentDocuments,
  files.loader,
  files.shellRuntime,
  files.alerts
]) {
  if (!fs.existsSync(file)) continue;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(`Error de sintaxis en ${file}:\n${result.stderr || result.stdout}`);
}

for (const file of retiredOwners) {
  if (fs.existsSync(file)) errors.push(`Propietario/parche retirado todavía existe: ${file}`);
}

const clients = read(files.clients);
const containers = read(files.containers);
const modalDismissal = read(files.modalDismissal);
const navigation = read(files.navigation);
const navigationCss = read(files.navigationCss);
const sectionState = read(files.sectionState);
const dashboard = read(files.dashboard);
const dashboardApi = read(files.dashboardApi);
const shipmentDocumentReadiness = read(files.shipmentDocumentReadiness);
const shipmentDocuments = read(files.shipmentDocuments);
const shipmentReadinessMigration = read(files.shipmentReadinessMigration);
const loader = read(files.loader);
const index = read(files.index);
const shellRuntime = read(files.shellRuntime);
const alerts = read(files.alerts);

for (const fragment of [
  'window.__clientsModuleInstalled',
  'clientImporters',
  'syncImporters',
  'export-mca:clients-changed'
]) {
  if (!clients.includes(fragment)) errors.push(`Falta propiedad consolidada de Clientes: ${fragment}`);
}

for (const fragment of ['MutationObserver', 'cloneNode(', 'replaceWith(']) {
  if (clients.includes(fragment)) errors.push(`Patrón de parche prohibido en ${files.clients}: ${fragment}`);
}

for (const fragment of [
  'window.__containersModuleInstalled',
  'Array.isArray(window.shipments)',
  'Array.isArray(window.clients)',
  '/api/shipment-document-readiness',
  'Packing List Cuba',
  'Factura comercial Cuba',
  'window.ContainersModule=Object.freeze'
]) {
  if (!containers.includes(fragment)) errors.push(`Falta propiedad consolidada de Tracking: ${fragment}`);
}
if (!hasOwner(containers, 'containers-module.js')) errors.push('Falta propiedad consolidada de Tracking: owner containers-module.js');
if (/Ver expediente/i.test(containers)) errors.push('Tracking todavía expone Expediente en su flujo visual.');
for (const fragment of [
  'function syncContainerGuidance()',
  "trackingOwner:'containers-module.js'",
  "registrationOwner:'containers-module.js'"
]) {
  if (!containers.includes(fragment)) errors.push(`Falta propiedad consolidada de registro + Tracking: ${fragment}`);
}
for (const fragment of [
  'id="shipmentRegistrationForm"',
  'id="registrationReadiness"',
  'id="containersSection"',
  'data-owner="containers-module.js"'
]) {
  if (!index.includes(fragment)) errors.push(`Falta estructura estática canónica de registro + Tracking: ${fragment}`);
}

for (const fragment of [
  'window.__modalDismissalInstalled',
  "owner: 'modal-dismissal.js'",
  'requestClose',
  'confirmDiscard',
  'modal-dismissal-decision',
  'Seguir editando',
  'Descartar cambios',
  "event.key !== 'Escape'",
  'event.target === modal',
  'Hay cambios sin guardar'
]) {
  if (!modalDismissal.includes(fragment)) errors.push(`Falta política UX-C de cierre modal: ${fragment}`);
}

for (const forbidden of [
  '/api/',
  'fetch(',
  'window.openModal =',
  'window.closeModal =',
  'innerHTML =',
  'window.confirm(',
  '.style.'
]) {
  if (modalDismissal.includes(forbidden)) errors.push(`modal-dismissal.js invade apertura/contenido del modal: ${forbidden}`);
}

for (const fragment of ['shipment_customs_document_readiness', 'shipment_id', 'readiness:']) {
  if (!shipmentDocumentReadiness.includes(fragment)) errors.push(`Falta read-model documental por contenedor: ${fragment}`);
}
for (const fragment of ['document_status', 'missing_documents', 'Packing List Cuba', 'Commercial Invoice Cuba']) {
  if (!shipmentReadinessMigration.includes(fragment)) errors.push(`La fuente autoritativa de readiness perdió su contrato: ${fragment}`);
}
for (const fragment of ['Packing List Cuba', 'Commercial Invoice Cuba', 'shipment_id', 'prepare_upload', 'finalize_upload']) {
  if (!shipmentDocuments.includes(fragment)) errors.push(`Falta propiedad de documentos Cuba por contenedor: ${fragment}`);
}

for (const fragment of [
  'window.__navigationShellInstalled',
  'export_mca_sidebar_collapsed',
  'export_mca_nav_groups',
  'sidebar-collapsed',
  'export-mca:section-changed',
  "owner: 'navigation-shell.js'"
]) {
  if (!navigation.includes(fragment)) errors.push(`Falta propiedad estructural de navegación: ${fragment}`);
}

for (const forbidden of [
  '/api/',
  'window.loadAll',
  'window.loadNotifications',
  'window.loadOperationalAlerts'
]) {
  if (navigation.includes(forbidden)) errors.push(`navigation-shell.js invade lógica de negocio: ${forbidden}`);
}

for (const fragment of [
  '--sidebar-collapsed:80px',
  'body.sidebar-collapsed .sidebar',
  'body.sidebar-collapsed .main-shell',
  '@media(min-width:901px)',
  '@media(max-width:900px)',
  'touch-action:manipulation'
]) {
  if (!navigationCss.includes(fragment)) errors.push(`Falta comportamiento visual UX-A: ${fragment}`);
}

for (const fragment of [
  'const originalShowSection = window.showSection',
  'accessControl.sectionAllowed(id)',
  "window.dispatchEvent(new CustomEvent('export-mca:section-changed'",
  'window.initializeOperationalDashboard'
]) {
  if (!sectionState.includes(fragment)) errors.push(`section-state.js perdió su responsabilidad: ${fragment}`);
}
if (/workersSection[^\n]+master_admin|adminsSection[^\n]+master_admin/.test(sectionState)) {
  errors.push('section-state.js vuelve a inferir acceso a secciones por rol en vez de permisos efectivos.');
}

for (const fragment of [
  "owner:'dashboard-operational-state.js'",
  'data.stats',
  'data.executive',
  'data.recent_activity',
  'window.ExecutiveDashboard=Object.freeze'
]) {
  if (!dashboard.includes(fragment)) errors.push(`Falta propiedad de presentación UX-B/P11 en dashboard: ${fragment}`);
}

for (const forbidden of [
  'function classifyShipment',
  'function calculateOperationalStats',
  'Array.isArray(window.shipments)',
  'window.loadAll ='
]) {
  if (dashboard.includes(forbidden)) errors.push(`Dashboard frontend vuelve a calcular o interceptar datos: ${forbidden}`);
}

for (const fragment of [
  "owner:'api/dashboard.js'",
  'function classifyShipment',
  'function buildShipmentStats',
  'function buildOperationStats',
  'recent_activity:'
]) {
  if (!dashboardApi.includes(fragment)) errors.push(`Falta proyección operativa única del backend UX-B: ${fragment}`);
}

for (const fragment of [
  '/admin/clients-module.js',
  '/admin/containers-module.js',
  '/admin/modal-dismissal.js',
  '/admin/dashboard-operational-state.js',
  '/admin/navigation-shell.js',
  '/admin/section-state.js'
]) {
  if (!loader.includes(fragment)) errors.push(`El loader no carga el propietario requerido: ${fragment}`);
}
if (!index.includes('/admin/navigation-shell.css?v=20260903-ux7icons2')) {
  errors.push('index.html no carga el owner visual versionado de navegación desde head.');
}
if (loader.includes('/admin/expedientes-module.js')) errors.push('El loader todavía carga Expedientes, que UX-2D retiró del flujo operativo.');

for (const retired of retiredOwners) {
  if (loader.includes(retired.replace('admin/', '/admin/'))) {
    errors.push(`El loader todavía carga un propietario retirado: ${retired}`);
  }
}

for (const fragment of [
  'data-nav-label="Inicio"',
  'data-nav-group="operations"',
  'id="sidebarToggle"',
  'id="mobileMenuBtn"',
  'class="nav-icon"',
  'class="nav-label"'
]) {
  if (!index.includes(fragment)) errors.push(`Falta estructura semántica del sidebar: ${fragment}`);
}

for (const forbidden of [
  'data-section="newOperationsSection"',
  'id="newOperationsSection"',
  'newOperationsSection:',
  'data-nav-label="Expedientes de exportación"',
  '<span class="nav-label">Expedientes</span>'
]) {
  if (index.includes(forbidden)) errors.push(`Expedientes todavía aparece en el shell estático: ${forbidden}`);
}

for (const forbidden of [
  "document.querySelectorAll('.nav-group-btn').forEach",
  "$('sidebarToggle').onclick",
  "$('mobileMenuBtn').onclick",
  'function closeMobileMenu()'
]) {
  if (index.includes(forbidden)) errors.push(`index.html todavía posee comportamiento del shell: ${forbidden}`);
}

if (!index.includes('/admin/admin-shell-runtime.js?v=20260903-ux7shelltitle1')) {
  errors.push('index.html no carga el runtime estructural versionado antes del ERP.');
}
if (index.indexOf('/admin/admin-shell-runtime.js?v=20260903-ux7shelltitle1') > index.indexOf('/admin/erp.js')) {
  errors.push('index.html debe cargar admin-shell-runtime.js antes de erp.js.');
}
for (const fragment of [
  "owner:'admin-shell-runtime.js'",
  'async function api(path, options = {})',
  'function showSection(id)',
  'function openModal(title, html)',
  'function closeModal()',
  'function logoutNow()'
]) {
  if (!shellRuntime.includes(fragment)) errors.push(`Falta responsabilidad base del runtime del shell: ${fragment}`);
}
for (const forbidden of [
  'function loadAll(',
  'function renderStats(',
  'function renderAdmins(',
  '/api/clients',
  '/api/shipments',
  '/api/dashboard',
  '/api/admins'
]) {
  if (shellRuntime.includes(forbidden)) errors.push(`admin-shell-runtime.js invade un owner de negocio: ${forbidden}`);
}

if (alerts.includes('nav.innerHTML')) {
  errors.push('Centro de alertas no puede reemplazar el DOM completo del botón de navegación.');
}
for (const fragment of ["window.ExportMcaIcons?.hydrate?.(nav)", "nav.querySelector('.nav-label')", 'shipment_customs_documents_missing']) {
  if (!alerts.includes(fragment)) errors.push(`Centro de alertas no preserva su propiedad visual/documental: ${fragment}`);
}
if (!/const\s+target\s*=\s*\$\(['\"]alerts['\"]\)/.test(alerts)) errors.push('Centro de alertas no preserva la superficie de alertas de Inicio.');

if (!loader.includes('decodeURIComponent(')) errors.push('El loader no contiene decodeURIComponent() válido.');
if (/\bdeURIComponent\s*\(/.test(loader)) errors.push('El loader contiene el error tipográfico deURIComponent().');

if (errors.length) {
  console.error('Validación de propiedad frontend fallida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validación de propiedad frontend superada.');
console.log('- Clientes, Tracking, documentos Cuba, navegación, dashboard, UX-C y estado de secciones tienen propietarios explícitos.');
console.log('- Expedientes está retirado del loader y del shell estático del flujo operativo normal.');
console.log('- Tracking es dueño del readiness y carga manual de Packing List Cuba / Commercial Invoice Cuba.');
console.log('- Los propietarios/parches retirados no existen ni se cargan.');
console.log('- navigation-shell.js no contiene llamadas de negocio ni wrappers de datos.');
console.log('- UX-B/P11 usa api/dashboard.js como proyección operativa; el frontend solo presenta la proyección ejecutiva recibida.');
console.log('- UX-C consolida registro, guía visual y Tracking en containers-module.js; el shell dinámico anterior permanece retirado.');
console.log('- UX-C mantiene modal-dismissal.js limitado a política de cierre; index.html conserva apertura y contenido del modal.');
console.log('- Centro de alertas conserva la propiedad de las alertas mostradas en Inicio.');
console.log('- Sintaxis JavaScript válida en los propietarios críticos.');
