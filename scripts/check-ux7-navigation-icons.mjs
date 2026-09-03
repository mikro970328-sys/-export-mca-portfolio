import { readFile } from 'node:fs/promises';

const sources = Object.freeze({
  icons: 'admin/ui-icon-system.js',
  navigation: 'admin/navigation-shell.js',
  navigationCss: 'admin/navigation-shell.css',
  index: 'admin/index.html',
  loader: 'admin/erp.js',
  tasks: 'admin/tasks-workspace.js',
  account: 'admin/account-administration.js',
  alerts: 'admin/operational-alert-center.js',
  alertCss: 'admin/operational-alert-center.css',
  inbox: 'admin/notification-inbox.js',
  inboxCss: 'admin/notification-inbox.css',
  dashboard: 'admin/dashboard-operational-state.js',
  serviceWorker: 'sw.js',
  browserStackTest: 'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserStackWorkflow: '.github/workflows/browserstack-ios-certification.yml'
});

const entries = await Promise.all(Object.entries(sources).map(async ([key, path]) => [key, await readFile(path, 'utf8')]));
const files = Object.fromEntries(entries);
const failures = [];

function requireText(source, fragment, label) {
  if (!source.includes(fragment)) failures.push(`Falta ${label}: ${fragment}`);
}

function forbid(source, pattern, label) {
  if (pattern.test(source)) failures.push(label);
}

const expectedLabels = Object.freeze({
  'Inicio': 'home',
  'Mis tareas': 'tasks',
  'Centro de alertas': 'bell',
  'Comercial': 'commercial',
  'Clientes': 'clients',
  'Ventas': 'sales',
  'Facturación': 'invoices',
  'Publicaciones comerciales': 'publications',
  'Operaciones': 'operations',
  'Compras': 'purchases',
  'Almacén': 'warehouse',
  'Inventario': 'inventory',
  'Cargues': 'loads',
  'Tracking': 'tracking',
  'Registrar contenedor': 'containerAdd',
  'Finanzas': 'finance',
  'Cuentas por pagar': 'payables',
  'Costos y rentabilidad': 'costs',
  'Reportes': 'reports',
  'Administración': 'settings',
  'Proveedores': 'suppliers',
  'Productos': 'products',
  'Trabajadores': 'workers',
  'Mi cuenta': 'account',
  'Usuarios y acceso': 'admin',
  'Cerrar sesión': 'logout'
});

for (const [label, icon] of Object.entries(expectedLabels)) {
  requireText(files.icons, `'${label}': '${icon}'`, `mapeo canónico de ${label}`);
  requireText(files.icons, `${icon}:`, `geometría SVG de ${icon}`);
}

for (const fragment of [
  'data-ui-icon="${name}"',
  'viewBox="0 0 24 24"',
  'aria-hidden="true"',
  'focusable="false"',
  "owner: 'ui-icon-system.js'",
  "icon.dataset.iconMissing = 'true'",
  "window.ExportMcaIcons = Object.freeze"
]) requireText(files.icons, fragment, `contrato del owner SVG`);

