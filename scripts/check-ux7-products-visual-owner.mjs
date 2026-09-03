import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  html:'admin/products.html',
  styles:'admin/products.css',
  owner:'admin/products.js',
  api:'api/products.js',
  foundation:'admin/embedded-foundation.css',
  autoRefresh:'admin/embedded-auto-refresh.js',
  navigation:'admin/navigation-shell.js',
  browserstack:'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux7-products-visual-owner.yml'
};

const failures = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file,'utf8') : '';
const requireText = (source, value, label = value) => {
  if (!source.includes(value)) failures.push(`falta ${label}`);
};
const forbid = (source, pattern, label) => {
  if (pattern.test(source)) failures.push(label);
};

Object.values(files).forEach(file => {
  if (!fs.existsSync(file)) failures.push(`falta ${file}`);
});

const html = read(files.html);
const styles = read(files.styles);
const owner = read(files.owner);
const api = read(files.api);
const foundation = read(files.foundation);
const navigation = read(files.navigation);
const browserstack = read(files.browserstack);
const browserstackGate = read(files.browserstackGate);
const workflow = read(files.workflow);

[
  '<body class="erp-module-page erp-module-products" data-owner="products.js">',
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/products.css?v=20260903-ux7products1',
  '/admin/products.js?v=20260903-ux7products1',
  '/admin/embedded-auto-refresh.js?v=20260903-ux7products1',
  'class="module-hero products-page-head"',
  'id="productsPageTitle">Productos',
  'class="products-hero-state"',
  'id="productsLastUpdated"',
  'class="products-boundary-note"',
  'Catálogo e inventario son fuentes distintas.',
  'id="productsMetrics" class="metrics products-metrics"',
  'id="productTotalMetric"',
  'id="productActiveMetric"',
  'id="productInactiveMetric"',
  'id="productSkuMetric"',
  'id="productPalletMetric"',
  'id="productsReadOnlyNote"',
  'class="panel products-catalog-panel"',
  'id="productSearch" type="search"',
  'role="tablist" aria-label="Estado de productos"',
  'id="productList"',
  'id="productModal" class="modal product-modal hidden"',
  'id="productDetailModal" class="modal product-modal hidden"',
  'id="productDecision" class="modal product-modal product-decision hidden"',
  'id="productForm" novalidate',
  'id="productFormMessage"',
  'aria-live="polite"'
].forEach(value => requireText(html,value,`HTML canónico ${value}`));

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerStylesIndex = html.indexOf('/admin/products.css?v=20260903-ux7products1');
if (foundationIndex < 0 || ownerStylesIndex < 0 || foundationIndex > ownerStylesIndex) {
  failures.push('la base visual compartida debe cargar antes de products.css');
}

forbid(html, /<style(?:\s|>)/i, 'products.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'products.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'products.html conserva estilos inline');
forbid(html, /\son(?:click|change|input|submit|load|error)\s*=/i, 'products.html conserva handlers inline');
forbid(html, /(?:↻|✕|☰|▧|▨|📦|🏭)/u, 'Productos conserva glifos decorativos improvisados');

[
  '.products-page-head',
  '.products-hero-state',
  '.products-action-row',
  '.products-feedback',
  '.products-boundary-note',
  '.products-readonly',
  '.products-metrics',
  '.products-catalog-panel',
  '.products-panel-head',
  '.products-toolbar',
  '.products-tabs',
  '.product-list',
  '.product-card',
  '.product-card-actions',
  '.product-status',
  '.product-modal',
  '.product-dialog',
  '.product-form-grid',
  '.product-detail-body',
  '.product-decision-dialog',
  '.products-loading',
  '.products-empty',
  '.products-spinner',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value => requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del documento');
forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'products.css conserva importación tardía, sobrescritura o estética legacy');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'products.css mezcla comportamiento de JavaScript');
forbid(foundation, /\.erp-module-products/, 'la base compartida conserva reglas propietarias de Productos');

