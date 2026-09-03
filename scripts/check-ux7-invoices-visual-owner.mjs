import fs from 'node:fs';
import vm from 'node:vm';

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
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/invoices.css?v=20260903-ux7invoices1',
  '/admin/invoices.js?v=20260903-ux7invoices1',
  '/admin/embedded-auto-refresh.js?v=20260903-ux7invoices1',
  'class="module-hero invoices-page-head"',
  'id="invoiceLastUpdated"',
  'id="metrics" class="metrics invoices-metrics"',
  'id="invoicesReadOnlyNote"',
  'id="invoiceResultCount"',
  'id="clearInvoiceFilters"',
  'class="invoices-table-wrap"',
  'role="group" aria-label="Filtrar facturas"',
  'role="dialog" aria-modal="true"',
  'id="decisionModal"',
  'id="decisionReason"',
  'aria-live="polite"'
]) requireText(html, text, `HTML canónico ${text}`);

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerCssIndex = html.indexOf('/admin/invoices.css?v=20260903-ux7invoices1');
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
  '.invoices-hero-state',
  '.invoices-metrics',
  '.invoices-list-panel',
  '.invoices-list-toolbar',
  '.invoices-table-wrap',
  '.invoices-table-head',
  '.invoice-row',
  '.invoice-row-actions',
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
requireText(styles, 'min-width:1160px;', 'ancho interno controlado de la tabla');
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
  "tab.setAttribute('aria-pressed', String(active))"
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
  querySelector() { return null; }
  closest() { return null; }
}

const fixtureNodes = new Map();
for (const id of [
  'invoicePageMsg', 'metrics', 'invoiceResultCount', 'invoiceList', 'newInvoice',
  'invoicesReadOnlyNote', 'invoiceLastUpdated', 'search', 'clearInvoiceFilters', 'refresh',
  'iSalesOrder', 'iIssueDate', 'iDueDate', 'iNotes', 'invoiceLines', 'invoiceMsg',
  'saveInvoice', 'detailTitle', 'detailSubtitle', 'detailBody', 'detailActions', 'detailMsg',
  'paymentTitle', 'paymentSubtitle', 'pAmount', 'pDate', 'pMethod', 'pReference', 'pNotes',
  'savePayment', 'paymentMsg', 'decisionTitle', 'decisionCopy', 'decisionAccept',
  'decisionReasonWrap', 'decisionReason', 'decisionMsg', 'invoiceRetry'
]) fixtureNodes.set(id, new FakeElement(id));

for (const id of ['invoiceModal', 'detailModal', 'paymentModal', 'decisionModal']) {
  fixtureNodes.set(id, new FakeElement(id, 'modal', 'hidden'));
}
const tabs = ['open', 'draft', 'paid', 'all'].map(view => {
  const node = new FakeElement(`tab-${view}`, 'btn', ...(view === 'open' ? ['active'] : []));
  node.dataset.view = view;
  return node;
});
const body = new FakeElement('body', 'erp-module-page', 'erp-module-invoices');
const documentListeners = new Map();

const fixtureWindow = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {}
};
fixtureWindow.parent = fixtureWindow;
fixtureWindow.top = fixtureWindow;

let fixtureFetches = 0;
const fixtureInvoice = {
  id: 'invoice-1',
  invoice_number: 'INV-<100>',
  sales_order_id: 'sale-1',
  issue_date: '2026-09-03',
  due_date: '2026-09-20',
  currency: 'USD',
  status: 'issued',
  notes: 'Nota <privada>',
  client: { company: 'Cliente <Prueba>' },
  sales_order: { id: 'sale-1', so_number: 'SO-100', customer_reference: 'REF-100' },
  financial: { total: 1000, paid_amount: 250, balance_due: 750, payment_status: 'partial' },
  items: [{ id: 'item-1', sales_order_item_id: 'sale-item-1', description: 'Producto <Prueba>', quantity: 10, unit: 'cajas', unit_price: 100, line_total: 1000 }],
  payments: [{ id: 'payment-1', amount: 250, currency: 'USD', payment_date: '2026-09-03', method: 'wire', reference_number: 'WIRE-1', status: 'posted', capabilities: { actions: { reverse: { allowed: true } } } }],
  capabilities: { actions: { record_payment: { allowed: true }, edit: { allowed: false }, issue: { allowed: false }, void: { allowed: false } } }
};

