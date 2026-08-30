import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = {
  clients: 'admin/clients-module.js',
  containers: 'admin/containers-module.js',
  shipmentEditor: 'admin/shipment-editor.js',
  registrationShell: 'admin/registration-form-shell.js',
  modalDismissal: 'admin/modal-dismissal.js',
  navigation: 'admin/navigation-shell.js',
  navigationCss: 'admin/navigation-shell.css',
  sectionState: 'admin/section-state.js',
  dashboard: 'admin/dashboard-operational-state.js',
  dashboardApi: 'api/dashboard.js',
  shipmentDocumentReadiness: 'api/shipment-document-readiness.js',
  shipmentDocuments: 'api/shipment-documents.js',
  loader: 'admin/erp.js',
  index: 'admin/index.html',
  alerts: 'admin/operational-alert-center.js'
};

const retiredOwners = [
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
  'admin/client-information.js'
];

const errors = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const hasOwner = (source, owner) => new RegExp(`owner\\s*:\\s*['\"]${owner.replaceAll('.', '\\.') }['\"]`).test(source);

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) errors.push(`Falta el archivo requerido: ${file}`);
}

for (const file of [
  files.clients,
  files.containers,
  files.shipmentEditor,
  files.registrationShell,
  files.modalDismissal,
  files.navigation,
  files.sectionState,
  files.dashboard,
  files.dashboardApi,
  files.shipmentDocumentReadiness,
  files.shipmentDocuments,
  files.loader,
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
const registrationShell = read(files.registrationShell);
const modalDismissal = read(files.modalDismissal);
const navigation = read(files.navigation);
const navigationCss = read(files.navigationCss);
const sectionState = read(files.sectionState);
const dashboard = read(files.dashboard);
const dashboardApi = read(files.dashboardApi);
const shipmentDocumentReadiness = read(files.shipmentDocumentReadiness);
const shipmentDocuments = read(files.shipmentDocuments);
const loader = read(files.loader);
const index = read(files.index);
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
  'window.__registrationFormShellInstalled',
  "owner: 'registration-form-shell.js'",
  "responsibility: 'visual-guidance-only'",
  'registration-block',
  'registration-readiness'
]) {
  if (!registrationShell.includes(fragment)) errors.push(`Falta propiedad visual UX-C en registro de contenedor: ${fragment}`);
}

for (const forbidden of [
  '/api/',
  'fetch(',
  'saveShipmentRecord',
  "addEventListener('click', save",
  'window.loadAll',
  'window.ContainersModule ='
]) {
  if (registrationShell.includes(forbidden)) errors.push(`registration-form-shell.js invade lógica de negocio: ${forbidden}`);
}

for (const fragment of [
  'window.__modalDismissalInstalled',
  "owner: 'modal-dismissal.js'",
  'requestClose',
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
  'innerHTML ='
]) {
  if (modalDismissal.includes(forbidden)) errors.push(`modal-dismissal.js invade apertura/contenido del modal: ${forbidden}`);
}

for (const fragment of ['shipment_id', 'document_status', 'missing_documents']) {
  if (!shipmentDocumentReadiness.includes(fragment)) errors.push(`Falta read-model documental por contenedor: ${fragment}`);
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
  '--sidebar-collapsed:82px',
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
  "window.dispatchEvent(new CustomEvent('export-mca:section-changed'",
  'window.initializeOperationalDashboard'
]) {
  if (!sectionState.includes(fragment)) errors.push(`section-state.js perdió su responsabilidad: ${fragment}`);
}

for (const fragment of [
  "owner: 'dashboard-operational-state.js'",
  "source: 'api/dashboard.js'",
  'payload.stats',
  'payload.operations',
  'payload.recent_activity'
]) {
  if (!dashboard.includes(fragment)) errors.push(`Falta propiedad de presentación UX-B en dashboard: ${fragment}`);
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
  "owner: 'api/dashboard.js'",
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
  '/admin/registration-form-shell.js',
  '/admin/modal-dismissal.js',
  '/admin/dashboard-operational-state.js',
  '/admin/navigation-shell.js',
  '/admin/section-state.js',
  '/admin/navigation-shell.css'
]) {
  if (!loader.includes(fragment)) errors.push(`El loader no carga el propietario requerido: ${fragment}`);
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
  "document.querySelectorAll('.nav-group-btn').forEach",
  "$('sidebarToggle').onclick",
  "$('mobileMenuBtn').onclick",
  'function closeMobileMenu()'
]) {
  if (index.includes(forbidden)) errors.push(`index.html todavía posee comportamiento del shell: ${forbidden}`);
}

if (alerts.includes('nav.innerHTML')) {
  errors.push('Centro de alertas no puede reemplazar el DOM completo del botón de navegación.');
}
for (const fragment of ["nav.querySelector('.nav-icon')", "nav.querySelector('.nav-label')", 'shipment_customs_documents_missing']) {
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
console.log('- Expedientes está retirado del loader y del flujo operativo normal.');
console.log('- Tracking es dueño del readiness y carga manual de Packing List Cuba / Commercial Invoice Cuba.');
console.log('- Los propietarios/parches retirados no existen ni se cargan.');
console.log('- navigation-shell.js no contiene llamadas de negocio ni wrappers de datos.');
console.log('- UX-B usa api/dashboard.js como única proyección operativa; el frontend solo presenta esa proyección.');
console.log('- UX-C mantiene registration-form-shell.js limitado a guía visual; containers-module.js conserva guardado y validación de negocio.');
console.log('- UX-C mantiene modal-dismissal.js limitado a política de cierre; index.html conserva apertura y contenido del modal.');
console.log('- Centro de alertas conserva la propiedad de las alertas mostradas en Inicio.');
console.log('- Sintaxis JavaScript válida en los propietarios críticos.');
