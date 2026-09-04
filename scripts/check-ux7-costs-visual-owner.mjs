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
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/costs.css?v=20260903-ux7costs1',
  '/admin/costs.js?v=20260903-ux7costs1',
  '/admin/embedded-auto-refresh.js?v=20260904-live2',
  'class="module-hero costs-page-head"',
  'id="costsPageTitle">Costos y rentabilidad',
  'class="costs-hero-state"',
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

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerStylesIndex = html.indexOf('/admin/costs.css?v=20260903-ux7costs1');
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
requireText(styles, 'min-width:1180px;', 'ancho interno controlado de la tabla');
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
  'function startCosts(',
  'function handleStoredSession(event)',
  "window.addEventListener('storage', handleStoredSession)",
  'window.load = refresh;',
  'window.CostsModule = Object.freeze({',
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
  'costsResultCount', 'clearCostFilters', 'search', 'refresh', 'content',
  'cCategory', 'cStage', 'cDate', 'cAmount', 'cCurrency', 'cSupplier',
  'cReference', 'cNotes', 'allocationEditor', 'addAllocation', 'saveCharge',
  'chargeTitle', 'chargeMsg', 'detailTitle', 'detailSubtitle', 'detailBody',
  'detailActions', 'detailMsg', 'profitTraceTitle', 'profitTraceSubtitle',
  'profitTraceBody', 'costDecisionTitle', 'costDecisionCopy', 'costDecisionAccept',
  'costDecisionCancel', 'costDecisionMsg', 'costsRetry', 'profitabilityRetry'
].forEach(id => fixtureNodes.set(id, new FakeElement(id)));
['chargeModal', 'detailModal', 'profitTraceModal', 'costDecisionModal'].forEach(id => {
  fixtureNodes.set(id, new FakeElement(id, 'modal', 'hidden'));
});

const viewTabs = ['charges', 'landed', 'cogs', 'profitability'].map(view => {
  const tab = new FakeElement('view-' + view, 'btn', ...(view === 'charges' ? ['active'] : []));
  tab.dataset.view = view;
  return tab;
});
const documentListeners = new Map();
const fixtureWindow = {
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {}
};
fixtureWindow.parent = fixtureWindow;
fixtureWindow.top = fixtureWindow;

const fixtureCharge = {
  id: 'cost-1',
  cost_number: 'CC-<100>',
  category: 'ocean_freight',
  stage: 'inbound',
  amount: 1250,
  currency: 'USD',
  incurred_date: '2026-09-03',
  supplier_id: 'supplier-1',
  reference: 'REF-<1>',
  status: 'draft',
  notes: 'Nota <privada>',
  allocations: [{
    id: 'allocation-1',
    amount: 1250,
    basis: 'manual',
    purchase_order_id: 'po-1',
    notes: 'Distribución <segura>'
  }],
  progress: {
    allocation_status: 'allocated',
    allocated_amount: 1250,
    unallocated_amount: 0
  },
  capabilities: {
    actions: {
      edit: { allowed: false },
      post: { allowed: true },
      void: { allowed: false }
    }
  }
};

const fixtureCosts = {
  charges: [fixtureCharge],
  write_access: true,
  targets: {
    suppliers: [{ id: 'supplier-1', legal_name: 'Proveedor <Seguro>' }],
    purchase_orders: [{ id: 'po-1', po_number: 'PO-<100>' }],
    warehouse_receipts: [{ id: 'receipt-1', receipt_number: 'WR-100', received_at: '2026-09-03' }],
    loads: [{ id: 'load-1', load_number: 'CARGUE-100' }],
    shipments: [],
    operations: []
  },
  products: [{ id: 'product-1', sku: 'SKU-1', name: 'Producto <Seguro>' }],
  cost_models: {
    warehouse_receipt_items: [{
      receipt_id: 'receipt-1',
      receipt_item_id: 'receipt-item-1',
      product_id: 'product-1',
      physical_quantity: 10,
      linked_quantity: 10,
      costed_quantity: 10,
      unit: 'cajas',
      recognized_merchandise_cost: 1000,
      recognized_unit_cost: 100,
      currency: 'USD',
      cost_coverage: 'actual'
    }],
    posted_allocations: [],
    loads: [{
      load_id: 'load-1',
      load_number: 'CARGUE-100',
      item_count: 1,
      costed_item_count: 1,
      source_currency_count: 1,
      recognized_merchandise_cogs: 1000,
      currency: 'USD',
      cost_coverage: 'actual'
    }],
    load_direct: []
  }
};

