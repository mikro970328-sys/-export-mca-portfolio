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
  'admin/erp.js'
];
for (const file of frontendFiles) {
  if (!fs.existsSync(path.join(root,file))) failures.push(`${file}: falta superficie frontend P3`);
}

if (frontendFiles.every(file => fs.existsSync(path.join(root,file)))) {
  const accessUi = fs.readFileSync(path.join(root,'admin/access-control-administration.js'),'utf8');
  const accountUi = fs.readFileSync(path.join(root,'admin/account-administration.js'),'utf8');
  const loader = fs.readFileSync(path.join(root,'admin/erp.js'),'utf8');
  const accessCss = fs.readFileSync(path.join(root,'admin/access-control.css'),'utf8');
  const history = fs.readFileSync(path.join(root,'api/history.js'),'utf8');

  for (const required of [
    "administration.users.manage",
    "administration.roles.manage",
    "administration.teams.manage",
    "SECTION_PERMISSIONS",
    "installPermissionAwareLoadAll",
    "window.ExportMcaAccessControl"
  ]) {
    if (!accessUi.includes(required)) failures.push(`admin/access-control-administration.js: falta ${required}`);
  }

  for (const required of [
    '/admin/access-control.css?v=20260830-p3',
    '/admin/access-control-administration.js?v=20260830-p3',
    'window.ExportMcaAccessControl.initialize()',
    "accessCan('clients.read')",
    "accessCan('logistics.read')",
    "accessCan('notifications.read')"
  ]) {
    if (!loader.includes(required)) failures.push(`admin/erp.js: falta ${required}`);
  }

  const initializeIndex = loader.indexOf('window.ExportMcaAccessControl.initialize()');
  const loadAllIndex = loader.indexOf('await window.loadAll()');
  if (initializeIndex < 0 || loadAllIndex < 0 || initializeIndex > loadAllIndex) {
    failures.push('admin/erp.js: el contexto de permisos debe inicializarse antes de loadAll');
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
  if (!history.includes("action === 'mark_read' ? 'notifications.read' : 'notifications.manage'")) {
    failures.push('api/history.js: mark_read debe requerir notifications.read y las demás mutaciones notifications.manage');
  }
}

if (failures.length) {
  console.error('P3 access-control check failed:\n' + failures.map(item => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('P3 access-control check passed.');