[
  "owner:'products.js'",
  "source:'api/products.js'",
  "const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  'function safeProductMessage(',
  'function productError(',
  'function visibleProducts()',
  'function formatNumber(',
  'function renderMetrics()',
  'function renderTabs()',
  'function productCard(',
  'function renderList()',
  'function renderLoading()',
  'function renderLoadError()',
  'function openDetails(',
  'function openProduct(',
  'function saveProduct(',
  'function decision(',
  'function toggleProduct(',
  'function startProducts()',
  'function handleStoredSession(event)',
  "window.addEventListener('storage', handleStoredSession)",
  "request('/api/products'",
  "data.write_access === true",
  "method:state.editingId ? 'PATCH' : 'POST'",
  "method:'PATCH'",
  "setAttribute('aria-busy'",
  "setAttribute('aria-selected'",
  'window.load = () => load(false);',
  'window.ProductsModule = Object.freeze({'
].forEach(value => requireText(owner,value,`owner de Productos ${value}`));

if ((owner.match(/error\?\.message/g) || []).length !== 1) {
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Productos');
}
forbid(owner, /\berror\.message\b|\be\.message\b/, 'Productos vuelve a renderizar mensajes técnicos directamente');
forbid(owner, /\sstyle\s*=/i, 'products.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'products.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'products.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b|\bResizeObserver\b/, 'products.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'products.js vuelve a usar diálogos nativos');
forbid(owner, /location\.(?:href|replace)\s*=\s*['"]\/admin\/pwa\.html/, 'Productos vuelve a montar el ERP completo dentro del iframe');
forbid(owner, /[?&]token=|(?:searchParams|params)\.set\(\s*['"]token['"]/, 'Productos expone el token en la URL');
forbid(owner, /method\s*:\s*['"]DELETE['"]/i, 'Productos introduce eliminación física');

[
  "authorizeAdmin(req, res, req.method === 'GET' ? 'procurement.read' : 'procurement.write')",
  "supabase('admin_effective_permissions'",
  'permission_key=eq.procurement.write',
  'write_access:writeAccess',
  "writeAudit(admin, 'product_created'",
  "writeAudit(admin, 'product_updated'",
  "'product_reactivated' : 'product_deactivated'",
  'La unidad base debe ser texto',
  'Unidades por pallet inválidas'
].forEach(value => requireText(api,value,`API autoritativa ${value}`));
[
  "id:'productsSection'",
  "src:'/admin/products.html?embedded=1'"
].forEach(value => requireText(navigation,value,`navegación de Productos ${value}`));
[
  "openSection(page, 'productsSection')",
  'Products has one visual owner and a responsive catalog',
  'products-iphone-safari',
  "productsState.owner !== 'products.js'",
  'submitted:false'
].forEach(value => requireText(browserstack,value,`certificación iPhone ${value}`));
[
  "openSection(page, 'productsSection')",
  'PRODUCTS_[A-Z_]+_FAILED'
].forEach(value => requireText(browserstackGate,value,`gate BrowserStack ${value}`));
requireText(workflow,'node scripts/check-ux7-products-visual-owner.mjs','workflow del owner visual de Productos');

const openBraces = (styles.match(/{/g) || []).length;
const closeBraces = (styles.match(/}/g) || []).length;
if (openBraces !== closeBraces) failures.push(`products.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

class FakeClassList {
  constructor(...names) { this.names = new Set(names); }
  add(...names) { names.forEach(name => this.names.add(name)); }
  remove(...names) { names.forEach(name => this.names.delete(name)); }
  toggle(name, force) {
    const active = force === undefined ? !this.names.has(name) : Boolean(force);
    if (active) this.names.add(name); else this.names.delete(name);
    return active;
  }
  contains(name) { return this.names.has(name); }
}

class FakeElement {
  constructor(id = '', classes = []) {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.className = classes.join(' ');
    this.classList = new FakeClassList(...classes);
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.tabIndex = 0;
    this.isConnected = true;
    this.attributes = new Map();
    this.listeners = new Map();
  }
  addEventListener(type, handler) { this.listeners.set(type,handler); }
  setAttribute(name, value) { this.attributes.set(name,String(value)); }
  querySelector() { return null; }
  focus() {}
  checkValidity() { return true; }
  reportValidity() {}
}

function executeProducts({ sessionToken = '', search = '?embedded=1', responseData = null } = {}) {
  const ids = [
    'productMessage','productFormMessage','newProduct','productsReadOnlyNote','editProductFromDetail',
    'productTotalMetric','productActiveMetric','productInactiveMetric','productSkuMetric','productPalletMetric',
    'productResultCount','productList','refreshProducts','productsLastUpdated','productSearch',
    'productModal','productDetailModal','productDecision','productModalTitle','productDetailTitle',
    'productDetailBody','productDecisionTitle','productDecisionText','productDecisionCancel','productDecisionConfirm',
    'productForm','productSku','productName','productBrand','productCategory','productUnit','productFormat',
    'productUnitsPallet','productWeight','productVolume','productOrigin','productHs','productDescription','productNotes','saveProduct'
  ];
  const nodes = new Map(ids.map(id => [id,new FakeElement(id)]));
  ['productModal','productDetailModal','productDecision'].forEach(id => {
    nodes.get(id).classList.add('modal','product-modal','hidden');
  });
  nodes.get('productsReadOnlyNote').hidden = true;
  const views = ['active','inactive','all'].map(value => {
    const node = new FakeElement(`view-${value}`, value === 'active' ? ['active'] : []);
    node.dataset.view = value;
    return node;
  });
  const closeProduct = [new FakeElement('close-product-1'),new FakeElement('close-product-2')];
  const closeDetail = [new FakeElement('close-detail-1'),new FakeElement('close-detail-2')];
  const listeners = new Map();
  const redirects = [];
  const requests = [];
  const body = new FakeElement('body',['erp-module-page','erp-module-products']);
  const document = {
    activeElement:null,
    body,
    getElementById:id => nodes.get(id) || null,
    querySelectorAll:selector => {
      if (selector === '[data-view]') return views;
      if (selector === '[data-close="product"]') return closeProduct;
      if (selector === '[data-close="detail"]') return closeDetail;
      return [];
    },
    querySelector:selector => selector === '.product-modal:not(.hidden)'
      ? [...nodes.values()].find(node => node.classList.contains('product-modal') && !node.classList.contains('hidden')) || null
      : null,
    addEventListener:(type,handler) => listeners.set(`document:${type}`,handler)
  };
  const location = { search, replace:path => redirects.push(`self:${path}`) };
  const window = {
    addEventListener:(type,handler) => listeners.set(type,handler),
    removeEventListener:type => listeners.delete(type),
    dispatchEvent() {},
    location
  };
  window.top = { location:{ replace:path => redirects.push(`top:${path}`) } };
  window.parent = window;
  const localStorage = {
    getItem:key => key === 'export_mca_token' ? sessionToken : null,
    removeItem() {}
  };
  const fetch = async (url, options = {}) => {
    requests.push({ url:String(url), method:String(options.method || 'GET').toUpperCase() });
    return { status:200, ok:true, json:async () => responseData || { products:[], write_access:false } };
  };
  const context = {
    window, parent:window, document, location, localStorage, fetch,
    URLSearchParams, Intl, Date, console, setTimeout, clearTimeout,
    HTMLElement:FakeElement,
    CustomEvent:class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  };
  vm.runInNewContext(owner,context,{filename:files.owner});
  return { nodes, views, listeners, redirects, requests, window };
}

const waiting = executeProducts({ sessionToken:'' });
if (waiting.requests.length) failures.push('Productos embebido consulta la API antes de recibir la sesión');
if (waiting.redirects.length) failures.push(`Productos embebido redirige antes de recibir la sesión: ${waiting.redirects.join(', ')}`);
if (!waiting.listeners.has('storage')) failures.push('Productos embebido sin token no espera la sesión del shell');
if (waiting.nodes.get('productsLastUpdated').textContent !== 'Esperando sesión segura…') failures.push('Productos no comunica la espera segura de sesión');

const fixturePayload = {
  products:[
    { id:'product-1', sku:'SKU<1>', name:'Aceite <Seguro>', brand:'Marca & Co', category:'Aceites', unit:'cajas', package_format:'Caja 4', default_units_per_pallet:48, unit_weight_kg:15.875, unit_volume_m3:0.04, country_of_origin:'Estados Unidos', hs_code:'1507', active:true },
    { id:'product-2', sku:'', name:'Producto histórico', brand:'', category:'', unit:'unidades', package_format:'', default_units_per_pallet:null, unit_weight_kg:null, unit_volume_m3:null, country_of_origin:'', hs_code:'', active:false }
  ],
  write_access:false
};
const fixture = executeProducts({ sessionToken:'fixture-token', responseData:fixturePayload });
await new Promise(resolve => setTimeout(resolve,20));
if (fixture.requests.length !== 1 || fixture.requests[0].url !== '/api/products' || fixture.requests[0].method !== 'GET') {
  failures.push(`Productos no realizó una única lectura inicial canónica: ${JSON.stringify(fixture.requests)}`);
}
if (fixture.nodes.get('productTotalMetric').textContent !== '2') failures.push('Productos no actualizó la métrica total');
if (fixture.nodes.get('productActiveMetric').textContent !== '1') failures.push('Productos no actualizó la métrica activa');
if (fixture.nodes.get('productInactiveMetric').textContent !== '1') failures.push('Productos no actualizó la métrica inactiva');
if (fixture.nodes.get('productSkuMetric').textContent !== '1') failures.push('Productos no actualizó la métrica SKU');
if (fixture.nodes.get('productPalletMetric').textContent !== '1') failures.push('Productos no actualizó la métrica de pallet');
if (fixture.nodes.get('productResultCount').textContent !== '1 producto') failures.push('Productos no aplica la vista activa inicial');
if (!fixture.nodes.get('productList').innerHTML.includes('Aceite &lt;Seguro&gt;')) failures.push('Productos no escapa el nombre al renderizar');
if (!fixture.nodes.get('productList').innerHTML.includes('Marca &amp; Co')) failures.push('Productos no escapa la marca al renderizar');
if (fixture.nodes.get('productList').innerHTML.includes('data-product-action="edit"')) failures.push('Productos expone edición sin permiso de escritura');
if (fixture.nodes.get('newProduct').hidden !== true || fixture.nodes.get('productsReadOnlyNote').hidden !== false) failures.push('Productos no presenta correctamente el acceso de solo lectura');
if (fixture.nodes.get('productList').attributes.get('aria-busy') !== 'false') failures.push('Productos no liberó aria-busy al terminar la lectura');
if (fixture.nodes.get('productsLastUpdated').textContent.includes('Preparando')) failures.push('Productos no actualizó la hora de lectura');
if (fixture.window.ProductsModule?.owner !== 'products.js' || fixture.window.ProductsModule?.source !== 'api/products.js') failures.push('Productos no expone su owner canónico');

const writable = executeProducts({ sessionToken:'fixture-token', responseData:{ products:[fixturePayload.products[0]], write_access:true } });
await new Promise(resolve => setTimeout(resolve,20));
if (writable.nodes.get('newProduct').hidden !== false || writable.nodes.get('productsReadOnlyNote').hidden !== true) failures.push('Productos no habilita el workspace de escritura autorizado');
if (!writable.nodes.get('productList').innerHTML.includes('data-product-action="edit"') || !writable.nodes.get('productList').innerHTML.includes('data-product-action="toggle"')) failures.push('Productos no presenta acciones autorizadas');

if (failures.length) {
  console.error(`UX-7 Products visual owner gate failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Products visual owner gate passed.');
console.log('- products.html, products.css and products.js form one responsive visual owner.');
console.log('- The runtime separates catalog identity from inventory, waits for session and gates mutations by backend write access.');
console.log('- Search, status views, metrics, custom dialogs, safe errors and the iPhone read-only contract are protected.');
