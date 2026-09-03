import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  html:'admin/suppliers.html',
  styles:'admin/suppliers.css',
  owner:'admin/suppliers.js',
  api:'api/suppliers.js',
  foundation:'admin/embedded-foundation.css',
  autoRefresh:'admin/embedded-auto-refresh.js',
  navigation:'admin/navigation-shell.js',
  browserstack:'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux7-suppliers-visual-owner.yml'
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
  '<body class="erp-module-page erp-module-suppliers" data-owner="suppliers.js">',
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/suppliers.css?v=20260903-ux7suppliers1',
  '/admin/suppliers.js?v=20260903-ux7suppliers1',
  '/admin/embedded-auto-refresh.js?v=20260903-ux7suppliers1',
  'class="module-hero suppliers-page-head"',
  'id="suppliersPageTitle">Proveedores',
  'class="suppliers-hero-state"',
  'id="suppliersLastUpdated"',
  'id="suppliersMetrics" class="metrics suppliers-metrics"',
  'id="supplierTotalMetric"',
  'id="supplierActiveMetric"',
  'id="supplierInactiveMetric"',
  'id="supplierContactMetric"',
  'id="suppliersReadOnlyNote"',
  'class="panel suppliers-directory-panel"',
  'id="supplierSearch" type="search"',
  'role="tablist" aria-label="Estado de proveedores"',
  'id="supplierList"',
  'id="supplierModal" class="modal supplier-modal hidden"',
  'id="supplierDetailModal" class="modal supplier-modal hidden"',
  'id="supplierDecision" class="modal supplier-modal supplier-decision hidden"',
  'id="supplierForm" novalidate',
  'id="supplierFormMessage"',
  'aria-live="polite"'
].forEach(value => requireText(html,value,`HTML canónico ${value}`));

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerStylesIndex = html.indexOf('/admin/suppliers.css?v=20260903-ux7suppliers1');
if (foundationIndex < 0 || ownerStylesIndex < 0 || foundationIndex > ownerStylesIndex) {
  failures.push('la base visual compartida debe cargar antes de suppliers.css');
}

forbid(html, /<style(?:\s|>)/i, 'suppliers.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'suppliers.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'suppliers.html conserva estilos inline');
forbid(html, /\son(?:click|change|input|submit|load|error)\s*=/i, 'suppliers.html conserva handlers inline');
forbid(html, /(?:↻|✕|☰|▧|▨|📦|🏭)/u, 'Proveedores conserva glifos decorativos improvisados');

[
  '.suppliers-page-head',
  '.suppliers-hero-state',
  '.suppliers-action-row',
  '.suppliers-feedback',
  '.suppliers-readonly',
  '.suppliers-metrics',
  '.suppliers-directory-panel',
  '.suppliers-panel-head',
  '.suppliers-toolbar',
  '.suppliers-tabs',
  '.supplier-list',
  '.supplier-card',
  '.supplier-card-actions',
  '.supplier-status',
  '.supplier-modal',
  '.supplier-dialog',
  '.supplier-form-grid',
  '.supplier-detail-body',
  '.supplier-decision-dialog',
  '.suppliers-loading',
  '.suppliers-empty',
  '.suppliers-spinner',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value => requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del documento');
forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'suppliers.css conserva importación tardía, sobrescritura o estética legacy');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'suppliers.css mezcla comportamiento de JavaScript');
forbid(foundation, /\.erp-module-suppliers/, 'la base compartida conserva reglas propietarias de Proveedores');

[
  "owner:'suppliers.js'",
  "source:'api/suppliers.js'",
  "const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  'function safeSupplierMessage(',
  'function supplierError(',
  'function visibleSuppliers()',
  'function renderMetrics()',
  'function renderTabs()',
  'function supplierCard(',
  'function renderList()',
  'function renderLoading()',
  'function renderLoadError()',
  'function openDetails(',
  'function openSupplier(',
  'function saveSupplier(',
  'function decision(',
  'function toggleSupplier(',
  'function startSuppliers()',
  'function handleStoredSession(event)',
  "window.addEventListener('storage', handleStoredSession)",
  "request('/api/suppliers'",
  "data.write_access === true",
  "method:state.editingId ? 'PATCH' : 'POST'",
  "method:'PATCH'",
  "setAttribute('aria-busy'",
  "setAttribute('aria-selected'",
  'window.load = () => load(false);',
  'window.SuppliersModule = Object.freeze({'
].forEach(value => requireText(owner,value,`owner de Proveedores ${value}`));