const fixtureProfitability = {
  profitability: {
    sales_orders: [{
      sales_order_id: 'sale-1',
      so_number: 'SO-<100>',
      client_id: 'client-1',
      sales_order_status: 'confirmed',
      profitability_status: 'comparable',
      order_total: 1500,
      attributed_sales_revenue: 1500,
      unattributed_order_value: 0,
      recognized_merchandise_cogs: 1000,
      gross_margin: 500,
      gross_margin_pct: 33.33,
      sales_currency: 'USD',
      cogs_currency: 'USD',
      merchandise_cost_coverage: 'actual'
    }],
    invoices: [],
    loads: [],
    operations: [],
    operation_direct_costs: []
  },
  traceability: {
    sales_orders: [],
    invoices: [],
    cost_charges: []
  },
  masters: {
    products: [],
    clients: [{ id: 'client-1', company: 'Cliente <Seguro>' }]
  }
};

const fixtureFetches = [];
vm.runInNewContext(owner, {
  URLSearchParams,
  console,
  CustomEvent: class CustomEvent {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  },
  Element: FakeElement,
  HTMLElement: FakeElement,
  requestAnimationFrame: callback => callback(),
  document: {
    activeElement: new FakeElement('active'),
    getElementById: id => fixtureNodes.get(id) || null,
    addEventListener: (type, handler) => documentListeners.set(type, handler),
    querySelectorAll: selector => {
      if (selector === '[data-view]') return viewTabs;
      if (selector === '[data-allocation-line]') return [];
      return [];
    }
  },
  fetch: async (url, options = {}) => {
    const method = String(options.method || 'GET').toUpperCase();
    fixtureFetches.push(method + ' ' + url);
    if (method !== 'GET') throw new Error('El fixture UX-7 no permite mutaciones');
    const data = url === '/api/profitability' ? fixtureProfitability : fixtureCosts;
    return {
      ok: true,
      status: 200,
      json: async () => data
    };
  },
  localStorage: {
    getItem: key => key === 'export_mca_token' ? 'fixture-token' : null,
    removeItem() {}
  },
  location: { search: '?embedded=1', replace() {} },
  window: fixtureWindow
}, { filename: files.owner + ':fixture' });

await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));

if (fixtureFetches.length !== 1 || fixtureFetches[0] !== 'GET /api/costs') {
  failures.push('Costos debe consultar una vez su bootstrap al iniciar; recibió ' + fixtureFetches.join(', '));
}
if (!fixtureNodes.get('content').innerHTML.includes('CC-&lt;100&gt;')) failures.push('Costos no escapa ni presenta el cargo del bootstrap');
if (!fixtureNodes.get('content').innerHTML.includes('Proveedor &lt;Seguro&gt;')) failures.push('Costos no escapa ni presenta el proveedor');
if (!fixtureNodes.get('content').innerHTML.includes('data-post="cost-1"')) failures.push('Costos no presenta la acción post permitida');
if (fixtureNodes.get('content').innerHTML.includes('data-edit="cost-1"')) failures.push('Costos presenta edit pese a estar denegado por capabilities');
if (fixtureNodes.get('content').innerHTML.includes('data-void="cost-1"')) failures.push('Costos presenta void pese a estar denegado por capabilities');
if ((fixtureNodes.get('metrics').innerHTML.match(/<article/g) || []).length !== 5) failures.push('Costos no presenta exactamente cinco métricas');
if (fixtureNodes.get('costsResultCount').textContent !== '1 cargo') failures.push('Costos no actualiza el contador de cargos');
if (fixtureNodes.get('newCharge').hidden) failures.push('Costos oculta la creación pese a write_access');

