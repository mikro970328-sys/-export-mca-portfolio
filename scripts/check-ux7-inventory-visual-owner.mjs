import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  html: 'admin/inventory.html',
  styles: 'admin/inventory.css',
  owner: 'admin/inventory.js',
  foundation: 'admin/embedded-foundation.css',
  api: 'api/inventory.js',
  navigation: 'admin/operational-navigation.js',
  bridge: 'admin/operational-context-bridge.js',
  contextualGate: 'scripts/check-contextual-sync.mjs',
  workflow: '.github/workflows/ux6b-embedded-foundation.yml'
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
const api = read(files.api);
const navigation = read(files.navigation);
const bridge = read(files.bridge);
const contextualGate = read(files.contextualGate);
const workflow = read(files.workflow);

for (const text of [
  '<body class="erp-module-page erp-module-inventory" data-owner="inventory.js">',
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/inventory.css?v=20260902-ux7inventory1',
  '/admin/inventory.js?v=20260902-ux7inventory1',
  '/admin/embedded-auto-refresh.js?v=20260902-ux7inventory1',
  'class="module-hero inventory-page-head"',
  'id="stats" class="stats inventory-metrics"',
  'role="tablist"',
  'data-inventory-view="stock"',
  'data-inventory-view="trace"',
  'role="tabpanel"',
  'id="clearFilters"',
  'id="purchaseOriginCard"',
  'id="salesUsageCard"',
  'aria-live="polite"'
]) requireText(html, text, `HTML canónico ${text}`);

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerCssIndex = html.indexOf('/admin/inventory.css?v=20260902-ux7inventory1');
if (foundationIndex < 0 || ownerCssIndex < 0 || foundationIndex > ownerCssIndex) {
  failures.push('la base visual compartida debe cargar antes de inventory.css');
}

forbid(html, /<style(?:\s|>)/i, 'inventory.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'inventory.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'inventory.html conserva estilos inline');
forbid(html, /\son(?:click|change|input|submit|load|error)\s*=/i, 'inventory.html conserva handlers inline');

for (const selector of [
  '.inventory-page-head',
  '.inventory-metrics',
  '.inventory-view-switcher',
  '.inventory-filter-panel',
  '.inventory-list-panel',
  '.inventory-row-toggle',
  '.inventory-source-wrap',
  '.inventory-trace-panel',
  '.inventory-context-panel',
  '.inventory-empty',
  '.inventory-spinner',
  '@media(max-width:1100px)',
  '@media(max-width:820px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
]) requireText(styles, selector, `CSS propietario ${selector}`);

forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'inventory.css conserva estilos legacy, una importación tardía o una sobrescritura');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'inventory.css mezcla comportamiento de JavaScript');
forbid(foundation, /erp-module-inventory/, 'la base compartida conserva reglas propietarias de Inventario');

for (const text of [
  "owner: 'inventory.js'",
  "const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  'function safeInventoryMessage(',
  'INVENTORY_UI_FAILED',
  'function renderStats()',
  'function renderInventory()',
  'function renderTrace()',
  'async function renderOperationalContext(',
  'function traceWR(',
  'async function load()',
  'function startInventory(',
  'function handleStoredSession(',
  "window.addEventListener('storage', handleStoredSession)",
  "tab.setAttribute('aria-selected', String(active))",
  'data-toggle-inventory',
  'data-trace-wr',
  'data-context-kind',
  "parentCan('procurement.read')",
  "parentCan('logistics.read')",
  "parentCan('sales.read')"
]) requireText(owner, text, `owner de Inventario ${text}`);

