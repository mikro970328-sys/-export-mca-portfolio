import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const files = {
  html:'admin/reports.html',
  styles:'admin/reports.css',
  owner:'admin/reports.js',
  foundation:'admin/embedded-foundation.css',
  autoRefresh:'admin/embedded-auto-refresh.js',
  api:'api/reports.js',
  navigation:'admin/navigation-shell.js',
  p12Gate:'scripts/check-executive-reports.mjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux7-reports-visual-owner.yml'
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
const foundation = read(files.foundation);
const api = read(files.api);
const navigation = read(files.navigation);
const browserstackGate = read(files.browserstackGate);
const workflow = read(files.workflow);

[
  '<body class="erp-module-page erp-module-reports" data-owner="reports.js">',
  '/admin/embedded-foundation.css?v=20260922-figma1',
  '/admin/reports.css?v=20260922-figma2',
  '/admin/reports.js?v=20260916-queue1',
  '/admin/embedded-auto-refresh.js?v=20260920-speed3',
  'class="module-hero reports-page-head"',
  'id="reportsPageTitle">Reportes',
  'class="reports-hero-state"',
  'id="reportLastUpdated"',
  'id="reportsMetrics" class="metrics reports-metrics"',
  'id="reportDatasetMetric"',
  'id="reportRowsMetric"',
  'id="reportBasisMetric"',
  'id="reportCurrencyMetric"',
  'id="reportFiltersMetric"',
  'class="panel reports-control-panel"',
  'role="tablist" aria-label="Tipos de reporte"',
  'data-filter-dimension="period"',
  'data-filter-dimension="currency"',
  'data-filter-dimension="client"',
  'data-filter-dimension="supplier"',
  'data-filter-dimension="product"',
  'id="reportMeta"',
  'class="panel reports-table-panel"',
  'id="reportDataTitle"',
  'id="reportResultCount"',
  'id="reportTable"',
  'aria-live="polite"'
].forEach(value => requireText(html,value,`HTML canónico ${value}`));

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260922-figma1');
const ownerStylesIndex = html.indexOf('/admin/reports.css?v=20260922-figma2');
if (foundationIndex < 0 || ownerStylesIndex < 0 || foundationIndex > ownerStylesIndex) {
  failures.push('la base visual compartida debe cargar antes de reports.css');
}

forbid(html, /<style(?:\s|>)/i, 'reports.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'reports.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'reports.html conserva estilos inline');
forbid(html, /\son(?:click|change|input|submit|load|error)\s*=/i, 'reports.html conserva handlers inline');
forbid(html, /(?:↻|✕|☰|▧|▨|📊|📈|📉)/u, 'Reportes conserva glifos decorativos improvisados');

[
  '.reports-page-head',
  '.reports-hero-state',
  '.reports-action-row',
  '.reports-feedback',
  '.reports-metrics',
  '.reports-control-panel',
  '.reports-panel-head',
  '.reports-dataset-tabs',
  '.reports-filter-grid',
  '.reports-filter-footer',
  '.reports-table-panel',
  '.reports-table-wrap',
  '.report-table',
  '.report-status',
  '.reports-empty',
  '.reports-loading',
  '.reports-spinner',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value => requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del documento');
requireText(styles,'overflow:auto;','scroll interno de la tabla');
requireText(styles,'width:max-content;','tabla ancha contenida por su región');
forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'reports.css conserva importación tardía, sobrescritura o estética legacy');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'reports.css mezcla comportamiento de JavaScript');
forbid(foundation, /\.erp-module-reports/, 'la base compartida conserva reglas propietarias de Reportes');

