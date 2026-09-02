import fs from 'node:fs';

const files={
  shell:'admin/navigation-shell.js',
  html:'admin/warehouse.html',
  owner:'admin/warehouse.js',
  styles:'admin/warehouse.css',
  api:'api/warehouse.js',
  workflow:'.github/workflows/ux6-warehouse-embedded-ownership.yml'
};
const retiredOwner='admin/warehouse-embedded.js';
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);
if(fs.existsSync(retiredOwner))failures.push(`el owner compensatorio retirado todavía existe: ${retiredOwner}`);

const shell=read(files.shell);
const html=read(files.html);
const owner=read(files.owner);
const styles=read(files.styles);
const api=read(files.api);
const workflow=read(files.workflow);

requireText(shell,"src:'/admin/warehouse.html?embedded=1'",'navegación canónica a Almacén');
for(const token of [
  'applyWarehouseCatalogBoundary',
  'contentDocument',
  '__warehouseCatalogObserver',
  '[navigation-shell] warehouse catalog boundary'
])if(shell.includes(token))failures.push(`navigation-shell conserva el parche cross-frame ${token}`);
if(/warehouseSection[\s\S]{0,300}addEventListener\(['"]load['"]/.test(shell))failures.push('navigation-shell no puede mutar Almacén después de cargar el iframe');

for(const text of [
  '<link rel="stylesheet" href="/admin/warehouse.css?v=20260902-ux6owner1">',
  '<link rel="stylesheet" href="/admin/embedded-foundation.css?v=20260902-ux6b3">',
  '<body class="erp-module-page erp-module-warehouse">',
  '<script src="/admin/warehouse.js?v=20260902-ux6owner1"></script>',
  'warehouse-copy-standalone',
  'warehouse-copy-embedded'
])requireText(html,text,`HTML de Almacén ${text}`);
forbid(html,/<style(?:\s|>)/i,'warehouse.html conserva una hoja de estilos embebida');
forbid(html,/\sstyle\s*=/i,'warehouse.html conserva estilos inline');
forbid(html,/warehouse-embedded\.js/,'warehouse.html vuelve a cargar el owner compensatorio retirado');
const ownerCssIndex=html.indexOf('/admin/warehouse.css?v=20260902-ux6owner1');
const foundationIndex=html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
if(ownerCssIndex<0||foundationIndex<0||ownerCssIndex>foundationIndex)failures.push('warehouse.css debe cargar antes de la base visual embebida');

for(const text of [
  "const embeddedMode=new URLSearchParams(location.search).get('embedded')==='1'",
  'function applyEmbeddedMode()',
  "document.body.classList.add('warehouse-embedded')",
  "productTab.setAttribute('aria-hidden','true')",
  "owner:'warehouse.js'",
  'window.WarehouseModule=Object.freeze',
  'const safeWarehouseErrors=new Set([',
  'const safeWarehousePatterns=[',
  'function safeWarehouseMessage(',
  'WAREHOUSE_UI_FAILED',
  'error.status=r.status',
  "error.endpoint=String(path).split('?')[0]",
  "'toggle_warehouse'",
  "'toggle_product'",
  "'cancel_receipt'",
  "'create_warehouse'",
  "'create_product'",
  "'create_quick_product'",
  "'create_receipt'",
  "'load'"
])requireText(owner,text,`owner consolidado de Almacén ${text}`);

if((owner.match(/error\?\.message/g)||[]).length!==1)failures.push('error?.message solo puede leerse dentro del traductor seguro de Almacén');
forbid(owner,/\berror\.message\b/,'Almacén vuelve a renderizar error.message directamente');
forbid(owner,/\be\.message\b/,'Almacén vuelve a renderizar e.message directamente');
forbid(owner,/\sstyle\s*=/i,'warehouse.js conserva estilos inline');
forbid(owner,/\.style(?:\.|\[)/,'warehouse.js vuelve a mutar estilos directamente');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'warehouse.js vuelve a inyectar CSS');
forbid(owner,/\bMutationObserver\b/,'warehouse.js vuelve a observar y recomponer el DOM');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'warehouse.js vuelve a usar diálogos nativos');

for(const text of [
  "const actionAllowed=(receipt,action)=>receipt?.capabilities?.actions?.[action]?.allowed===true",
  "actionAllowed(r,'cancel')",
  "if(!receipt||!actionAllowed(receipt,'cancel'))",
  "word:'ANULAR'",
  "action:'cancel_receipt'"
])requireText(owner,text,`acción canónica de recepción ${text}`);

for(const selector of [
  '.warehouse-notice',
  '.warehouse-heading-reset',
  '.warehouse-search',
  '.warehouse-section-gap',
  '.warehouse-decision-message',
  '.warehouse-decision-label',
  '.warehouse-receipt-items',
  '.warehouse-load-error',
  '.warehouse-copy-embedded',
  'body.warehouse-embedded .tab[data-tab="products"]',
  'body.warehouse-embedded .product-picker button'
])requireText(styles,selector,`CSS propietario ${selector}`);
forbid(styles,/\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/,'warehouse.css mezcla comportamiento de JavaScript');

for(const text of [
  "authorizeAdmin(req, res, 'warehouse.read')",
  "action === 'create_product' ? 'procurement.write' : 'warehouse.write'",
  "loadWarehouseReceiptActionCapabilityMap(admin)",
  "rpc/cancel_warehouse_receipt_canonical",
  'const translated = translatedError(raw)',
  'if (translated) return fail(res, 400, translated)',
  "return fail(res, 500, 'No se pudo procesar la operación de almacén')"
])requireText(api,text,`boundary seguro de Almacén ${text}`);
forbid(api,/return messages\.find\([^\n]+\|\| raw/,'API de Almacén vuelve a devolver fallos internos crudos');

for(const text of [
  'node scripts/check-ux6-warehouse-embedded-ownership.mjs',
  'node scripts/check-ux5-warehouse-receipt-actions.mjs',
  'node scripts/check-ux6b-embedded-foundation.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,text,`workflow ${text}`);

if(failures.length){
  console.error('UX-6 Warehouse ownership check failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-6 Warehouse ownership check passed.');
console.log('- warehouse.js posee standalone y embedded sin shim, observers ni CSS generado.');
console.log('- La presentación vive en warehouse.css y los fallos técnicos quedan fuera de la interfaz.');
console.log('- Capabilities, permisos, inventario y RPC canónica de anulación permanecen intactos.');
