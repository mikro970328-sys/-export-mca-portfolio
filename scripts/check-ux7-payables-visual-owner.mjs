import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  html: 'admin/payables.html',
  styles: 'admin/payables.css',
  owner: 'admin/payables.js',
  foundation: 'admin/embedded-foundation.css',
  erp: 'admin/erp.js',
  apNavigation: 'admin/ap-traceability.js',
  apBridge: 'admin/ap-context-bridge.js',
  operationalNavigation: 'admin/operational-navigation.js',
  operationalBridge: 'admin/operational-context-bridge.js',
  payablesApi: 'api/payables.js',
  paymentsApi: 'api/supplier-payments.js',
  capabilityOwner: 'api/_supplier-ap-actions.js',
  contextualGate: 'scripts/check-contextual-sync.mjs',
  workflow: '.github/workflows/ux7-payables-visual-owner.yml'
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
if (fs.existsSync('admin/ap-traceability-bootstrap.js')) failures.push('ap-traceability-bootstrap.js debe permanecer retirado');

const html = read(files.html);
const styles = read(files.styles);
const owner = read(files.owner);
const foundation = read(files.foundation);
const erp = read(files.erp);
const apNavigation = read(files.apNavigation);
const apBridge = read(files.apBridge);
const operationalNavigation = read(files.operationalNavigation);
const operationalBridge = read(files.operationalBridge);
const payablesApi = read(files.payablesApi);
const paymentsApi = read(files.paymentsApi);
const capabilityOwner = read(files.capabilityOwner);
const contextualGate = read(files.contextualGate);
const workflow = read(files.workflow);

for (const text of [
  '<body class="erp-module-page erp-module-payables" data-owner="payables.js">',
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/payables.css?v=20260903-ux7payables1',
  '/admin/payables.js?v=20260903-ux7payables1',
  '/admin/embedded-auto-refresh.js?v=20260904-live2',
  'class="module-hero payables-page-head"',
  'id="payablesLastUpdated"',
  'id="metrics" class="metrics payables-metrics"',
  'id="payablesReadOnlyNote"',
  'id="payablesResultCount"',
  'id="clearPayablesFilters"',
  'class="payables-table-wrap"',
  'id="detailTraceability"',
  'id="detailTraceabilityActions"',
  'id="decisionModal"',
  'role="dialog" aria-modal="true"',
  'aria-live="polite"'
]) requireText(html, text, `HTML canónico ${text}`);

if ((html.match(/id="detailTraceability"/g) || []).length !== 1) failures.push('el HTML debe contener exactamente una sección canónica de Trazabilidad AP');
const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerCssIndex = html.indexOf('/admin/payables.css?v=20260903-ux7payables1');
if (foundationIndex < 0 || ownerCssIndex < 0 || foundationIndex > ownerCssIndex) failures.push('la base visual compartida debe cargar antes de payables.css');

forbid(html, /<style(?:\s|>)/i, 'payables.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'payables.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'payables.html conserva estilos inline');
forbid(html, /\son(?:click|change|input|submit|load|error)\s*=/i, 'payables.html conserva handlers inline');
forbid(html, /purchases\.css|ap-traceability-bootstrap/i, 'Cuentas por pagar vuelve a depender de un owner visual ajeno');

for (const selector of [
  '.payables-page-head',
  '.payables-hero-state',
  '.payables-metrics',
  '.payables-list-panel',
  '.payables-list-toolbar',
  '.payables-table-wrap',
  '.payables-table-head',
  '.payable-row',
  '.payable-row-actions',
  '.payable-form-section',
  '.payable-detail-summary',
  '.payable-detail-section',
  '.payable-trace-actions',
  '.payables-empty',
  '.payables-spinner',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:760px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
]) requireText(styles, selector, `CSS propietario ${selector}`);

requireText(styles, 'overflow-x:auto;', 'scroll horizontal interno de la tabla');
requireText(styles, 'min-width:1190px;', 'ancho interno controlado de la tabla');
requireText(styles, 'overflow-x:hidden;', 'protección contra desbordamiento del documento');
forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'payables.css conserva estilos legacy, una importación tardía o una sobrescritura');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'payables.css mezcla comportamiento de JavaScript');
forbid(foundation, /erp-module-payables/, 'la base compartida conserva reglas propietarias de Cuentas por pagar');