vm.runInNewContext(owner, {
  URLSearchParams,
  console,
  CustomEvent: class CustomEvent { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } },
  Element: FakeElement,
  HTMLElement: FakeElement,
  requestAnimationFrame: callback => callback(),
  document: {
    body,
    activeElement: new FakeElement('active'),
    getElementById: id => fixtureNodes.get(id) || null,
    addEventListener: (type, handler) => documentListeners.set(type, handler),
    querySelector: selector => selector === '.modal:not(.hidden)'
      ? ['decisionModal', 'paymentModal', 'invoiceModal', 'detailModal'].map(id => fixtureNodes.get(id)).find(node => !node.classList.contains('hidden')) || null
      : null,
    querySelectorAll: selector => {
      if (selector === '[data-view]') return tabs;
      if (selector === '.modal') return ['invoiceModal', 'detailModal', 'paymentModal', 'decisionModal'].map(id => fixtureNodes.get(id));
      if (selector === '[data-invoice-line]') return [];
      return [];
    }
  },
  fetch: async (url, options = {}) => {
    fixtureFetches += 1;
    if (String(options.method || 'GET').toUpperCase() !== 'GET') throw new Error('El fixture UX-7 no permite mutaciones');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        invoices: [fixtureInvoice],
        sales_orders: [{
          id: 'sale-1',
          so_number: 'SO-100',
          currency: 'USD',
          client: { company: 'Cliente <Prueba>' },
          items: [{ id: 'sale-item-1', ordered_quantity: 10, unit: 'cajas', unit_price: 100, product: { sku: 'SKU-1', name: 'Producto' }, invoice_progress: { available_to_invoice_quantity: 10 } }]
        }],
        metrics: { invoice_count: 1, draft_count: 0, paid_count: 0, overdue_count: 0, receivable_by_currency: [{ currency: 'USD', amount: 750 }] },
        write_access: true
      })
    };
  },
  localStorage: { getItem: key => key === 'export_mca_token' ? 'fixture-token' : null, removeItem: () => {} },
  location: { search: '?embedded=1', replace() {} },
  window: fixtureWindow,
  parent: fixtureWindow
}, { filename: `${files.owner}:fixture` });

await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));

if (fixtureFetches !== 1) failures.push(`Facturación debe consultar una vez su bootstrap al iniciar; consultó ${fixtureFetches}`);
if (!fixtureNodes.get('invoiceList').innerHTML.includes('INV-&lt;100&gt;')) failures.push('Facturación no escapa ni presenta la factura del bootstrap');
if (!fixtureNodes.get('invoiceList').innerHTML.includes('Cliente &lt;Prueba&gt;')) failures.push('Facturación no escapa ni presenta el cliente');
if (!fixtureNodes.get('invoiceList').innerHTML.includes('data-invoice-action="payment"')) failures.push('Facturación no presenta la acción permitida record_payment');
if (fixtureNodes.get('invoiceList').innerHTML.includes('data-invoice-action="void"')) failures.push('Facturación presenta la acción void denegada por capabilities');
if (!fixtureNodes.get('metrics').innerHTML.includes('Por cobrar')) failures.push('Facturación no presenta las cinco métricas financieras');
if (fixtureNodes.get('invoiceResultCount').textContent !== '1 factura') failures.push('Facturación no actualiza el contador de resultados');
if (fixtureNodes.get('newInvoice').hidden) failures.push('Facturación oculta la creación pese a write_access');

