import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const api=read('api/purchases.js');
const ui=read('admin/purchases.js');
const refresh=read('admin/purchases-master-refresh.js');
const catalog=read('admin/purchases-product-catalog.js');
const css=read('admin/purchases.css');
const html=read('admin/purchases.html');
const canonicalGate=read('scripts/check-ux5-canonical-actions.mjs');
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
  'PURCHASES_INITIAL_LOAD_FAILED'
]) requireText(ui,text,`owner de Compras ${text}`);

forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Compras no puede usar diálogos nativos');
forbid(ui,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?(?:e|error)(?:\?\.)?\.message/,'Compras no puede mostrar error.message crudo');
forbid(ui,/\.includes\(['"]requiere confirmación explícita['"]\)/,'Sobre-recepción no puede depender de una frase traducida');
forbid(ui,/\bexpediente(?:s)?\b/i,'Compras no puede reintroducir Expedientes');
forbid(ui,/if\s*\(o\.status===['"](?:issued|confirmed)['"]\)\s*acts\.push/,'Compras no puede inferir CTAs desde status');

for(const [source,text,label] of [
  [refresh,'PURCHASES_MASTER_REFRESH_FAILED','diagnóstico de refresh de maestros'],
  [refresh,"safePurchaseMessage(error, 'No se pudieron actualizar los proveedores. Intenta nuevamente.')",'feedback seguro de maestros'],
  [catalog,'PURCHASE_PRODUCT_CREATE_FAILED','diagnóstico de producto'],
  [catalog,"safePurchaseMessage(error, 'No se pudo crear el producto. Intenta nuevamente.')",'feedback seguro de producto']
]) requireText(source,text,label);
forbid(refresh,/(?:innerHTML|textContent)\s*=.*error(?:\?\.)?\.message/,'Refresh de maestros no puede mostrar error.message crudo');
forbid(catalog,/(?:innerHTML|textContent)\s*=.*error(?:\?\.)?\.message/,'Catálogo rápido no puede mostrar error.message crudo');
forbid(catalog,/button\.style\.marginTop/,'Catálogo rápido no puede conservar estilo inline del botón');

for(const text of [
  '.purchase-decision-modal',
  '.purchase-decision-dialog',
  '.purchase-decision-actions',
  '.product-create-inline',
  ':focus-visible',
  '@media(max-width:650px)'
]) requireText(css,text,`CSS ${text}`);

for(const text of [
  'id="purchaseDecisionModal"',
  'role="dialog"',
  'aria-modal="true"',
  'id="purchaseDecisionCancel"',
  'id="purchaseDecisionAccept"',
  '/admin/purchases.css?v=20260901-ux6owner1',
  '/admin/purchases.js?v=20260901-ux6owner1',
  '/admin/purchases-master-refresh.js?v=20260901-ux6owner1',
  '/admin/purchases-product-catalog.js?v=20260901-ux6owner1'
]) requireText(html,text,`HTML ${text}`);

for(const text of [
  'DB canonical action owner',
  'UI capability consumer',
  "can(o,'receive_remaining')",
  "can(o,'receive_excess')"
]) requireText(canonicalGate,text,`gate UX-5 preservado ${text}`);

if(failures.length){
  console.error('UX6 Purchases presentation gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Purchases presentation gate passed.');
