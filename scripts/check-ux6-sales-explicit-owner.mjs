import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const html=read('admin/sales.html');
const css=read('admin/sales.css');
const orderCss=read('admin/sales-order-ux.css');
const workspaceCss=read('admin/sales-workspace.css');
const supplyCss=read('admin/sales-supply-workspace.css');
const financeCss=read('admin/sales-customer-finance.css');
const foundation=read('admin/embedded-foundation.css');
const base=read('admin/sales.js');
const orderUx=read('admin/sales-order-ux.js');
const link=read('admin/sales-existing-load-link-v2.js');
const workspace=read('admin/sales-workspace.js');
const salesApi=read('api/sales.js');
const orderApi=read('api/sales-order-ux.js');
const loadsApi=read('api/sales-loads.js');
const cleanup=read('scripts/check-ux6-presentation-cleanup.mjs');
const workflow=read('.github/workflows/ux6-sales-explicit-owner.yml');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

requireText(html,'/admin/embedded-foundation.css?v=20260902-ux6b3','base visual compartida');
requireText(html,'/admin/sales.css?v=20260902-ux7sales1','CSS dedicado y versionado');
requireText(html,'/admin/sales-order-ux.css?v=20260902-ux7sales1','CSS del editor versionado');
requireText(html,'/admin/sales-workspace.css?v=20260902-ux7sales1','CSS del workspace versionado');
requireText(html,'/admin/sales-supply-workspace.css?v=20260902-ux7sales1','CSS de abastecimiento versionado');
requireText(html,'/admin/sales-customer-finance.css?v=20260902-ux7sales1','CSS financiero versionado');
for(const asset of [
  '/admin/sales.js?v=20260904-directflow1',
  '/admin/sales-order-ux.js?v=20260902-ux7sales1',
  '/admin/sales-workspace.js?v=20260902-ux7sales1',
  '/admin/sales-existing-load-link-v2.js?v=20260902-ux6owner1'
])requireText(html,asset,`asset revisado ${asset}`);
requireText(html,'<body class="erp-module-page erp-module-sales" data-owner="sales.js">','owner canónico de Ventas');
requireText(html,'id="salesAccessNote"','estado de solo lectura');
requireText(html,'id="salesListTitle"','jerarquía del listado');
requireText(html,'aria-pressed="true"','estado accesible de filtros');
requireText(html,'role="status" aria-live="polite"','feedback accesible');
forbid(html,/\sstyle=/i,'sales.html conserva estilos inline');
forbid(html,/<style(?:\s|>)/i,'sales.html conserva CSS incrustado');
forbid(html,/purchases\.css/i,'Ventas vuelve a depender de la presentación de Compras');

const foundationIndex=html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerCssIndex=html.indexOf('/admin/sales.css?v=20260902-ux7sales1');
if(foundationIndex<0||ownerCssIndex<0||foundationIndex>ownerCssIndex)failures.push('la base visual debe cargar antes de sales.css');

for(const token of ['.sales-page-head','.sales-metrics','.sales-list-heading','.sales-order-row','.sales-order-cell-label','.sales-access-note','.sales-order-dialog','.sales-modal-actions','.existing-load-card','.existing-load-decision','.sales-ws-count','@media(max-width:720px)'])requireText(css,token,`CSS ${token}`);
for(const token of ['.client-picker-button','.sales-stock','.sales-price-grid','.sales-total-preview','@media(max-width:600px)'])requireText(orderCss,token,`CSS del editor ${token}`);
for(const token of ['.sales-workspace-dialog','.sales-workspace-kpis','.sales-workspace-tabs','.sales-workspace-content','.sales-ws-decision-panel','@media(max-width:700px)'])requireText(workspaceCss,token,`CSS del workspace ${token}`);

for(const [source,label] of [[css,'sales.css'],[orderCss,'sales-order-ux.css'],[workspaceCss,'sales-workspace.css'],[supplyCss,'sales-supply-workspace.css'],[financeCss,'sales-customer-finance.css']]){
  forbid(source,/!important/i,`${label} usa sobrescrituras !important`);
  forbid(source,/@import/i,`${label} depende de una importación tardía`);
  forbid(source,/(?:linear|radial)-gradient/i,`${label} conserva decoraciones por gradiente`);
  forbid(source,/font-family\s*:\s*Arial/i,`${label} vuelve a usar Arial`);
  const opening=(source.match(/{/g)||[]).length,closing=(source.match(/}/g)||[]).length;
  if(opening!==closing)failures.push(`${label} está desbalanceado: ${opening}/${closing}`);
}
forbid(foundation,/erp-module-sales/,'la base compartida invade la presentación propietaria de Ventas');

