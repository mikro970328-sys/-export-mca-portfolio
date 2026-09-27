import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';

const files = {
  html: 'admin/invoices.html',
  styles: 'admin/invoices.css',
  owner: 'admin/invoices.js',
  foundation: 'admin/embedded-foundation.css',
  autoRefresh: 'admin/embedded-auto-refresh.js',
  invoicesApi: 'api/invoices.js',
  paymentsApi: 'api/invoice-payments.js',
  navigation: 'admin/operational-navigation.js',
  bridge: 'admin/operational-context-bridge.js',
  contextualGate: 'scripts/check-contextual-sync.mjs',
  workflow: '.github/workflows/ux7-invoices-visual-owner.yml'
};

const failures = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const requireText = (source, text, label = text) => {
  if (!source.includes(text)) failures.push(`falta ${label}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(label);
};

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) failures.push(`falta ${file}`);
}

const html = read(files.html);
const styles = read(files.styles);
const owner = read(files.owner);
const foundation = read(files.foundation);
const autoRefresh = read(files.autoRefresh);
const invoicesApi = read(files.invoicesApi);
const paymentsApi = read(files.paymentsApi);
const navigation = read(files.navigation);
const bridge = read(files.bridge);
const contextualGate = read(files.contextualGate);
const workflow = read(files.workflow);

for (const text of [
  '<body class="erp-module-page erp-module-invoices" data-owner="invoices.js">',
  '/admin/embedded-foundation.css?v=20260922-figma1',
  '/admin/invoices.css?v=20260927-simple1',
  '/admin/invoices.js?v=20260927-simple1',
  '/admin/embedded-auto-refresh.js?v=20260920-speed3',
  'class="module-hero invoices-page-head"',
  'id="invoiceLastUpdated"',
  'id="metrics" class="metrics invoices-metrics"',
  'id="invoicesReadOnlyNote"',
  'id="invoiceResultCount"',
  'id="clearInvoiceFilters"',
  'class="invoices-table-wrap"',
  'id="invoiceView" aria-label="Filtrar facturas"',
  'Facturar una venta',
  'role="dialog" aria-modal="true"',
  'id="decisionModal"',
  'id="decisionReason"',
  'aria-live="polite"'
]) requireText(html, text, `HTML canónico ${text}`);

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260922-figma1');
const ownerCssIndex = html.indexOf('/admin/invoices.css?v=20260927-simple1');
if (foundationIndex < 0 || ownerCssIndex < 0 || foundationIndex > ownerCssIndex) {
  failures.push('la base visual compartida debe cargar antes de invoices.css');
}

forbid(html, /<style(?:\s|>)/i, 'invoices.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'invoices.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'invoices.html conserva estilos inline');
forbid(html, /\son(?:click|change|input|submit|load|error)\s*=/i, 'invoices.html conserva handlers inline');
forbid(html, /purchases\.css/i, 'Facturación vuelve a depender del CSS de Compras');

for (const selector of [
  '.invoices-page-head',
  '.invoices-metrics',
  '.invoices-list-panel',
  '.invoices-list-toolbar',
  '.invoices-table-wrap',
  '.invoices-table-head',
  '.invoice-row',
  '.invoice-row-actions',
  '.invoice-more-actions',
  '.invoice-form-section',
  '.invoice-detail-summary',
  '.invoice-detail-section',
  '.invoices-empty',
  '.invoices-spinner',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
]) requireText(styles, selector, `CSS propietario ${selector}`);

requireText(styles, 'overflow-x:auto;', 'scroll horizontal interno de la tabla');
requireText(styles, 'min-width:1152px;', 'ancho interno controlado de la tabla');
requireText(styles, 'overflow-x:hidden;', 'protección contra desbordamiento del documento');
forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'invoices.css conserva estilos legacy, una importación tardía o una sobrescritura');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'invoices.css mezcla comportamiento de JavaScript');
forbid(foundation, /erp-module-invoices/, 'la base compartida conserva reglas propietarias de Facturación');

for (const text of [
  "owner: 'invoices.js'",
  "const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  'function safeInvoiceMessage(',
  "console.error('INVOICES_UI_FAILED'",
  'function renderMetrics()',
  'function renderList()',
  'function updateFilterControls()',
  "invoiceActionButton(invoice, 'detail', 'Abrir factura')",
  'function openDetail(id)',
  'function openPayment(id)',
  'function openForSalesOrder(salesOrderId)',
  'function startInvoices(',
  'function handleStoredSession(event)',
  "window.addEventListener('storage', handleStoredSession)",
  'window.load = refresh;',
  'window.InvoicesModule = Object.freeze({',
  "can(invoice, 'record_payment')",
  "can(invoice, 'edit')",
  "can(invoice, 'issue')",
  "can(invoice, 'void')",
  "canPayment(payment, 'reverse')",
  "$('invoiceView').addEventListener('change'"
]) requireText(owner, text, `owner de Facturación ${text}`);

if ((owner.match(/error\?\.message/g) || []).length !== 1) {
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Facturación');
}
forbid(owner, /\berror\.message\b/, 'Facturación vuelve a renderizar error.message directamente');
forbid(owner, /\be\.message\b/, 'Facturación vuelve a renderizar e.message directamente');
forbid(owner, /\sstyle\s*=/i, 'invoices.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'invoices.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'invoices.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b/, 'invoices.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'invoices.js vuelve a usar diálogos nativos');
forbid(owner, /location\.replace\(['"]\/admin\/pwa\.html['"]\)/, 'Facturación vuelve a montar el ERP completo dentro del iframe');
forbid(owner, /if\s*\(!token\)\s*location\.(?:href|replace)/, 'Facturación redirige el iframe antes de que el shell complete el inicio de sesión');
forbid(owner, /if\s*\(invoice\.status===['"](?:draft|issued|void)['"]\)\s*actions\.push/, 'Facturación infiere acciones desde status en lugar de capabilities');

const embeddedListeners = new Map();
const embeddedRedirects = [];
let embeddedFetches = 0;
const embeddedWindow = {
  top: { location: { replace: path => embeddedRedirects.push(`top:${path}`) } },
  addEventListener: (type, handler) => embeddedListeners.set(type, handler),
  removeEventListener: type => embeddedListeners.delete(type)
};

vm.runInNewContext(owner, {
  URLSearchParams,
  crypto: webcrypto,
  console,
  document: { getElementById: () => null },
  fetch: async () => {
    embeddedFetches += 1;
    throw new Error('No debe consultar la API antes de recibir la sesión');
  },
  localStorage: { getItem: () => null, removeItem: () => {} },
  location: { search: '?embedded=1', replace: path => embeddedRedirects.push(`self:${path}`) },
  window: embeddedWindow
}, { filename: files.owner });

if (embeddedRedirects.length) failures.push(`Facturación embebida sin sesión redirige prematuramente: ${embeddedRedirects.join(', ')}`);
if (!embeddedListeners.has('storage')) failures.push('Facturación embebida sin sesión no espera el token del shell');
if (embeddedFetches) failures.push('Facturación embebida consulta la API antes de que el shell complete el inicio de sesión');

class FakeClassList {
  constructor(...names) { this.names = new Set(names); }
  add(...names) { names.forEach(name => this.names.add(name)); }
  remove(...names) { names.forEach(name => this.names.delete(name)); }
  contains(name) { return this.names.has(name); }
  toggle(name, force) {
    const active = force === undefined ? !this.names.has(name) : Boolean(force);
    if (active) this.names.add(name); else this.names.delete(name);
    return active;
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
    this.max = '';
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() {}
  contains(node) {
    for (let current = node; current; current = current.parentElement) {
      if (current === this) return true;
    }
    return false;
  }
  querySelector() { return null; }
  closest() { return null; }
}

const fixtureNodes = new Map();
for (const id of [
  'invoicePageMsg', 'metrics', 'invoiceResultCount', 'invoiceList', 'newInvoice',
  'invoicesReadOnlyNote', 'invoiceLastUpdated', 'search', 'invoiceView', 'clearInvoiceFilters', 'refresh',
  'iSalesOrder', 'iIssueDate', 'iDueDate', 'iNotes', 'invoiceLines', 'invoiceMsg',
  'saveInvoice', 'detailTitle', 'detailSubtitle', 'detailBody', 'detailActions', 'detailMsg',
  'paymentTitle', 'paymentSubtitle', 'pAmount', 'pDate', 'pMethod', 'pReference', 'pNotes',
  'saveBalance', 'balanceTarget', 'balanceAmount', 'balanceTitle', 'balanceCopy', 'balanceTargetWrap', 'balanceRefundWrap', 'balanceDate', 'balanceMethod', 'balanceReference', 'balanceReason', 'balanceMsg', 'balanceSummary', 'saveCredit', 'creditLines', 'creditTitle', 'creditReason', 'creditSummary', 'creditMsg', 'savePayment', 'paymentMsg', 'decisionTitle', 'decisionCopy', 'decisionAccept',
  'decisionReasonWrap', 'decisionReason', 'decisionMs