for (const text of [
  "owner: 'payables.js'",
  "const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  'function safeApMessage(',
  "console.error('PAYABLES_UI_FAILED'",
  'function moneyByCurrency(',
  'function renderMetrics()',
  'function renderList()',
  'function openBillDetail(id)',
  'function openPaymentDetail(id)',
  'function renderTraceability(type, number)',
  'function askBillDecision(bill, action)',
  'function startPayables(',
  'function handleStoredSession(event)',
  "window.addEventListener('storage', handleStoredSession)",
  'window.load = refresh;',
  'window.PayablesModule = Object.freeze({',
  "actionAllowed(bill, 'pay')",
  "actionAllowed(bill, 'edit')",
  "actionAllowed(bill, 'post')",
  "actionAllowed(bill, 'void')",
  "actionAllowed(payment, 'allocate')",
  "actionAllowed(payment, 'reverse')",
  "body.action = 'pay_bill'",
  "body.action = 'register'",
  "action: 'replace_applications'",
  "action: 'reverse'",
  "button.setAttribute('aria-pressed', String(active))"
]) requireText(owner, text, `owner de Cuentas por pagar ${text}`);

if ((owner.match(/error\?\.message/g) || []).length !== 1) failures.push('error?.message solo puede leerse dentro del traductor seguro de Cuentas por pagar');
forbid(owner, /\berror\.message\b/, 'Cuentas por pagar vuelve a renderizar error.message directamente');
forbid(owner, /\be\.message\b/, 'Cuentas por pagar vuelve a renderizar e.message directamente');
forbid(owner, /\sstyle\s*=/i, 'payables.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'payables.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'payables.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b/, 'payables.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'payables.js vuelve a usar diálogos nativos');
forbid(owner, /location\.replace\(['"]\/admin\/pwa\.html['"]\)/, 'Cuentas por pagar vuelve a montar el ERP completo dentro del iframe');
forbid(owner, /if\s*\(!token\)\s*location\.(?:href|replace)/, 'Cuentas por pagar redirige el iframe antes de que el shell complete el inicio de sesión');
forbid(owner, /if\s*\(bill\.status\s*===\s*['"](?:draft|posted|void)['"]\)\s*actions\.push/, 'Cuentas por pagar infiere acciones de factura desde status');
forbid(owner, /if\s*\(payment\.status\s*===\s*['"](?:posted|reversed)['"]\)\s*actions\.push/, 'Cuentas por pagar infiere acciones de pago desde status');

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

if (embeddedRedirects.length) failures.push(`Cuentas por pagar embebida sin sesión redirige prematuramente: ${embeddedRedirects.join(', ')}`);
if (!embeddedListeners.has('storage')) failures.push('Cuentas por pagar embebida sin sesión no espera el token del shell');
if (embeddedFetches) failures.push('Cuentas por pagar embebida consulta la API antes de que el shell complete el inicio de sesión');

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
    this.title = '';
  }
  addEventListener(type, handler) { this.listeners.set(type, handler); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  focus() {}
  querySelector() { return null; }
  closest() { return null; }
}

const fixtureNodes = new Map();
for (const id of [
  'payablesPageMsg', 'metrics', 'payablesResultCount', 'list', 'newBill', 'newPayment',
  'newAdvancePayment', 'payablesReadOnlyNote', 'payablesLastUpdated', 'search',
  'clearPayablesFilters', 'refresh', 'viewTabs', 'bPO', 'bSupplierInvoice', 'bDate',
  'bDue', 'bNotes', 'billLines', 'billCalculatedTotal', 'billMsg', 'saveBill',
  'paymentTitle', 'paymentSubtitle', 'pPO', 'pAmount', 'pDate', 'pMethod', 'pReference',
  'pNotes', 'pOpenBalanceHint', 'paymentMsg', 'savePayment', 'allocationTitle',
  'allocationSubtitle', 'allocationBills', 'allocationMsg', 'saveAllocation', 'reverseTitle',
  'rReason', 'reverseMsg', 'saveReverse', 'detailTitle', 'detailSubtitle', 'detailBody',
  'detailTraceability', 'detailTraceabilityActions', 'detailActions', 'detailMsg',
  'decisionTitle', 'decisionCopy', 'decisionAccept', 'decisionMsg', 'payablesRetry'
]) fixtureNodes.set(id, new FakeElement(id));

for (const id of ['billModal', 'paymentModal', 'allocationModal', 'reverseModal', 'detailModal', 'decisionModal']) {
  fixtureNodes.set(id, new FakeElement(id, 'modal', 'hidden'));
}
const entityTabs = ['bills', 'payments'].map(entity => {
  const node = new FakeElement(`entity-${entity}`, 'btn', ...(entity === 'bills' ? ['active'] : []));
  node.dataset.entity = entity;
  return node;
});
const body = new FakeElement('body', 'erp-module-page', 'erp-module-payables');
const documentListeners = new Map();
const fixtureWindow = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
fixtureWindow.parent = fixtureWindow;
fixtureWindow.top = fixtureWindow;
fixtureWindow.APTraceability = {
  billByNumber: async () => ({
    supplier_id: 'supplier-1', purchase_order_id: 'po-1', po_number: 'PO-100',
    receipts: [{ receipt_number: 'WR-100' }], payments: [{ supplier_payment_id: 'payment-1', payment_number: 'SP-100' }]
  }),
  paymentByNumber: async () => null,
  openSupplier() {}, openPurchase() {}, openReceipt() {}, openBill() {}, openPayment() {}
};

const fixtureBills = [
  {
    id: 'bill-usd', bill_number: 'SB-<USD>', supplier_invoice_number: 'V-100', purchase_order_id: 'po-1', bill_date: '2026-09-03', currency: 'USD', status: 'posted', notes: 'Nota <privada>',
    supplier: { legal_name: 'Proveedor <Uno>' }, purchase_order: { id: 'po-1', po_number: 'PO-100', supplier_reference: 'REF-100' },
    financial: { bill_total: 150, paid_amount: 50, balance_due: 100, payment_status: 'partial', overdue: false },
    items: [{ id: 'line-1', product: { name: 'Producto <Prueba>' }, billed_quantity: 2, unit: 'cajas', unit_cost: 75, po_unit_cost_snapshot: 70, line_total: 150, pricing_mode: 'unit' }],
    capabilities: { actions: { pay: { allowed: true }, edit: { allowed: false }, post: { allowed: false }, void: { allowed: false } } }
  },
  {
    id: 'bill-eur', bill_number: 'SB-EUR', supplier_invoice_number: 'V-200', purchase_order_id: 'po-2', bill_date: '2026-09-03', currency: 'EUR', status: 'posted',
    supplier: { legal_name: 'Proveedor Europa' }, purchase_order: { id: 'po-2', po_number: 'PO-200' },
    financial: { bill_total: 70, paid_amount: 0, balance_due: 70, payment_status: 'unpaid', overdue: true }, items: [],
    capabilities: { actions: { pay: { allowed: false }, edit: { allowed: false }, post: { allowed: false }, void: { allowed: false } } }
  }
];
const fixturePayments = [
  { id: 'payment-1', payment_number: 'SP-100', purchase_order_id: 'po-1', amount: 50, currency: 'USD', payment_date: '2026-09-03', method: 'wire', reference: 'WIRE-1', status: 'posted', supplier: { legal_name: 'Proveedor <Uno>' }, purchase_order: { po_number: 'PO-100' }, progress: { applied_amount: 50, unapplied_amount: 0, application_status: 'applied' }, applications: [{ supplier_bill_id: 'bill-usd', amount: 50 }], capabilities: { actions: { allocate: { allowed: false }, reverse: { allowed: false } } } },
  { id: 'payment-2', payment_number: 'SP-200', purchase_order_id: 'po-2', amount: 20, currency: 'EUR', payment_date: '2026-09-03', status: 'posted', supplier: { legal_name: 'Proveedor Europa' }, purchase_order: { po_number: 'PO-200' }, progress: { applied_amount: 0, unapplied_amount: 20, application_status: 'unapplied' }, applications: [], capabilities: { actions: { allocate: { allowed: true }, reverse: { allowed: true } } } }
];

let fixtureFetches = 0;
let fixtureWrites = 0;
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
      ? ['decisionModal', 'reverseModal', 'allocationModal', 'paymentModal', 'billModal', 'detailModal'].map(id => fixtureNodes.get(id)).find(node => !node.classList.contains('hidden')) || null
      : null,
    querySelectorAll: selector => {
      if (selector === '[data-entity]') return entityTabs;
      if (selector === '.modal') return ['billModal', 'paymentModal', 'allocationModal', 'reverseModal', 'detailModal', 'decisionModal'].map(id => fixtureNodes.get(id));
      if (selector === '[data-bill-line]' || selector === '[data-allocation-bill]') return [];
      return [];
    }
  },
  fetch: async (url, options = {}) => {
    fixtureFetches += 1;
    if (String(options.method || 'GET').toUpperCase() !== 'GET') {
      fixtureWrites += 1;
      throw new Error('El fixture UX-7 no permite mutaciones');
    }
    const data = String(url).includes('supplier-payments')
      ? { payments: fixturePayments, bills: fixtureBills, purchase_orders: [{ id: 'po-1', po_number: 'PO-100', currency: 'USD', open_balance: 100, supplier: { legal_name: 'Proveedor Uno' } }], advance_purchase_orders: [{ id: 'po-1', po_number: 'PO-100', currency: 'USD', supplier: { legal_name: 'Proveedor Uno' } }], write_access: true }
      : { bills: fixtureBills, purchase_orders: [], write_access: true };
    return { ok: true, status: 200, json: async () => data };
  },
  localStorage: { getItem: key => key === 'export_mca_token' ? 'fixture-token' : null, removeItem: () => {} },
  location: { search: '?embedded=1', replace() {} },
  window: fixtureWindow,
  parent: fixtureWindow
}, { filename: `${files.owner}:fixture` });

await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));

if (fixtureFetches !== 2) failures.push(`Cuentas por pagar debe consultar sus dos bootstrap una vez; consultó ${fixtureFetches}`);
if (fixtureWrites) failures.push(`el fixture de lectura ejecutó ${fixtureWrites} mutaciones`);
const metricMarkup = fixtureNodes.get('metrics').innerHTML;
if (!metricMarkup.includes('EUR 70.00') || !metricMarkup.includes('USD 100.00')) failures.push('las métricas no separan saldos por moneda');
if (metricMarkup.includes('USD 170.00') || metricMarkup.includes('EUR 170.00')) failures.push('las métricas suman monedas diferentes sin tipo de cambio');
const listMarkup = fixtureNodes.get('list').innerHTML;
if (!listMarkup.includes('SB-&lt;USD&gt;') || !listMarkup.includes('Proveedor &lt;Uno&gt;')) failures.push('la lista no escapa ni presenta el bootstrap');
if (!listMarkup.includes('data-bill-action="pay"')) failures.push('la lista no presenta la acción pay permitida');
if (listMarkup.includes('data-bill-action="void"')) failures.push('la lista presenta la acción void denegada por capabilities');
if (fixtureNodes.get('payablesResultCount').textContent !== '2 facturas') failures.push('la lista no actualiza el contador de resultados');
if (fixtureNodes.get('newBill').hidden) failures.push('Cuentas por pagar oculta las altas pese a write_access');

fixtureWindow.PayablesModule?.openBill('bill-usd');
await new Promise(resolve => setTimeout(resolve, 0));
if (fixtureNodes.get('detailModal').classList.contains('hidden')) failures.push('el owner canónico no abre el detalle de factura');
if (!fixtureNodes.get('detailBody').innerHTML.includes('Producto &lt;Prueba&gt;')) failures.push('el detalle no escapa ni presenta las líneas de factura');
if (!fixtureNodes.get('detailTraceabilityActions').innerHTML.includes('data-trace-action="supplier"')) failures.push('el detalle no presenta la trazabilidad AP canónica');
if (fixtureWrites) failures.push('abrir el detalle de lectura produjo una mutación');

for (const text of [
  "authorizeAdmin(req, res, req.method === 'GET' ? 'finance.read' : 'finance.write')",
  'loadSupplierApCapabilityMaps',
  'capabilities:capabilityMap.get',
  "supabase('rpc/create_supplier_bill_plan'",
  "supabase('rpc/replace_supplier_bill_plan_canonical'",
  "supabase('rpc/transition_supplier_bill_canonical'",
  "return fail(res,500,'No se pudo procesar Cuentas por pagar')"
]) requireText(payablesApi, text, `API canónica de Cuentas por pagar ${text}`);

for (const text of [
  "authorizeAdmin(req, res, req.method === 'GET' ? 'finance.read' : 'finance.write')",
  'loadSupplierApCapabilityMaps',
  "supabase('rpc/pay_supplier_bill_canonical'",
  "supabase('rpc/register_supplier_payment'",
  "supabase('rpc/reverse_supplier_payment_canonical'",
  "supabase('rpc/replace_supplier_payment_applications_canonical'",
  "return fail(res,500,'No se pudo procesar el pago del proveedor')"
]) requireText(paymentsApi, text, `API canónica de pagos AP ${text}`);

for (const text of ['supplier_bill_action_capabilities', 'supplier_payment_action_capabilities', "entry.required_permission='finance.write'"]) requireText(capabilityOwner, text, `capabilities AP ${text}`);
requireText(erp, "loadScript('/admin/ap-traceability.js?v=20260903-ux7payables1', 'data-ap-traceability')", 'carga explícita de trazabilidad AP');
requireText(operationalNavigation, "callEmbedded('payablesSection','PayablesModule.openBill'", 'navegación directa al owner PayablesModule');
forbid(operationalNavigation, /CONTEXT_SECTIONS[^;]*payablesSection/, 'Cuentas por pagar sigue recibiendo el bridge operativo compartido');
forbid(operationalNavigation, /openSupplierBill[^\n]*installBridge\('payablesSection'\)/, 'openSupplierBill todavía inyecta el bridge anterior');
forbid(operationalBridge, /function initPayables\s*\(/, 'el bridge operativo conserva un segundo owner de Cuentas por pagar');
forbid(operationalBridge, /\/admin\/payables\.html/, 'el bridge operativo todavía se activa dentro de Cuentas por pagar');
forbid(apNavigation, /CONTEXT_SECTIONS[^;]*payablesSection/, 'Cuentas por pagar sigue recibiendo el bridge AP compartido');
forbid(apNavigation, /callPayables[\s\S]{0,260}installBridge\('payablesSection'\)/, 'la navegación AP todavía inyecta un owner visual en Cuentas por pagar');
forbid(apBridge, /function initPayables\s*\(/, 'el bridge AP conserva un segundo owner de Cuentas por pagar');
forbid(apBridge, /\/payables\.html/, 'el bridge AP todavía se activa dentro de Cuentas por pagar');
requireText(contextualGate, 'PayablesModule.openBill', 'gate contextual actualizado para el owner de Cuentas por pagar');

for (const text of [
  'admin/payables.html',
  'admin/payables.css',
  'admin/payables.js',
  'admin/ap-traceability.js',
  'admin/ap-context-bridge.js',
  'admin/operational-navigation.js',
  'admin/operational-context-bridge.js',
  'scripts/check-ux7-payables-visual-owner.mjs',
  'node scripts/check-ux7-payables-visual-owner.mjs',
  'node scripts/check-ux6-payables-presentation.mjs',
  'node scripts/check-ux5-supplier-ap-actions.mjs',
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
if (openingBraces !== closingBraces) failures.push(`payables.css está desbalanceado: ${openingBraces}/${closingBraces}`);

if (failures.length) {
  console.error('UX-7 Payables visual owner gate failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 Payables visual owner gate passed.');
console.log('- Cuentas por pagar usa los owners canónicos payables.html, payables.css y payables.js.');
console.log('- Facturas y pagos siguen exactamente las capabilities del backend y las monedas no se combinan sin conversión.');
console.log('- La tabla desplaza internamente, el iframe espera la sesión y Trazabilidad AP tiene un solo propietario visual.');