fixtureWindow.InvoicesModule?.openInvoice('invoice-1');
if (fixtureNodes.get('detailModal').classList.contains('hidden')) failures.push('El owner canónico no abre el detalle de Facturación');
if (!fixtureNodes.get('detailBody').innerHTML.includes('Producto &lt;Prueba&gt;')) failures.push('El detalle no escapa ni presenta las líneas facturadas');
if (!fixtureNodes.get('detailBody').innerHTML.includes('WIRE-1')) failures.push('El detalle no conserva los cobros aplicados');

fixtureWindow.InvoicesModule?.openCollection('invoice-1');
if (fixtureNodes.get('paymentModal').classList.contains('hidden')) failures.push('El owner canónico no abre el cobro permitido');

for (const text of [
  "authorizeAdmin(req,res,req.method==='GET'?'finance.read':'finance.write')",
  'loadInvoiceFinanceCapabilityMaps',
  "capabilities:capabilityBundle.invoice_capabilities.get",
  "supabase('rpc/create_invoice_plan'",
  "supabase('rpc/replace_invoice_plan'",
  "supabase('rpc/transition_invoice'",
  "return fail(res,500,'No se pudo procesar Facturación. Intenta nuevamente.'"
]) requireText(invoicesApi, text, `API canónica de Facturación ${text}`);

for (const text of [
  "authorizeAdmin(req,res,'finance.write')",
  "supabase('rpc/register_invoice_payment'",
  "supabase('rpc/reverse_invoice_payment'",
  "return fail(res,500,'No se pudo procesar el cobro. Intenta nuevamente.'"
]) requireText(paymentsApi, text, `API canónica de Cobros ${text}`);

for (const text of [
  "callEmbedded('invoicesSection','InvoicesModule.openInvoice'",
  "callEmbedded('invoicesSection','InvoicesModule.openCollection'",
  "callEmbedded('invoicesSection','InvoicesModule.openForSalesOrder'"
]) requireText(navigation, text, `navegación directa ${text}`);
forbid(navigation, /CONTEXT_SECTIONS[^;]*invoicesSection/, 'Facturación sigue recibiendo el bridge visual compartido');
forbid(navigation, /openInvoice[^\n]*installBridge\('invoicesSection'\)/, 'openInvoice todavía inyecta el bridge anterior');
forbid(bridge, /function initInvoices\s*\(/, 'el bridge conserva un segundo owner de Facturación');
forbid(bridge, /\/admin\/invoices\.html/, 'el bridge todavía se activa dentro de Facturación');
requireText(contextualGate, "InvoicesModule.openInvoice", 'gate contextual actualizado para el owner de Facturación');
requireText(autoRefresh, "invoices: ['invoicesSection','costsSection','payablesSection']", 'auto-refresh conserva dependencias de Facturación');

for (const text of [
  'admin/invoices.html',
  'admin/invoices.css',
  'admin/invoices.js',
  'admin/operational-navigation.js',
  'admin/operational-context-bridge.js',
  'scripts/check-ux7-invoices-visual-owner.mjs',
  'node scripts/check-ux7-invoices-visual-owner.mjs',
  'node scripts/check-ux6-invoices-presentation.mjs',
  'node scripts/check-ux5-invoice-actions.mjs',
  'node scripts/check-contextual-sync.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
]) requireText(workflow, text, `workflow ${text}`);

const openingBraces = (styles.match(/{/g) || []).length;
const closingBraces = (styles.match(/}/g) || []).length;
if (openingBraces !== closingBraces) failures.push(`invoices.css está desbalanceado: ${openingBraces}/${closingBraces}`);

if (failures.length) {
  console.error('UX-7 Invoices visual owner gate failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 Invoices visual owner gate passed.');
console.log('- Facturación usa los owners canónicos invoices.html, invoices.css e invoices.js.');
console.log('- Crear, editar, emitir, cobrar, anular y revertir siguen exactamente las capabilities del backend.');
console.log('- La tabla desplaza internamente y el iframe espera la sesión del shell sin montar otro login.');