[
  "owner:'reports.js'",
  "source:'api/reports.js'",
  "const embeddedMode = new URLSearchParams(location.search).get('embedded') === '1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  'function safeReportMessage(',
  'function reportError(',
  'function renderTabs()',
  'function setDimensions(',
  'function activeFilterCount(',
  'function buildUrl(',
  'function statusLabel(',
  'function renderMeta(',
  'function renderMetrics(',
  'function renderTable()',
  'function renderLoading()',
  'function renderLoadError()',
  'function startReports()',
  'function handleStoredSession(event)',
  "window.addEventListener('storage',handleStoredSession)",
  "request(buildUrl('json'",
  "request(buildUrl('csv'",
  "response.blob()",
  "URL.createObjectURL(blob)",
  "button.dataset.dataset",
  'aria-selected=',
  "setAttribute('aria-busy'",
  'window.load = () => loadReport(false);',
  'window.ExecutiveReports = Object.freeze({'
].forEach(value => requireText(owner,value,`owner de Reportes ${value}`));

if ((owner.match(/error\?\.message/g) || []).length !== 1) {
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Reportes');
}
forbid(owner, /\berror\.message\b|\be\.message\b/, 'Reportes vuelve a renderizar mensajes técnicos directamente');
forbid(owner, /\sstyle\s*=/i, 'reports.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'reports.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'reports.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b|\bResizeObserver\b/, 'reports.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'reports.js vuelve a usar diálogos nativos');
forbid(owner, /location\.(?:href|replace)\s*=\s*['"]\/admin\/pwa\.html/, 'Reportes vuelve a montar el ERP completo dentro del iframe');
forbid(owner, /[?&]token=|(?:searchParams|params)\.set\(\s*['"]token['"]/, 'Reportes expone el token en la URL');
forbid(owner, /recognized_merchandise_cogs\s*[+\-*/]|gross_margin\s*[+\-*/]|contribution_margin\s*[+\-*/]|balance_due\s*[+\-*/]/, 'Reportes calcula métricas financieras en el frontend');
forbid(owner, /method\s*:\s*['"](?:POST|PUT|PATCH|DELETE)['"]/i, 'Reportes introduce escrituras operativas');

[
  "authorizeAdmin(req,res,'reports.read')",
  "rpc/executive_report_dataset",
  "'separate_no_fx'",
  "Content-Disposition"
].forEach(value => requireText(api,value,`API autoritativa ${value}`));
[
  "id:'reportsSection'",
  "src:'/admin/reports.html?embedded=1'",
  "permission:'reports.read'",
  "sections:['invoicesSection','payablesSection','costsSection','reportsSection']"
].forEach(value => requireText(navigation,value,`navegación de Reportes ${value}`));
[
  "openSection(page, 'reportsSection')",
  'Reports has one visual owner and a contained result region',
  'reports-iphone-safari'
].forEach(value => requireText(read('e2e/browserstack/ux7-production-readonly.spec.cjs'),value,`certificación iPhone ${value}`));
[
  "openSection(page, 'reportsSection')",
  'REPORTS_UI_FAILED'
].forEach(value => requireText(browserstackGate,value,`gate BrowserStack ${value}`));
requireText(workflow,'node scripts/check-ux7-reports-visual-owner.mjs','workflow del owner visual de Reportes');

const openBraces = (styles.match(/{/g) || []).length;
const closeBraces = (styles.match(/}/g) || []).length;
if (openBraces !== closeBraces) failures.push(`reports.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

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
  constructor(id = '') {
    this.id = id;
    this.value = '';
    this.textContent = '';
    this.innerHTML = '';
    this.className = '';
    this.classList = new FakeClassList();
    this.dataset = {};
    this.disabled = false;
    this.hidden = false;
    this.attributes = new Map();
    this.listeners = new Map();
  }
  addEventListener(type, handler) { this.listeners.set(type,handler); }
  setAttribute(name, value) { this.attributes.set(name,String(value)); }
  click() { this.listeners.get('click')?.(); }
  remove() {}
  querySelectorAll(selector) {
    if (selector !== '[data-dataset]') return [];
    return [...this.innerHTML.matchAll(/data-dataset="([^"]+)"/g)].map(match => {
      const button = new FakeElement(`dataset-${match[1]}`);
      button.dataset.dataset = match[1];
      return button;
    });
  }
}

function executeReports({ sessionToken = '', search = '?embedded=1', responseData = null, fetchResponse = null } = {}) {
  const ids = [
    'reportMessage','currency','clientId','supplierId','productId','datasetTabs','startDate','endDate','rowLimit',
    'reportMeta','reportDatasetMetric','reportRowsMetric','reportBasisMetric','reportCurrencyMetric','reportFiltersMetric',
    'reportScope','reportDataTitle','reportDataDescription','reportResultCount','reportLastUpdated','reportTable',
    'refreshReport','exportReport','clearFilters','applyFilters'
  ];
  const nodes = new Map(ids.map(id => [id,new FakeElement(id)]));
  nodes.get('rowLimit').value = '1000';
  const dimensions = ['period','currency','client','supplier','product'].map(value => {
    const node = new FakeElement(`dimension-${value}`);
    node.dataset.filterDimension = value;
    return node;
  });
  const listeners = new Map();
  const redirects = [];
  const requests = [];
  const downloads = [];
  const document = {
    getElementById:id => nodes.get(id) || null,
    querySelectorAll:selector => selector === '[data-filter-dimension]' ? dimensions : [],
    createElement:() => { const link=new FakeElement('created');downloads.push(link);return link; },
    body:{ appendChild() {} }
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
  const fetch = async url => {
    requests.push(String(url));
    if(fetchResponse)return fetchResponse(String(url));
    return { status:200, ok:true, json:async () => responseData || {}, headers:{ get:() => '' } };
  };
  const context = {
    window, parent:window, document, location, localStorage, fetch,
    URL, URLSearchParams, Intl, Date, console,
    CustomEvent:class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }
  };
  vm.runInNewContext(owner,context,{filename:files.owner});
  return { nodes, listeners, redirects, requests, downloads, window, setSession:value=>{sessionToken=value;} };
}

const waiting = executeReports({ sessionToken:'' });
if (waiting.requests.length) failures.push('Reportes embebido consulta la API antes de recibir la sesión');
if (waiting.redirects.length) failures.push(`Reportes embebido redirige antes de recibir la sesión: ${waiting.redirects.join(', ')}`);
if (!waiting.listeners.has('storage')) failures.push('Reportes embebido sin token no espera la sesión del shell');

const fixturePayload = {
  owner:'api/reports.js',
  generated_at:'2026-09-03T15:30:00.000Z',
  report:{
    key:'sales', label:'Ventas', basis:'period_activity',
    dimensions:['period','currency','client','product'],
    columns:[
      { key:'order_date', label:'Fecha' },
      { key:'so_number', label:'Sales Order' },
      { key:'client_name', label:'Cliente' },
      { key:'status', label:'Estado' },
      { key:'currency', label:'Moneda' },
      { key:'order_total', label:'Valor SO' }
    ]
  },
  filters:{ start_date:null,end_date:null,currency:null,client_id:null,supplier_id:null,product_id:null },
  currency_policy:'separate_no_fx',
  row_count:1,
  limit:1000,
  rows:[{
    order_date:'2026-09-03', so_number:'SO-<100>', client_name:'Cliente <MCA>', status:'posted', currency:'USD', order_total:1250
  }],
  datasets:[
    { key:'sales',label:'Ventas',dimensions:['period','currency','client','product'],basis:'period_activity' },
    { key:'inventory',label:'Inventario actual',dimensions:['supplier','product'],basis:'current_snapshot' }
  ],
  filter_options:{ clients:[],suppliers:[],products:[],currencies:['USD'] }
};

const fixture = executeReports({ sessionToken:'fixture-token', responseData:fixturePayload });
await new Promise(resolve => setTimeout(resolve,20));
if (fixture.requests.length !== 1 || !fixture.requests[0].includes('/api/reports?dataset=sales&limit=1000')) {
  failures.push(`Reportes no realizó una única lectura inicial canónica: ${fixture.requests.join(', ') || 'ninguna'}`);
}
if (fixture.nodes.get('reportRowsMetric').textContent !== '1') failures.push('Reportes no actualizó la métrica de resultados');
if (fixture.nodes.get('reportDatasetMetric').textContent !== 'Ventas') failures.push('Reportes no actualizó la métrica del dataset');
if (!fixture.nodes.get('reportTable').innerHTML.includes('Cliente &lt;MCA&gt;')) failures.push('Reportes no escapa contenido operativo al renderizar la tabla');
if (!fixture.nodes.get('reportTable').innerHTML.includes('Contabilizado')) failures.push('Reportes no traduce estados técnicos a lenguaje operativo');
if (!fixture.nodes.get('reportTable').innerHTML.includes('report-status good')) failures.push('Reportes no presenta el estado con una señal visual semántica');
if (fixture.nodes.get('reportResultCount').textContent !== '1 resultado') failures.push('Reportes no actualizó el contador visible');
if (fixture.nodes.get('reportLastUpdated').textContent.includes('Preparando')) failures.push('Reportes no actualizó la hora de lectura');
if (fixture.nodes.get('reportTable').attributes.get('aria-busy') !== 'false') failures.push('Reportes no liberó aria-busy al terminar la lectura');


const settle = async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
const reportPayload=(dataset,marker)=>({
  ...fixturePayload,filter_options:undefined,
  report:{key:dataset,label:dataset,basis:'period_activity',dimensions:['period','currency','supplier'],
    columns:[{key:'document_number',label:'Documento'},{key:'balance_due',label:'Saldo'}]},
  datasets:[...fixturePayload.datasets,{key:'supplier_bills',label:'Proveedores',dimensions:['period','currency','supplier'],basis:'period_activity'},
    {key:'cash',label:'Caja',dimensions:['period','currency','supplier'],basis:'period_activity'}],
  rows:[{document_number:marker,currency:'USD',balance_due:1050}],row_count:1
});
function pendingReports(){
  const pending=[];
  const h=executeReports({sessionToken:'fixture-token',fetchResponse:url=>new Promise(resolve=>pending.push({url,resolve}))});
  const reply=async(index,dataset,marker,status=200)=>{
    assert.ok(pending[index],'expected report request '+index);
    pending[index].resolve({status,ok:status===200,json:async()=>status===200?reportPayload(dataset,marker):{error:'Temporary read failure'},headers:{get:()=>''}});
    await settle();
  };
  return {...h,pending,reply};
}
async function recoveryCase(name,run){
  try{await run();console.log('PASS '+name);}
  catch(error){failures.push(name+': '+error.message);}
}

await recoveryCase('REPORT-01 a tab selected during refresh replaces the old response',async()=>{
  const h=pendingReports();await h.reply(0,'sales','INITIAL');
  void h.window.ExecutiveReports.refresh();
  await h.window.ExecutiveReports.open('supplier_bills');
  assert.match(h.nodes.get('datasetTabs').innerHTML,/data-dataset="supplier_bills" aria-selected="true"/);
  await h.reply(1,'sales','OBSOLETE');
  assert.equal(h.requests.length,3);
  assert.match(h.requests[2],/dataset=supplier_bills/);
  assert.doesNotMatch(h.nodes.get('reportTable').innerHTML,/OBSOLETE/);
  assert.equal(h.nodes.get('reportTable').attributes.get('aria-busy'),'true');
  await h.reply(2,'supplier_bills','SB-CURRENT');
  assert.match(h.nodes.get('reportTable').innerHTML,/SB-CURRENT/);
  assert.doesNotMatch(h.nodes.get('reportTable').innerHTML,/OBSOLETE/);
  assert.equal(h.nodes.get('reportTable').attributes.get('aria-busy'),'false');
});
await recoveryCase('REPORT-02 several selections and invalidations collapse to the latest filters',async()=>{
  const h=pendingReports();await h.reply(0,'sales','INITIAL');
  void h.window.ExecutiveReports.refresh();
  await h.window.ExecutiveReports.open('supplier_bills');
  h.nodes.get('supplierId').value='supplier-current';
  await h.window.ExecutiveReports.open('cash');
  void h.window.ExecutiveReports.refresh();void h.window.ExecutiveReports.refresh();
  await h.reply(1,'sales','STALE');
  assert.equal(h.requests.length,3,'only one follow-up read for the pending changes');
  const query=new URL(h.requests[2],'https://fixture.invalid').searchParams;
  assert.equal(query.get('dataset'),'cash');assert.equal(query.get('supplier_id'),'supplier-current');
  await h.reply(2,'cash','CURRENT-CASH');
  assert.match(h.nodes.get('reportTable').innerHTML,/CURRENT-CASH/);
  assert.equal(h.nodes.get('supplierId').value,'supplier-current');
  assert.equal(h.requests.length,3);
});
await recoveryCase('REPORT-03 a discarded read failure cannot overwrite the new selection',async()=>{
  const h=pendingReports();await h.reply(0,'sales','INITIAL');
  void h.window.ExecutiveReports.refresh();await h.window.ExecutiveReports.open('supplier_bills');
  await h.reply(1,'sales','',503);
  assert.equal(h.requests.length,3);
  assert.doesNotMatch(h.nodes.get('reportTable').innerHTML,/No se pudo/);
  await h.reply(2,'supplier_bills','SB-RECOVERED');
  assert.match(h.nodes.get('reportTable').innerHTML,/SB-RECOVERED/);
  assert.equal(h.nodes.get('reportMessage').textContent,'');
});
await recoveryCase('REPORT-04 an invalidation arriving during the same dataset read is not lost',async()=>{
  const h=pendingReports();await h.reply(0,'sales','INITIAL');
  void h.window.ExecutiveReports.refresh();void h.window.ExecutiveReports.refresh();
  await h.reply(1,'sales','OLD-TOTAL');
  assert.equal(h.requests.length,3);assert.doesNotMatch(h.nodes.get('reportTable').innerHTML,/OLD-TOTAL/);
  await h.reply(2,'sales','NEW-TOTAL');
  assert.match(h.nodes.get('reportTable').innerHTML,/NEW-TOTAL/);
  assert.equal(h.nodes.get('refreshReport').disabled,false);
});
await recoveryCase('REPORT-05 clearing a queued session never starts another authenticated read',async()=>{
  const h=pendingReports();await h.reply(0,'sales','INITIAL');
  void h.window.ExecutiveReports.refresh();await h.window.ExecutiveReports.open('supplier_bills');
  h.setSession('');await h.reply(1,'sales','OLD-SESSION');
  assert.equal(h.requests.length,2);assert.equal(h.nodes.get('refreshReport').disabled,false);
  assert.doesNotMatch(h.nodes.get('reportTable').innerHTML,/OLD-SESSION/);
});


await recoveryCase('REPORT-06 a selection queued during CSV export loads afterward and preserves the filename',async()=>{
  const h=pendingReports();await h.reply(0,'sales','INITIAL');
  const exporting=h.nodes.get('exportReport').listeners.get('click')();
  assert.match(h.requests[1],/dataset=sales/);assert.match(h.requests[1],/format=csv/);
  await h.window.ExecutiveReports.open('supplier_bills');
  assert.doesNotMatch(h.nodes.get('reportTable').innerHTML,/INITIAL/,'the previous table must not appear under the newly selected dataset');
  assert.match(h.nodes.get('reportTable').innerHTML,/Consultando reporte/);
  h.pending[1].resolve({status:200,ok:true,headers:{get:()=>''},blob:async()=>new Blob(['csv'],{type:'text/csv'})});
  await settle();
  assert.equal(h.requests.length,3);assert.match(h.requests[2],/dataset=supplier_bills/);
  assert.equal(h.downloads[0].download,'export-mca-sales.csv');
  await h.reply(2,'supplier_bills','SB-AFTER-EXPORT');await exporting;
  assert.match(h.nodes.get('reportTable').innerHTML,/SB-AFTER-EXPORT/);
  assert.equal(h.nodes.get('exportReport').disabled,false);
});

if (failures.length) {
  console.error(`UX-7 Reports visual owner gate failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Reports visual owner gate passed.');
console.log('- reports.html, reports.css and reports.js form one responsive visual owner.');
console.log('- The runtime waits for the embedded session, performs read-only report queries and escapes rendered data.');
console.log('- Dataset metrics, filters, operational labels, empty/error states and internal table scrolling are protected.');