if ((owner.match(/error\?\.message/g) || []).length !== 1) {
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Inventario');
}
forbid(owner, /\berror\.message\b/, 'Inventario vuelve a renderizar error.message directamente');
forbid(owner, /\be\.message\b/, 'Inventario vuelve a renderizar e.message directamente');
forbid(owner, /\sstyle\s*=/i, 'inventory.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'inventory.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'inventory.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b/, 'inventory.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'inventory.js vuelve a usar diálogos nativos');
forbid(owner, /location\.replace\(['"]\/admin\/pwa\.html['"]\)/, 'Inventario vuelve a montar el ERP completo dentro del iframe');
forbid(owner, /if\s*\(!token\)\s*location\.(?:href|replace)/, 'Inventario redirige el iframe antes de que el shell complete el inicio de sesión');

const embeddedListeners = new Map();
const embeddedRedirects = [];
let embeddedFetches = 0;
const embeddedWindow = {
  top: {
    location: {
      replace(path) {
        embeddedRedirects.push(`top:${path}`);
      }
    }
  },
  addEventListener(type, handler) {
    embeddedListeners.set(type, handler);
  },
  removeEventListener(type) {
    embeddedListeners.delete(type);
  }
};

vm.runInNewContext(owner, {
  URLSearchParams,
  console,
  document: { getElementById: () => null },
  fetch: async () => {
    embeddedFetches += 1;
    throw new Error('No debe consultar la API antes de recibir la sesión');
  },
  localStorage: {
    getItem: () => null,
    removeItem: () => {}
  },
  location: {
    search: '?embedded=1',
    replace(path) {
      embeddedRedirects.push(`self:${path}`);
    }
  },
  window: embeddedWindow
}, { filename: files.owner });

if (embeddedRedirects.length) {
  failures.push(`Inventario embebido sin sesión redirige prematuramente: ${embeddedRedirects.join(', ')}`);
}
if (!embeddedListeners.has('storage')) {
  failures.push('Inventario embebido sin sesión no espera el token del shell');
}
if (embeddedFetches) {
  failures.push('Inventario embebido consulta la API antes de que el shell complete el inicio de sesión');
}

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
    const active = force === undefined ? !this.names.has(name) : Boolean(force);
    if (active) this.names.add(name);
    else this.names.delete(name);
    return active;
  }
}

function fakeElement(id, ...classes) {
  return {
    id,
    value: '',
    innerHTML: '',
    textContent: '',
    className: classes.join(' '),
    classList: new FakeClassList(...classes),
    dataset: {},
    attributes: new Map(),
    listeners: new Map(),
    tabIndex: 0,
    addEventListener(type, handler) {
      this.listeners.set(type, handler);
    },
    setAttribute(name, value) {
      this.attributes.set(name, String(value));
    },
    focus() {}
  };
}

const fixtureNodes = new Map();
for (const id of [
  'warehouseFilter', 'search', 'stats', 'stockCount', 'inventoryList', 'traceCount',
  'traceList', 'purchaseOriginCard', 'salesUsageCard', 'traceContextLabel', 'stockView',
  'traceView', 'stockLegend', 'traceLegend', 'inventoryFeedback', 'clearFilters', 'stockTab',
  'traceTab'
]) fixtureNodes.set(id, fakeElement(id));

for (const id of ['traceView', 'traceLegend', 'purchaseOriginCard', 'salesUsageCard', 'inventoryFeedback']) {
  fixtureNodes.get(id).classList.add('hidden');
}
fixtureNodes.get('stockTab').dataset.inventoryView = 'stock';
fixtureNodes.get('traceTab').dataset.inventoryView = 'trace';

const fixtureWindow = {
  addEventListener() {},
  removeEventListener() {}
};
fixtureWindow.parent = fixtureWindow;
fixtureWindow.top = fixtureWindow;

let fixtureFetches = 0;
vm.runInNewContext(owner, {
  URLSearchParams,
  console,
  document: {
    getElementById: id => fixtureNodes.get(id) || null,
    querySelectorAll: selector => selector === '[data-inventory-view]'
      ? [fixtureNodes.get('stockTab'), fixtureNodes.get('traceTab')]
      : []
  },
  fetch: async () => {
    fixtureFetches += 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        inventory: [{
          warehouse_id: 'warehouse-1',
          product_id: 'product-1',
          product: { sku: 'SKU-100', name: 'Producto <Prueba>', brand: 'Marca', unit: 'cajas' },
          warehouse: { code: 'MIA', name: 'Miami' },
          physical_quantity: 120,
          physical_pallets: 10,
          reserved_quantity: 24,
          reserved_pallets: 2,
          available_quantity: 96,
          available_pallets: 8,
          sources: [{
            receipt_number: 'WR-100',
            lot_number: 'L-01',
            physical_quantity: 120,
            physical_pallets: 10,
            reserved_quantity: 24,
            reserved_pallets: 2,
            available_quantity: 96,
            available_pallets: 8,
            units_per_pallet: 12,
            movement_count: 2
          }]
        }],
        warehouses: [{ id: 'warehouse-1', code: 'MIA', name: 'Miami', active: true }],
        traceability: [{
          occurred_at: '2026-09-02T12:00:00.000Z',
          movement_type: 'receipt',
          receipt_number: 'WR-100',
          product_name: 'Producto <Prueba>',
          product_sku: 'SKU-100',
          warehouse_id: 'warehouse-1',
          warehouse_code: 'MIA',
          warehouse_name: 'Miami',
          quantity_delta: 120,
          pallets_delta: 10,
          reserved_quantity_delta: 0,
          reserved_pallets_delta: 0,
          unit: 'cajas'
        }]
      })
    };
  },
  localStorage: {
    getItem: key => key === 'export_mca_token' ? 'fixture-token' : null,
    removeItem: () => {}
  },
  location: {
    search: '?embedded=1',
    replace() {}
  },
  window: fixtureWindow
}, { filename: `${files.owner}:fixture` });