fixtureWindow.CostsModule?.openCost('cost-1');
if (fixtureNodes.get('detailModal').classList.contains('hidden')) failures.push('El owner canónico no abre el detalle de Costos');
if (!fixtureNodes.get('detailBody').innerHTML.includes('PO-&lt;100&gt;')) failures.push('El detalle no escapa ni presenta la distribución');

fixtureWindow.CostsModule?.openProfitability('sales_orders');
await new Promise(resolve => setTimeout(resolve, 0));
await new Promise(resolve => setTimeout(resolve, 0));
if (!fixtureFetches.includes('GET /api/profitability')) failures.push('El owner canónico no consulta la rentabilidad al activarla');
if (!fixtureNodes.get('content').innerHTML.includes('SO-&lt;100&gt;')) failures.push('Rentabilidad no escapa ni presenta la orden de venta');
if (!fixtureNodes.get('content').innerHTML.includes('Cliente &lt;Seguro&gt;')) failures.push('Rentabilidad no presenta el cliente desde el read-model');
if (fixtureFetches.some(value => !value.startsWith('GET '))) failures.push('El fixture de lectura detectó una mutación');

[
  "authorizeAdmin(req, res, req.method === 'GET' ? 'finance.read' : 'finance.write')",
  'loadCostChargeCapabilityMap(admin)',
  'capabilities:capabilityBundle.map.get',
  "'rpc/replace_cost_charge_canonical'",
  "'rpc/post_cost_charge_canonical'",
  "'rpc/void_cost_charge_canonical'",
  "message:'No se pudo procesar Costos. Intenta nuevamente.'"
].forEach(value => requireText(costsApi, value, 'API canónica de Costos ' + value));
[
  "authorizeAdmin(req, res, 'finance.read')",
  "supabase('sales_order_profitability'",
  "supabase('issued_invoice_profitability'",
  "supabase('load_profitability'",
  "supabase('operation_profitability'",
  "return fail(res, 500, 'No se pudo cargar la rentabilidad')"
].forEach(value => requireText(profitabilityApi, value, 'API canónica de Rentabilidad ' + value));
[
  'cost_charge_action_capabilities',
  'loadCostChargeCapabilityMap',
  "entry.required_permission='finance.write'"
].forEach(value => requireText(capabilityOwner, value, 'capabilities de Costos ' + value));

requireText(navigation, "openCosts: () => openEmbeddedById('costsSection')", 'navegación canónica de Costos');
requireText(autoRefresh, "costs: ['costsSection']", 'auto-refresh canónico de Costos');
requireText(ux6Gate, 'admin/profitability.js', 'gate UX-6 protege el retiro del owner paralelo');
requireText(profitabilityGate, 'no debe asignar/calcular métricas B6', 'gate financiero conserva autoridad backend');

[
  'admin/costs.html',
  'admin/costs.css',
  'admin/costs.js',
  'api/costs.js',
  'api/profitability.js',
  'scripts/check-ux7-costs-visual-owner.mjs',
  'scripts/check-ux6-costs-presentation.mjs',
  'scripts/check-sales-order-profitability.mjs',
  'node scripts/check-ux7-costs-visual-owner.mjs',
  'node scripts/check-ux6-costs-presentation.mjs',
  'node scripts/check-sales-order-profitability.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
].forEach(value => requireText(workflow, value, 'workflow ' + value));

const openingBraces = (styles.match(/{/g) || []).length;
const closingBraces = (styles.match(/}/g) || []).length;
if (openingBraces !== closingBraces) failures.push('costs.css está desbalanceado: ' + openingBraces + '/' + closingBraces);

if (failures.length) {
  console.error('UX-7 Costs visual owner gate failed:');
  failures.forEach(failure => console.error('- ' + failure));
  process.exit(1);
}

console.log('UX-7 Costs visual owner gate passed.');
console.log('- Costos y Rentabilidad usan costs.html, costs.css y costs.js como único owner visual.');
console.log('- Crear, editar, contabilizar y anular siguen exactamente write_access y las capabilities del backend.');
console.log('- La tabla desplaza internamente y el iframe espera la sesión del shell antes de consultar las APIs.');
