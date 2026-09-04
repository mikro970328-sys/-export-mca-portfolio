import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const api=read('api/purchases.js');
const ui=read('admin/purchases.js');
const css=read('admin/purchases.css');
const html=read('admin/purchases.html');
const canonicalGate=read('scripts/check-ux5-canonical-actions.mjs');
const workflow=read('.github/workflows/ux6-purchases-presentation.yml');
const detachedConsumers=['admin/invoices.html','admin/invoices.css','admin/payables.css','admin/costs.css'];
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

for(const text of [
  'PURCHASE_ERROR_TRANSLATIONS',
  'SAFE_PURCHASE_INPUT_PATTERNS',
  "translated[0]==='PO_OVER_RECEIPT_REQUIRES_CONFIRMATION'?409:400",
  "code:'PURCHASE_INPUT_INVALID'",
  "code:'PURCHASE_UNEXPECTED_ERROR'",
  "message:'No se pudo procesar Compras. Intenta nuevamente.'",
  'fail(res,failure.status,failure.message,{code:failure.code})',
  "supabase('purchase_order_action_capabilities'",
  'loadAdminAccessContext'
]) requireText(api,text,`backend seguro ${text}`);
forbid(api,/\?\.[1]\]\|\|raw|\|\|\s*raw\s*;/,'Purchases API no puede devolver errores internos crudos');
forbid(api,/fail\(res,400,translatedError\(raw\)\)/,'Purchases API no puede clasificar todo error inesperado como 400');

for(const text of [
  'SAFE_PURCHASE_ERROR_PATTERNS',
  'function safePurchaseMessage(error,fallback',
  'function purchaseDecision({title,copy,accept=',
  'function closePurchaseDecision(value=false)',
  "error.code=d.details?.code||null",
  "error.code==='PO_OVER_RECEIPT_REQUIRES_CONFIRMATION'",
  "can(o,'edit')",
  "can(o,'issue')",
  "can(o,'confirm')",
  "can(o,'receive_remaining')",
  "can(o,'receive_excess')",
  "can(o,'close')",
  "can(o,'cancel')",
  'PURCHASE_ORDER_SAVE_FAILED',
  'PURCHASE_ORDER_TRANSITION_FAILED',
  'PURCHASE_RECEIPT_SAVE_FAILED',
  'PURCHASES_REFRESH_FAILED',
  'PURCHASES_INITIAL_LOAD_FAILED',
  'PURCHASES_MASTER_REFRESH_FAILED',
  'PURCHASE_PRODUCT_CREATE_FAILED',
  'function openNewOrder()',
  'function openQuickProduct(line)',
  'async function saveQuickProduct()',
  'function setLinePricingMode(div,mode,convert=false)',
  'function updateLineSummary(div)',
  'function lineTotal(item)',
  'entered_line_total',
  'line_total:',
  'Costo unitario',
  'Valor total',
  "document.querySelectorAll('#orderLines [data-line]')",
  'purchase-order-row',
  'purchases-list-count',
  "tab.setAttribute('aria-pressed',String(active))"
]) requireText(ui,text,`owner de Compras ${text}`);
requireText(ui,"if(action==='edit'){const order=detailOrder;closeModal('detail');openOrder(order);return;}",'edición conserva la PO seleccionada al cambiar de diálogo');

forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Compras no puede usar diálogos nativos');
forbid(ui,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?(?:e|error)(?:\?\.)?\.message/,'Compras no puede mostrar error.message crudo');
forbid(ui,/\.includes\(['"]requiere confirmación explícita['"]\)/,'Sobre-recepción no puede depender de una frase traducida');
forbid(ui,/\bexpediente(?:s)?\b/i,'Compras no puede reintroducir Expedientes');
forbid(ui,/if\s*\(o\.status===['"](?:issued|confirmed)['"]\)\s*acts\.push/,'Compras no puede inferir CTAs desde status');
forbid(ui,/\bMutationObserver\b|window\.fetch\s*=|document\.createElement\(['"]style['"]\)/,'Compras no puede incorporar un parche de runtime');
forbid(ui,/\baddLine\s*=\s*function\b/,'Compras no puede reemplazar su propio lifecycle después de cargar');
if(fs.existsSync('admin/purchases-master-refresh.js'))failures.push('purchases-master-refresh.js debe permanecer retirado');
if(fs.existsSync('admin/purchases-product-catalog.js'))failures.push('purchases-product-catalog.js debe permanecer retirado');

for(const text of [
  '.erp-module-page.erp-module-purchases',
  '.purchases-page-head',
  '.purchases-metrics',
  '.purchases-list-toolbar',
  '.purchases-order-list > .purchase-order-row',
  '.purchase-order-cell-label',
  '.purchase-modal-actions',
  '.purchase-decision-modal',
  '.purchase-decision-dialog',
  '.purchase-decision-actions',
  '.product-create-inline',
  '.purchase-line-details',
  '.purchase-line-feedback',
  '.lMeasurementHelp.is-error',
  '@media(max-width:650px)',
  '@media(max-width:430px)'
]) requireText(css,text,`CSS ${text}`);
forbid(css,/@import|!important|font-family\s*:\s*Arial|linear-gradient/i,'CSS de Compras conserva una dependencia o sobrescritura visual legacy');

for(const text of [
  'data-owner="purchases.js"',
  'class="head module-hero purchases-page-head"',
  'class="metrics purchases-metrics"',
  'class="toolbar purchases-list-toolbar"',
  'class="orders has-explicit-count purchases-order-list"',
  'id="purchaseDecisionModal"',
  'role="dialog"',
  'aria-modal="true"',
  'id="purchaseDecisionCancel"',
  'id="purchaseDecisionAccept"',
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/purchases.css?v=20260904-directflow1',
  '/admin/purchases.js?v=20260904-cancelflow1',
  '/admin/embedded-auto-refresh.js?v=20260904-live2'
]) requireText(html,text,`HTML ${text}`);
forbid(html,/\sstyle\s*=/i,'Compras conserva estilos inline');
forbid(html,/purchases-(?:master-refresh|product-catalog)\.js/,'Compras vuelve a cargar un script complementario retirado');
const foundationIndex=html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerCssIndex=html.indexOf('/admin/purchases.css?v=20260904-directflow1');
if(foundationIndex<0||ownerCssIndex<0||foundationIndex>ownerCssIndex)failures.push('la base visual debe cargar antes del CSS propietario de Compras');

for(const file of detachedConsumers){
  const source=read(file);
  forbid(source,/purchases\.css/i,`${file} vuelve a depender del CSS de Compras`);
}

for(const text of [
  'name: UX7 Purchases Visual Owner',
  'node scripts/check-ux6-purchases-presentation.mjs',
  'node scripts/check-ux5-canonical-actions.mjs',
  'node scripts/check-frontend-ownership.mjs'
])requireText(workflow,text,`workflow ${text}`);
forbid(workflow,/purchases-(?:master-refresh|product-catalog)\.js/,'el workflow conserva scripts complementarios retirados');

for(const text of [
  'DB canonical action owner',
  'UI capability consumer',
  "can(o,'receive_remaining')",
  "can(o,'receive_excess')"
]) requireText(canonicalGate,text,`gate UX-5 preservado ${text}`);

if(failures.length){
  console.error('UX7 Purchases visual owner gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX7 Purchases visual owner gate passed.');
