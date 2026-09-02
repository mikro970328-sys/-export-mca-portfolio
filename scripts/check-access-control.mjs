import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const apiDir = path.join(root, 'api');
const failures = [];

const walk = dir => fs.readdirSync(dir, { withFileTypes:true }).flatMap(entry => {
  const full = path.join(dir, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});

const relative = file => path.relative(root, file).replaceAll('\\','/');
const exemptLegacy = new Set([
  'api/_lib.js',
  'api/login.js'
]);

for (const file of walk(apiDir).filter(file => file.endsWith('.js'))) {
  const rel = relative(file);
  const src = fs.readFileSync(file, 'utf8');
  if (!exemptLegacy.has(rel) && /\brequire(?:Master)?Admin\b/.test(src)) {
    failures.push(`${rel}: todavía usa requireAdmin/requireMasterAdmin legacy`);
  }
}

const lib = fs.readFileSync(path.join(apiDir, '_lib.js'), 'utf8');
for (const required of ['export async function authenticateAdmin','export async function authorizeAdmin','admin_effective_permissions']) {
  if (!lib.includes(required)) failures.push(`api/_lib.js: falta ${required}`);
}

for (const file of ['api/account.js','api/admins.js','api/access-control.js']) {
  const src = fs.readFileSync(path.join(root,file), 'utf8');
  if (!/\b(?:authenticateAdmin|authorizeAdmin)\b/.test(src)) failures.push(`${file}: no usa autorización dinámica P3`);
}

for (const migration of [
  'supabase/migrations/20260830090500_p3_access_control_foundation.sql',
  'supabase/migrations/20260830092000_p3_access_control_setters.sql'
]) {
  if (!fs.existsSync(path.join(root,migration))) failures.push(`${migration}: falta migración P3`);
}

const frontendFiles = [
  'admin/access-control-administration.js',
  'admin/access-control.css',
  'admin/account-administration.js',
  'admin/erp.js',
  'admin/admin-data-loader.js',
  'admin/navigation-shell.js',
  'admin/operational-alert-center.js',
  'admin/alert-phase2-stability.js'
];
for (const file of frontendFiles) {
  if (!fs.existsSync(path.join(root,file))) failures.push(`${file}: falta superficie frontend P3`);
}

if (frontendFiles.every(file => fs.existsSync(path.join(root,file)))) {
  const accessUi = fs.readFileSync(path.join(root,'admin/access-control-administration.js'),'utf8');
  const accountUi = fs.readFileSync(path.join(root,'admin/account-administration.js'),'utf8');
  const loader = fs.readFileSync(path.join(root,'admin/erp.js'),'utf8');
  const dataLoader = fs.readFileSync(path.join(root,'admin/admin-data-loader.js'),'utf8');
  const accessCss = fs.readFileSync(path.join(root,'admin/access-control.css'),'utf8');
  const navigation = fs.readFileSync(path.join(root,'admin/navigation-shell.js'),'utf8');
  const alertCenter = fs.readFileSync(path.join(root,'admin/operational-alert-center.js'),'utf8');
  const alertStability = fs.readFileSync(path.join(root,'admin/alert-phase2-stability.js'),'utf8');
  const history = fs.readFileSync(path.join(root,'api/history.js'),'utf8');

  for (const required of [
    "administration.users.manage",
    "administration.roles.manage",
    "administration.teams.manage",
    "SECTION_PERMISSIONS",
    "window.ExportMcaAccessControl"
  ]) {
    if (!accessUi.includes(required)) failures.push(`admin/access-control-administration.js: falta ${required}`);
  }

  for (const required of [
    '/admin/access-control.css?v=20260830-p3',
    '/admin/access-control-administration.js?v=20260902-ux6b1',
    'window.ExportMcaAccessControl.initialize()',
    "accessCan('clients.read')",
    "accessCan('logistics.read')",
    "accessCan('notifications.read')",
    '/admin/admin-data-loader.js?v=20260830-hotfix2',
    'await window.ExportMcaAdminData.loadCore()'
  ]) {
    if (!loader.includes(required)) failures.push(`admin/erp.js: falta ${required}`);
  }

  const initializeIndex = loader.indexOf('window.ExportMcaAccessControl.initialize()');
  const coreLoadIndex = loader.indexOf('await window.ExportMcaAdminData.loadCore()');
  if (initializeIndex < 0 || coreLoadIndex < 0 || initializeIndex > coreLoadIndex) {
    failures.push('admin/erp.js: el contexto de permisos debe inicializarse antes de cargar datos del ERP');
  }

  for (const required of [
    "accessCan('clients.read')",
    "accessCan('logistics.read')",
    "accessCan('administration.users.manage')",
    "accessCan('dashboard.read')",
    'window.loadAll = loadAll;'
  ]) {
    if (!dataLoader.includes(required)) failures.push(`admin/admin-data-loader.js: falta ${required}`);
  }
  const coreStart = dataLoader.indexOf('async function loadCore()');
  const dashboardStart = dataLoader.indexOf('async function loadDashboard()');
  const coreSource = coreStart >= 0 && dashboardStart > coreStart ? dataLoader.slice(coreStart,dashboardStart) : '';
  if (!coreSource) failures.push('admin/admin-data-loader.js: no se pudo aislar loadCore');
  if (coreSource.includes('/api/dashboard')) failures.push('admin/admin-data-loader.js: loadCore no puede depender de /api/dashboard');
  if (/window\.loadAll\s*=|permissionAwareLoadAll|installPermissionAwareLoadAll/.test(accessUi)) {
    failures.push('admin/access-control-administration.js: no puede reemplazar el owner dedicado de carga de datos');
  }

  if (!accountUi.includes("account?.access_role?.name || 'Usuario'")) {
    failures.push('admin/account-administration.js: Mi cuenta no muestra el rol configurable efectivo');
  }
  if (!accountUi.includes('access-notifications-readonly')) {
    failures.push('admin/account-administration.js: falta estado visual para notificaciones read-only');
  }
  if (!accessCss.includes('[data-message-retry]') || !accessCss.includes('[data-alert-action="mark_read"]')) {
    failures.push('admin/access-control.css: faltan límites visuales read/manage de notificaciones');
  }
  if (!/action\s*===\s*['"]mark_read['"]\s*\?\s*['"]notifications\.read['"]\s*:\s*['"]notifications\.manage['"]/.test(history)) {
    failures.push('api/history.js: mark_read debe requerir notifications.read y las demás mutaciones notifications.manage');
  }

  if (navigation.includes('newOperationsSection')) {
    failures.push('admin/navigation-shell.js: no debe conservar newOperationsSection en la navegación activa');
  }
  for (const required of ["'adminsSection'","'accountSection'"]) {
    if (!navigation.includes(required)) failures.push(`admin/navigation-shell.js: Administración debe incluir ${required}`);
  }
  if (navigation.includes('nav-role-proxy') || navigation.includes('legacyAdmin')) {
    failures.push('admin/navigation-shell.js: no debe depender del proxy legacy de administración');
  }

  if (!alertCenter.includes('window.loadNotifications=loadNotifications')) {
    failures.push('admin/operational-alert-center.js: debe conservar el owner de lectura/render de alertas');
  }
  if (alertCenter.includes('/api/tracking-alerts?action=check') || alertCenter.includes('setInterval(')) {
    failures.push('admin/operational-alert-center.js: no debe ejecutar ni programar el checker P9');
  }
  const readGate = loader.indexOf("if (accessCan('notifications.read'))");
  const manageGate = loader.indexOf("if (accessCan('notifications.manage'))", readGate);
  const stabilityLoad = loader.indexOf('/admin/alert-phase2-stability.js', readGate);
  if (readGate < 0 || manageGate < 0 || stabilityLoad < 0 || !(readGate < manageGate && manageGate < stabilityLoad)) {
    failures.push('admin/erp.js: el scheduler de alertas debe cargarse solo dentro de notifications.manage');
  }
  if (!alertStability.includes('/api/tracking-alerts?action=check')) {
    failures.push('admin/alert-phase2-stability.js: falta checker canónico protegido por el loader notifications.manage');
  }
}

if (failures.length) {
  console.error('P3 access-control check failed:\n' + failures.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('P3 access-control check passed.');
