import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  html: 'admin/costs.html',
  styles: 'admin/costs.css',
  owner: 'admin/costs.js',
  foundation: 'admin/embedded-foundation.css',
  autoRefresh: 'admin/embedded-auto-refresh.js',
  costsApi: 'api/costs.js',
  profitabilityApi: 'api/profitability.js',
  capabilityOwner: 'api/_cost-actions.js',
  navigation: 'admin/navigation-shell.js',
  ux6Gate: 'scripts/check-ux6-costs-presentation.mjs',
  profitabilityGate: 'scripts/check-sales-order-profitability.mjs',
  workflow: '.github/workflows/ux7-costs-visual-owner.yml'
};

const failures = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const requireText = (source, value, label = value) => {
  if (!source.includes(value)) failures.push('falta ' + label);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(label);
};

Object.values(files).forEach(file => {
  if (!fs.existsSync(file)) failures.push('falta ' + file);
});
if (fs.existsSync('admin/profitability.js')) failures.push('profitability.js debe permanecer retirado como owner visual paralelo');
if (fs.existsSync('admin/profitability.css')) failures.push('profitability.css debe permanecer retirado como owner visual paralelo');

const html = read(files.html);
const styles = read(files.styles);
const owner = read(files.owner);
const foundation = read(files.foundation);
const autoRefresh = read(files.autoRefresh);
const costsApi = read(files.costsApi);
const profitabilityApi = read(files.profitabilityApi);
const capabilityOwner = read(files.capabilityOwner);
const navigation = read(files.navigation);
const ux6Gate = read(files.ux6Gate);
const profitabilityGate = read(files.profitabilityGate);
const workflow = read(files.workflow);

[
  '<body class="erp-module-page erp-module-costs" data-owner="costs.js">',
  '/admin/embedded-foundation.css?v=20260922-figma1',
  '/admin/costs.css?v=20260927-simple1',
  '/admin/costs.js?v=20260927-simple1',
  '/admin/embedded-auto-refresh.js?v=20260920-speed3',
  'class="module-hero costs-page-head"',
  'id="costsPageTitle">Gastos y rentabilidad',
  'class="costs-hero-state costs-visually-hidden"',
  'id="costsLastUpdated"',
  'id="metrics" class="metrics costs-metrics"',
  'id="costsReadOnlyNote"',
  'id="costsResultCount"',
  'id="clearCostFilters"',
  'class="panel costs-list-panel"',
  'role="group" aria-label="Elegir vista financiera"',
  'data-view="profitability"',
  'role="dialog" aria-modal="true"',
  'id="costDecisionModal"',
  'id="profitTraceModal"',
  'aria-live="polite"'
].forEach(value => requireText(html, value, 'HTML canónico ' + value));

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260922-figma1');
const ownerStylesIndex = html.indexOf('/admin/costs.css?v=20260927-simple1');
if (foundationIndex < 0 || ownerStylesIndex < 0 || foundationIndex > ownerStylesIndex) {
  failures.push('la base visual compartida debe cargar antes de costs.css');
}

forbid(html, /profitability\.(?:css|js)/i, 'Costos vuelve a cargar un owner visual paralelo de Rentabilidad');
forbid(html, /<style(?:\s|>)/i, 'costs.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'costs.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'costs.html conserva estilos inline');
forbid(html, /\son(?:click|change|input|submit|load|error)\s*=/i, 'costs.html conserva handlers inline');
forbid(html, /purchases\.css/i, 'Costos vuelve a depender del CSS de Compras');

[
  '.costs-page-head',
  '.costs-hero-state',
  '.costs-metrics',
  '.costs-list-panel',
  '.costs-list-toolbar',
  '.costs-table-wrap',
  '.costs-table-head',
  '.cost-row',
  '.cost-row-actions',
  '.cost-model-shell',
  '.profit-shell',
  '.profit-grid',
  '.cost-form-section',
  '.cost-detail-dialog',
  '.cost-trace-dialog',
  '.costs-empty',
  '.costs-spinner',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value => requireText(styles, value, 'CSS propietario ' + value));

requireText(styles, 'overflow-x:auto;', 'scroll horizontal interno de la tabla');
requireText(styles, 'min-width:900px;', 'ancho interno controlado de la tabla');
requireText(styles, 'overflow-x:hidden;', 'protección contra desbordamiento del documento');
forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'costs.css conserva estilos legacy, importación tardía o sobrescritura');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'costs.css mezcla comportamiento de JavaScript');
forbid(foundation, /erp-module-costs/, 'la base compartida conserva reglas propietarias de Costos');