forbid(files.icons, /MutationObserver/, 'ui-icon-system.js no debe depender de un observer compensatorio.');
forbid(files.icons, /createElement\(['"]style['"]\)/, 'ui-icon-system.js no debe inyectar estilos inline.');
forbid(files.icons, /paths\[name\]\s*\|\|/, 'Un icono desconocido no debe camuflarse con un SVG incorrecto.');
forbid(files.icons, /https?:\/\/|<img\b|@font-face|font-family/i, 'El owner de iconos no puede depender de CDN, raster o icon fonts.');

for (const fragment of [
  '.ui-icon-svg{',
  'stroke-width:1.8',
  '.nav-icon .ui-icon-svg{width:20px;height:20px}',
  '.nav-group-btn .nav-icon .ui-icon-svg{width:21px;height:21px}',
  '.nav-chevron .ui-icon-svg{width:15px;height:15px}',
  'body.sidebar-collapsed .sidebar-nav .nav-icon .ui-icon-svg{width:21px;height:21px}',
  '@media(max-width:900px)',
  '@media(hover:none),(pointer:coarse)',
  '@media(prefers-reduced-motion:reduce)'
]) requireText(files.navigationCss, fragment, 'geometría y estados visuales del sistema');

const legacyGlyphs = /[⌂▣●＋◎▦✉♟◉↪▥◫◩▤▧▨▩◇⇄🔔]/u;
for (const [name, source] of [
  ['index.html', files.index],
  ['navigation-shell.js', files.navigation],
  ['tasks-workspace.js', files.tasks],
  ['operational-alert-center.js', files.alerts],
  ['notification-inbox.js', files.inbox]
]) forbid(source, legacyGlyphs, `${name} conserva un glifo o emoji heredado en la navegación.`);

forbid(files.index, /<svg\b/i, 'index.html no debe convertirse en un segundo owner de SVG.');
forbid(files.navigation, /<svg\b|\bicon\s*:/i, 'navigation-shell.js debe pedir hidratación al owner, no definir iconos.');
forbid(files.tasks, /function\s+taskIcon\b|<svg\b/i, 'Mis tareas conserva un SVG propio fuera del owner canónico.');
forbid(files.alerts, /icon\.textContent|<svg\b/i, 'Centro de alertas conserva una mutación o SVG propio para el icono.');
forbid(files.inbox, /<svg\b/i, 'Inbox conserva un SVG propio para la campana superior.');

for (const fragment of [
  '<span class="nav-icon" aria-hidden="true"></span>',
  '<span class="nav-chevron" aria-hidden="true"></span>',
  'window.ExportMcaIcons?.hydrate?.(nav)'
]) requireText(files.navigation, fragment, 'delegación de navigation-shell al owner SVG');
requireText(files.tasks, 'window.ExportMcaIcons?.hydrate?.(button)', 'hidratación explícita de Mis tareas');
requireText(files.account, 'window.ExportMcaIcons?.hydrate?.(adminNav)', 'hidratación explícita de Mi cuenta y Usuarios y acceso');
requireText(files.alerts, 'window.ExportMcaIcons?.hydrate?.(wrap)', 'hidratación explícita de la campana superior');
requireText(files.alerts, 'window.ExportMcaIcons?.hydrate?.(nav)', 'hidratación explícita de Centro de alertas');
requireText(files.inbox, 'window.ExportMcaIcons?.hydrate?.(button)', 'hidratación explícita de la campana del Inbox');

for (const fragment of [
  "products:'products'",
  "suppliers:'suppliers'",
  "warehouse:'warehouse'",
  "loads:'loads'",
  "inventory:'inventory'",
  "tasks:'tasks'",
  "invoices:'invoices'",
  "payables:'payables'",
  "costs:'costs'"
]) requireText(files.dashboard, fragment, 'iconografía semántica del Dashboard');

for (const fragment of [
  '/admin/navigation-shell.css?v=20260903-ux7icons2',
  '/admin/erp.js?v=20260903-ux7icons2'
]) requireText(files.index, fragment, 'revisión de caché del shell');

for (const fragment of [
  "loadScript('/admin/ui-icon-system.js?v=20260903-ux7icons2', 'data-ui-icon-system')",
  "loadScript('/admin/navigation-shell.js?v=20260903-ux7icons2', 'data-navigation-shell')",
  "loadScript('/admin/tasks-workspace.js?v=20260903-ux7tasks1', 'data-tasks-workspace')",
  "loadScript('/admin/account-administration.js?v=20260903-ux7account1', 'data-account-administration')",
  "loadStylesheet('/admin/operational-alert-center.css?v=20260903-ux7alerts1', 'data-operational-alert-center-style')",
  "loadScript('/admin/operational-alert-center.js?v=20260903-ux7alerts1', 'data-operational-alert-center')",
  "loadStylesheet('/admin/notification-inbox.css?v=20260903-ux7icons2', 'data-notification-inbox-style')",
  "loadScript('/admin/notification-inbox.js?v=20260903-ux7icons2', 'data-notification-inbox')",
  "loadScript('/admin/dashboard-operational-state.js?v=20260903-ux7icons2', 'data-dashboard-operational-state')"
]) requireText(files.loader, fragment, 'carga versionada del sistema');

const iconReady = files.loader.indexOf('await iconSystemPromise;');
const shellReveal = files.loader.indexOf('revealAdminShell();');
if (iconReady < 0 || shellReveal < 0 || iconReady > shellReveal) failures.push('El shell autenticado puede mostrarse antes de que sus iconos estén listos.');

requireText(files.serviceWorker, "const CACHE='export-mca-shell-v4'", 'renovación del caché PWA');
requireText(files.alertCss, '.alert-bell>.ui-icon-svg', 'geometría canónica de la campana superior');
requireText(files.inboxCss, '.notification-inbox-bell>.ui-icon-svg', 'geometría canónica de la campana del Inbox');

for (const fragment of [
  'Navigation uses one canonical SVG icon system',
  'navigation-icons-iphone-safari',
  "state.owner !== 'ui-icon-system.js'",
  "page.locator('#notificationInboxBell')",
  'state.dashboardDistinctIcons < 8',
  'legacyGlyphs: false',
  'state.scrollWidth !== state.clientWidth'
]) requireText(files.browserStackTest, fragment, 'certificación real iPhone/Safari');

for (const path of [
  'admin/index.html',
  'admin/erp.js',
  'admin/ui-icon-system.js',
  'admin/navigation-shell.js',
  'admin/navigation-shell.css',
  'admin/tasks-workspace.js',
  'admin/account-administration.js',
  'admin/operational-alert-center.js',
  'admin/operational-alert-center.css',
  'admin/notification-inbox.js',
  'admin/notification-inbox.css',
  'admin/dashboard-operational-state.js',
  'sw.js'
]) requireText(files.browserStackWorkflow, `- '${path}'`, `trigger BrowserStack para ${path}`);

if (failures.length) {
  console.error('UX-7 navigation icon system failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 navigation icon system OK');
console.log(`- ${Object.keys(expectedLabels).length} etiquetas semánticas usan un único owner SVG.`);
console.log('- Sin Unicode/emoji, icon fonts, raster, CDN, observer compensatorio ni estilos inyectados.');
console.log('- Estados responsive, colapsado, interacción, accesibilidad, PWA y Safari real están protegidos.');