for(const token of [
  'SAFE_SALES_ERROR_PATTERNS',
  'function safeSalesMessage(error,fallback=',
  "window.SalesOrderUX?.mountLine?.(div)",
  "window.SalesOrderUX?.onOrderOpen?.(order||null)",
  "$('salesAccessNote').hidden=writeAccess",
  'sales-metric-dispatched',
  'sales-order-cell-label',
  "x.setAttribute('aria-pressed',String(active))",
  "can(o,'edit')",
  "can(o,'allocate_load')"
])requireText(base,token,`owner base ${token}`);
forbid(base,/async function saveOrder\s*\(/,'sales.js conserva el guardado duplicado');
forbid(base,/function collectLines\s*\(/,'sales.js conserva el colector duplicado');
forbid(base,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?(?:error|e)(?:\?\.)?\.message/,'sales.js muestra error.message crudo');

for(const token of [
  'SAFE_ORDER_ERROR_PATTERNS',
  'const safeOrderMessage = (error,fallback=',
  "edit?.capabilities?.actions?.edit?.allowed !== true",
  'function onOrderOpen()',
  'mountLine:decorateLine',
  'onOrderOpen,',
  'select.hidden = true',
  "button.setAttribute('aria-haspopup','dialog')",
  "owner:'sales-order-ux.js'"
])requireText(orderUx,token,`owner avanzado ${token}`);
forbid(orderUx,/\bMutationObserver\b/,'sales-order-ux.js conserva MutationObserver');
forbid(orderUx,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?error(?:\?\.)?\.message/,'sales-order-ux.js muestra error.message crudo');

for(const token of [
  "order?.capabilities?.actions?.allocate_load?.allowed === true",
  'existingLoadOrderSummary',
  'SAFE_LINK_ERROR_PATTERNS',
  'function decision(',
  'statusLabel(row.load_status)',
  "owner:'sales-existing-load-link-v2.js'"
])requireText(link,token,`vinculación ${token}`);
forbid(link,/function\s+ensureStyles|createElement\(['"]style|style\.textContent/,'vinculación inyecta estilos en runtime');
forbid(link,/function\s+hasPending|order\?\.status\s*===|unallocated_(?:quantity|pallets)/,'vinculación infiere acciones desde estado o saldos');
forbid(link,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?error(?:\?\.)?\.message/,'vinculación muestra error.message crudo');
for(const token of ['role="tablist"','role="tab"','aria-selected="${state.tab===key}"','role="tabpanel"','role="alertdialog"',"event.key==='Escape'"])requireText(workspace,token,`workspace accesible ${token}`);
forbid(workspace,/\sstyle=/i,'sales-workspace.js conserva estilos inline');

for(const source of [base,orderUx,link])forbid(source,/\b(?:prompt|alert|confirm)\s*\(/,'Ventas usa diálogo nativo');
for(const source of [html,base,orderUx,link,workspace])forbid(source,/\bexpediente(?:s)?\b/i,'Ventas reintroduce Expedientes');

for(const [source,label,stable] of [
  [salesApi,'api/sales.js',"return fail(res,500,'No se pudo procesar Ventas')"],
  [orderApi,'api/sales-order-ux.js',"return fail(res,500,'No se pudo procesar Ventas')"],
  [loadsApi,'api/sales-loads.js',"return fail(res,500,'No se pudo procesar el Cargue')"]
]){
  requireText(source,'const translated = translatedError(raw)',`${label} clasifica errores esperados`);
  requireText(source,stable,`${label} usa 500 estable`);
  forbid(source,/return fail\(res,\s*(?:400|500),\s*(?:raw|translatedError\(raw\))\)/,`${label} devuelve error interno crudo`);
}
for(const token of [
  "loadSalesActionCapabilityMap",
  "capabilities:capabilityMap.get",
  "requireCapability(capabilities, 'allocate_load')",
  "rpc/link_existing_load_to_sales_order",
  "rpc/create_load_from_sales_order",
  "rpc/create_sales_order_plan",
  "rpc/replace_sales_order_plan"
])requireText(`${salesApi}\n${orderApi}\n${loadsApi}`,token,`contrato canónico ${token}`);

for(const token of ['style\\.textContent','unallocated_','allocate_load canónico','error.message crudo'])requireText(cleanup,token,`gate común ${token}`);
for(const token of [
  'node scripts/check-ux6-sales-explicit-owner.mjs',
  'node scripts/check-ux5-sales-actions.mjs',
  'node scripts/check-ux6-sales-workspace-presentation.mjs',
  'node scripts/check-ux6-presentation-cleanup.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,token,`workflow ${token}`);

if(failures.length){
  console.error('UX6 Sales explicit owner check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Sales explicit owner check passed.');