[
  "owner: 'costs.js'",
  "const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  'function safeCostMessage(',
  'function safeProfitabilityMessage(',
  'function reportCostError(',
  "const marker = context === 'bootstrap'",
  "'COSTS_INITIAL_LOAD_FAILED'",
  "'PROFITABILITY_LOAD_FAILED'",
  'function renderMetrics()',
  'function renderCharges()',
  'function renderLanded()',
  'function renderCogs()',
  'function renderProfitability()',
  'function openDetail(id)',
  'function openTrace(type, id)',
  'function openProfitability(',
  'async function openPayrollEntry()',
  'function startCosts(',
  'function handleStoredSession(event)',
  "window.addEventListener('storage', handleStoredSession)",
  'window.load = refresh;',
  'window.CostsModule = Object.freeze({',
  'openPayrollEntry',
  "actionAllowed(charge, 'edit')",
  "actionAllowed(charge, 'post')",
  "actionAllowed(charge, 'void')",
  "button.setAttribute('aria-pressed', String(active))",
  "request('/api/costs'",
  "request('/api/profitability'"
].forEach(value => requireText(owner, value, 'owner de Costos ' + value));

if ((owner.match(/error\?\.message/g) || []).length !== 2) {
  failures.push('error?.message solo puede leerse dentro de los dos traductores seguros de Costos');
}
forbid(owner, /\berror\.message\b/, 'Costos vuelve a renderizar error.message directamente');
forbid(owner, /\be\.message\b/, 'Costos vuelve a renderizar e.message directamente');
forbid(owner, /\sstyle\s*=/i, 'costs.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'costs.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'costs.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b|\bResizeObserver\b/, 'costs.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'costs.js vuelve a usar diálogos nativos');
forbid(owner, /location\.(?:href|replace)\s*=\s*['"]\/admin\/pwa\.html/, 'Costos vuelve a montar el ERP completo dentro del iframe');
forbid(owner, /if\s*\(!token\)\s*location\.(?:href|replace)/, 'Costos redirige el iframe antes de que el shell complete la sesión');
forbid(owner, /if\s*\(charge\.status\s*(?:===|!==)[^)]*\)\s*actions\.push/, 'Costos infiere acciones desde status en lugar de capabilities');
forbid(owner, /\b(?:gross_margin|contribution_margin|recognized_merchandise_cogs)\s*=/, 'Costos calcula métricas financieras en el frontend');

const embeddedListeners = new Map();
const embeddedRedirects = [];
let embeddedFetches = 0;
const embeddedWindow = {
  top: { location: { replace: path => embeddedRedirects.push('top:' + path) } },
  addEventListener: (type, handler) => embeddedListeners.set(type, handler),
  removeEventListener: type => embeddedListeners.delete(type)
};

vm.runInNewContext(owner, {
  URLSearchParams,
  console,
  document: { getElementById: () => null },
  fetch: async () => {
    embeddedFetches += 1;
    throw new Error('No debe consultar la API antes de recibir la sesión');
  },
  localStorage: { getItem: () => null, removeItem: () => {} },
  location: { search: '?embedded=1', replace: path => embeddedRedirects.push('self:' + path) },
  window: embeddedWindow
}, { filename: files.owner });

if (embeddedRedirects.length) failures.push('Costos embebido sin sesión redirige prematuramente: ' + embeddedRedirects.join(', '));
if (!embeddedListeners.has('storage')) failures.push('Costos embebido sin sesión no espera el token del shell');
if (embeddedFetches) failures.push('Costos embebido consulta la API antes de que el shell complete la sesión');

class FakeClassList {
  constructor(...names) {
    this.names = new Set(names);
  }
  add(...names) {
    names.forEach(name => this.names.add(name));
  }
  remove(...names) {
    names.forEach(name => this.names.delete(name));
  }
  contains(name) {
    return this.names.has(name);
  }
  toggle(name, force) {
    const enabled = force === undefined ? !this.names.has(name) : Boolean(force);
    if (enabled) this.names.add(name);
    else this.names.delete(name);
    return enabled;
  }
}

class FakeElement {
  constructor(id, ...classes) {
    this.id = id;
    this.value = '';
    this.innerHTML = '';
    this.textContent = '';
    this.className = classes.join(' ');
    this.classList = new FakeClassList(...classes);
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.hidden = false;
    this.disabled = false;
  }
  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }
  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }
  focus() {}
  querySelector() {
    return null;
  }
  closest() {
    return null;
  }
  insertAdjacentHTML(position, value) {
    this.innerHTML += value;
  }
  remove() {}
}

const fixtureNodes = new Map();
[
  'pageMsg', 'metrics', 'newCharge', 'costsReadOnlyNote', 'costsLastUpdated',
  'costsListTitle', 'chargeHelp', 'chargeTotalPreview', 'allocationPreview', 'costsResultCount', 'clearCostFilters', 'search', 'refresh'