await new Promise(resolve => setTimeout(resolve, 0));

if (fixtureFetches !== 1) failures.push(`Inventario debe consultar una vez su API al iniciar; consultó ${fixtureFetches}`);
if (!fixtureNodes.get('inventoryList').innerHTML.includes('Producto &lt;Prueba&gt;')) failures.push('Inventario no escapa ni presenta el producto de la respuesta');
if (!fixtureNodes.get('inventoryList').innerHTML.includes('WR-100')) failures.push('Inventario no presenta el WR que compone la existencia');
if (fixtureNodes.get('stockCount').textContent !== '1 resultado') failures.push('Inventario no actualiza el contador de existencias');
if (!fixtureNodes.get('warehouseFilter').innerHTML.includes('MIA · Miami')) failures.push('Inventario no llena el filtro de almacenes activos');

fixtureWindow.InventoryModule?.traceWR('WR-100');
if (fixtureNodes.get('search').value !== 'WR-100') failures.push('traceWR no aplica el filtro del WR solicitado');
if (!fixtureNodes.get('stockView').classList.contains('hidden')) failures.push('traceWR no oculta la vista de existencias');
if (fixtureNodes.get('traceView').classList.contains('hidden')) failures.push('traceWR no muestra la vista de trazabilidad');
if (!fixtureNodes.get('traceList').innerHTML.includes('Recepción WR')) failures.push('traceWR no presenta el movimiento de recepción');
if (fixtureNodes.get('traceTab').attributes.get('aria-selected') !== 'true') failures.push('traceWR no sincroniza el estado accesible de las pestañas');

for (const text of [
  "authorizeAdmin(req, res, 'warehouse.read')",
  "supabase('inventory_source_balances'",
  "supabase('inventory_traceability'",
  "console.error('INVENTORY_API_ERROR'",
  "return fail(res, 500, 'No se pudo cargar el inventario. Intenta nuevamente.'",
  "code:'INVENTORY_UNEXPECTED_ERROR'"
]) requireText(api, text, `API segura de Inventario ${text}`);
forbid(api, /fail\(res,\s*400,\s*error\.message/, 'API de Inventario vuelve a devolver errores internos crudos');

requireText(navigation, "return callEmbedded('inventorySection','traceWR',[receipt]);", 'navegación directa hacia traceWR');
forbid(navigation, /CONTEXT_SECTIONS[^;]*inventorySection/, 'Inventario sigue recibiendo el bridge visual compartido');
forbid(navigation, /openInventoryReceipt[^\n]*installBridge\('inventorySection'\)/, 'openInventoryReceipt todavía inyecta el bridge anterior');
forbid(bridge, /function initInventory\s*\(/, 'el bridge conserva un segundo owner de Inventario');
forbid(bridge, /\/admin\/inventory\.html/, 'el bridge todavía se activa dentro de Inventario');
requireText(contextualGate, 'openOperationalPurchaseReceipt', 'gate contextual preservado');

for (const text of [
  'admin/inventory.css',
  'admin/inventory.js',
  'admin/operational-navigation.js',
  'admin/operational-context-bridge.js',
  'api/inventory.js',
  'scripts/check-ux7-inventory-visual-owner.mjs',
  'node scripts/check-ux7-inventory-visual-owner.mjs',
  'node scripts/check-contextual-sync.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs'
]) requireText(workflow, text, `workflow ${text}`);

const openingBraces = (styles.match(/{/g) || []).length;
const closingBraces = (styles.match(/}/g) || []).length;
if (openingBraces !== closingBraces) failures.push(`inventory.css está desbalanceado: ${openingBraces}/${closingBraces}`);

if (failures.length) {
  console.error('UX-7 Inventory visual owner gate failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 Inventory visual owner gate passed.');
console.log('- Inventario usa los owners canónicos inventory.html, inventory.css e inventory.js.');
console.log('- Existencias, filtros y trazabilidad WR conservan navegación operacional y acceso por rol.');
console.log('- El iframe espera la sesión del shell y nunca monta una pantalla de acceso anidada.');