if ((owner.match(/error\?\.message/g) || []).length !== 1) {
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Proveedores');
}
forbid(owner, /\berror\.message\b|\be\.message\b/, 'Proveedores vuelve a renderizar mensajes técnicos directamente');
forbid(owner, /\sstyle\s*=/i, 'suppliers.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'suppliers.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'suppliers.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b|\bResizeObserver\b/, 'suppliers.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'suppliers.js vuelve a usar diálogos nativos');
forbid(owner, /location\.(?:href|replace)\s*=\s*['"]\/admin\/pwa\.html/, 'Proveedores vuelve a montar el ERP completo dentro del iframe');
forbid(owner, /[?&]token=|(?:searchParams|params)\.set\(\s*['"]token['"]/, 'Proveedores expone el token en la URL');
forbid(owner, /method\s*:\s*['"]DELETE['"]/i, 'Proveedores introduce eliminación física');

[
  "authorizeAdmin(req, res, req.method === 'GET' ? 'procurement.read' : 'procurement.write')",
  "supabase('admin_effective_permissions'",
  'permission_key=eq.procurement.write',
  'write_access:writeAccess',
  "writeAudit(admin, 'supplier_created'",
  "writeAudit(admin, 'supplier_updated'",
  "'supplier_reactivated' : 'supplier_deactivated'"
].forEach(value => requireText(api,value,`API autoritativa ${value}`));
[
  "id:'suppliersSection'",
  "src:'/admin/suppliers.html?embedded=1'"
].forEach(value => requireText(navigation,value,`navegación de Proveedores ${value}`));
[
  "openSection(page, 'suppliersSection')",
  'Suppliers has one visual owner and a responsive directory',
  'suppliers-iphone-safari',
  "suppliersState.owner !== 'suppliers.js'",
  'submitted:false'
].forEach(value => requireText(browserstack,value,`certificación iPhone ${value}`));
[
  "openSection(page, 'suppliersSection')",
  'SUPPLIERS_[A-Z_]+_FAILED'
].forEach(value => requireText(browserstackGate,value,`gate BrowserStack ${value}`));
requireText(workflow,'node scripts/check-ux7-suppliers-visual-owner.mjs','workflow del owner visual de Proveedores');

const openBraces = (styles.match(/{/g) || []).length;
const closeBraces = (styles.match(/}/g) || []).length;
if (openBraces !== closeBraces) failures.push(`suppliers.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

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

function executeSuppliers({ sessionToken = '', search = '?embedded=1', responseData = null } = {}) {
  const ids = [
    'supplierMessage','supplierFormMessage','newSupplier','suppliersReadOnlyNote','editSupplierFromDetail',
    'supplierTotalMetric','supplierActiveMetric','supplierInactiveMetric','supplierContactMetric',
    'supplierResultCount','supplierList','refreshSuppliers','suppliersLastUpdated','supplierSearch',
    'supplierModal','supplierDetailModal','supplierDecision','supplierModalTitle','supplierDetailTitle',
    'supplierDetailBody','supplierDecisionTitle','supplierDecisionText','supplierDecisionCancel','supplierDecisionConfirm',
    'supplierForm','supplierName','supplierLegalName','supplierCountry','supplierTaxId','supplierEmail',
    'supplierPhone','supplierAddress','supplierNotes','saveSupplier'
  ];
  const nodes = new Map(ids.map(id => [id,new FakeElement(id)]));
  ['supplierModal','supplierDetailModal','supplierDecision'].forEach(id => {
    nodes.get(id).classList.add('modal','supplier-modal','hidden');
  });
  nodes.get('suppliersReadOnlyNote').hidden = true;
  const views = ['active','inactive','all'].map(value => {
    const node = new FakeElement(`view-${value}`, value === 'active' ? ['active'] : []);
    node.dataset.view = value;
    return node;
  });
  const closeSupplier = [new FakeElement('close-supplier-1'),new FakeElement('close-supplier-2')];
  const closeDetail = [new FakeElement('close-detail-1'),new FakeElement('close-detail-2')];
  const listeners = new Map();
  const redirects = [];
  const requests = [];
  const body = new FakeElement('body',['erp-module-page','erp-module-suppliers']);
  const document = {
    activeElement:null,
    body,
    getElementById:id => nodes.get(id) || null,
    querySelectorAll:selector => {
      if (selector === '[data-view]') return views;
      if (selector === '[data-close="supplier"]') return closeSupplier;
      if (selector === '[data-close="detail"]') return closeDetail;
      return [];
    },
    querySelector:selector => selector === '.supplier-modal:not(.hidden)'
      ? [...nodes.values()].find(node => node.classList.contains('supplier-modal') && !node.classList.contains('hidden')) || null
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
    return { status:200, ok:true, json:async () => responseData || { suppliers:[], write_access:false } };
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

const waiting = executeSuppliers({ sessionToken:'' });
if (waiting.requests.length) failures.push('Proveedores embebido consulta la API antes de recibir la sesión');
if (waiting.redirects.length) failures.push(`Proveedores embebido redirige antes de recibir la sesión: ${waiting.redirects.join(', ')}`);
if (!waiting.listeners.has('storage')) failures.push('Proveedores embebido sin token no espera la sesión del shell');
if (waiting.nodes.get('suppliersLastUpdated').textContent !== 'Esperando sesión segura…') failures.push('Proveedores no comunica la espera segura de sesión');

const fixturePayload = {
  suppliers:[
    { id:'supplier-1', name:'North <&> Foods', legal_name:'North Foods LLC', country:'Estados Unidos', tax_id:'EIN-100', email:'ops@example.test', phone:'', active:true },
    { id:'supplier-2', name:'Proveedor histórico', legal_name:'', country:'México', tax_id:'', email:'', phone:'', active:false }
  ],
  write_access:false
};
const fixture = executeSuppliers({ sessionToken:'fixture-token', responseData:fixturePayload });
await new Promise(resolve => setTimeout(resolve,20));
if (fixture.requests.length !== 1 || fixture.requests[0].url !== '/api/suppliers' || fixture.requests[0].method !== 'GET') {
  failures.push(`Proveedores no realizó una única lectura inicial canónica: ${JSON.stringify(fixture.requests)}`);
}
if (fixture.nodes.get('supplierTotalMetric').textContent !== '2') failures.push('Proveedores no actualizó la métrica total');
if (fixture.nodes.get('supplierActiveMetric').textContent !== '1') failures.push('Proveedores no actualizó la métrica activa');
if (fixture.nodes.get('supplierInactiveMetric').textContent !== '1') failures.push('Proveedores no actualizó la métrica inactiva');
if (fixture.nodes.get('supplierContactMetric').textContent !== '1') failures.push('Proveedores no actualizó la métrica de contacto');
if (fixture.nodes.get('supplierResultCount').textContent !== '1 proveedor') failures.push('Proveedores no aplica la vista activa inicial');
if (!fixture.nodes.get('supplierList').innerHTML.includes('North &lt;&amp;&gt; Foods')) failures.push('Proveedores no escapa contenido operativo al renderizar');
if (fixture.nodes.get('supplierList').innerHTML.includes('data-supplier-action="edit"')) failures.push('Proveedores expone edición sin permiso de escritura');
if (fixture.nodes.get('newSupplier').hidden !== true || fixture.nodes.get('suppliersReadOnlyNote').hidden !== false) failures.push('Proveedores no presenta correctamente el acceso de solo lectura');
if (fixture.nodes.get('supplierList').attributes.get('aria-busy') !== 'false') failures.push('Proveedores no liberó aria-busy al terminar la lectura');
if (fixture.nodes.get('suppliersLastUpdated').textContent.includes('Preparando')) failures.push('Proveedores no actualizó la hora de lectura');
if (fixture.window.SuppliersModule?.owner !== 'suppliers.js' || fixture.window.SuppliersModule?.source !== 'api/suppliers.js') failures.push('Proveedores no expone su owner canónico');

const writable = executeSuppliers({ sessionToken:'fixture-token', responseData:{ suppliers:[fixturePayload.suppliers[0]], write_access:true } });
await new Promise(resolve => setTimeout(resolve,20));
if (writable.nodes.get('newSupplier').hidden !== false || writable.nodes.get('suppliersReadOnlyNote').hidden !== true) failures.push('Proveedores no habilita el workspace de escritura autorizado');
if (!writable.nodes.get('supplierList').innerHTML.includes('data-supplier-action="edit"') || !writable.nodes.get('supplierList').innerHTML.includes('data-supplier-action="toggle"')) failures.push('Proveedores no presenta acciones autorizadas');

if (failures.length) {
  console.error(`UX-7 Suppliers visual owner gate failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Suppliers visual owner gate passed.');
console.log('- suppliers.html, suppliers.css and suppliers.js form one responsive visual owner.');
console.log('- The runtime waits for the embedded session, escapes directory data and gates mutations by backend write access.');
console.log('- Search, status views, metrics, custom dialogs, safe errors and the iPhone read-only contract are protected.');
