import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const requiredFiles = [
  'admin/index.html',
  'admin/erp.js',
  'admin/admin-shell-runtime.js',
  'admin/admin-data-loader.js',
  'admin/access-control-administration.js',
  'admin/account-administration.js',
  'admin/workers-module.js'
];
const failures = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const requireText = (source, text, label = text) => {
  if (!source.includes(text)) failures.push(`falta ${label}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(label);
};

for (const file of requiredFiles) {
  if (!fs.existsSync(file)) failures.push(`falta ${file}`);
}
if (fs.existsSync('admin/workers.html')) {
  failures.push('admin/workers.html es un owner standalone duplicado y debe permanecer retirado');
}

const index = read('admin/index.html');
const erp = read('admin/erp.js');
const runtime = read('admin/admin-shell-runtime.js');
const loader = read('admin/admin-data-loader.js');
const access = read('admin/access-control-administration.js');
const account = read('admin/account-administration.js');

const runtimeRef = '/admin/admin-shell-runtime.js?v=20260903-ux7shelltitle1';
requireText(index, runtimeRef, 'runtime versionado del shell');
requireText(index, "/admin/navigation-shell.css?v=20260903-ux7icons2", 'CSS versionado del shell');
requireText(index, "/admin/platform-theme.css?v=20260902-ux7shell1", 'sistema visual versionado');
requireText(index, "/admin/erp.js?v=20260903-ux7icons2", 'loader versionado del shell visual');
requireText(erp, "/admin/access-control-administration.js?v=20260903-ux7access1", 'owner versionado de Usuarios y acceso');
requireText(index, '<section id="adminsSection" class="app-section hidden" aria-live="polite"></section>', 'placeholder vacío para el owner de Usuarios y acceso');
const runtimeIndex = index.indexOf(runtimeRef);
const erpIndex = index.indexOf('/admin/erp.js');
if (runtimeIndex < 0 || erpIndex < 0 || runtimeIndex > erpIndex) {
  failures.push('admin-shell-runtime.js debe cargar antes de erp.js');
}

forbid(index, /function\s+(?:loadAll|renderStats|renderDashboardDetails|renderAdmins|resetAdminPassword|changeOwnPassword)\s*\(/, 'index.html conserva lógica legacy de negocio');
forbid(index, /\b(?:prompt|alert|confirm)\s*\(/, 'index.html conserva diálogos nativos');
forbid(index, /id=["'](?:saveAdmin|adminName|adminUsername|adminPassword|changeOwnPassword)["']/, 'index.html conserva controles legacy de administración');
forbid(index, /<script>\s*const\s+\$\s*=|<script>\s*let\s+token\s*=/, 'index.html vuelve a incrustar el runtime del shell');
forbid(index, /<style(?:\s|>)/i, 'index.html vuelve a incrustar un owner CSS legacy');
forbid(index, /\sstyle\s*=/i, 'index.html vuelve a introducir estilos inline');

for (const text of [
  "owner:'admin-shell-runtime.js'",
  'async function api(path, options = {})',
  'function showSection(id)',
  'function openModal(title, html)',
  'function closeModal()',
  'function logoutNow()',
  'function bindAdminShell()'
]) requireText(runtime, text, `admin-shell-runtime.js: ${text}`);

forbid(runtime, /\b(?:prompt|alert|confirm)\s*\(/, 'admin-shell-runtime.js usa diálogos nativos');
forbid(runtime, /\bMutationObserver\b|document\.createElement\(['"]style['"]\)/, 'admin-shell-runtime.js inyecta un parche visual');
forbid(runtime, /\/api\/(?:clients|shipments|dashboard|admins)/, 'admin-shell-runtime.js invade un owner de datos o negocio');
forbid(runtime, /function\s+(?:loadAll|renderStats|renderAdmins)\s*\(/, 'admin-shell-runtime.js vuelve a poseer datos o presentación de negocio');

requireText(loader, 'window.loadAll = loadAll;', 'owner moderno de compatibilidad loadAll');
requireText(loader, "typeof window.renderClients === 'function'", 'delegación al owner de Clientes');
requireText(access, 'section.innerHTML = workspaceMarkup();', 'owner de Usuarios y acceso');
forbid(access, /window\.loadAll\s*=|permissionAwareLoadAll|installPermissionAwareLoadAll/, 'Usuarios y acceso reemplaza el owner dedicado de carga de datos');
requireText(account, "section.id = 'accountSection';", 'owner de Mi cuenta');
forbid(account, /cleanSidebarFooter|changeOwnPassword/, 'Mi cuenta compensa un control legacy que ya debe estar retirado');

for (const file of ['admin/admin-shell-runtime.js','admin/access-control-administration.js','admin/account-administration.js','admin/admin-data-loader.js']) {
  if (!fs.existsSync(file)) continue;
  const result = spawnSync(process.execPath, ['--check', file], { encoding:'utf8' });
  if (result.status !== 0) failures.push(`error de sintaxis en ${file}: ${result.stderr || result.stdout}`);
}

if (failures.length) {
  console.error(`UX6 shell ownership gate failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX6 shell ownership gate passed.');
