import fs from 'node:fs';

const files = {
  html: 'admin/warehouse.html',
  styles: 'admin/warehouse.css',
  owner: 'admin/warehouse.js',
  foundation: 'admin/embedded-foundation.css',
  api: 'api/warehouse.js',
  canonical: 'scripts/check-ux5-warehouse-receipt-actions.mjs',
  ownership: 'scripts/check-ux6-warehouse-embedded-ownership.mjs',
  workflow: '.github/workflows/ux6-warehouse-embedded-ownership.yml'
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
const canonical = read(files.canonical);
const ownership = read(files.ownership);
const workflow = read(files.workflow);

for (const text of [
  '<body class="erp-module-page erp-module-warehouse" data-owner="warehouse.js">',
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/warehouse.css?v=20260902-ux7warehouse1',
  '/admin/warehouse.js?v=20260902-ux7warehouse1',
  '/admin/embedded-auto-refresh.js?v=20260902-ux7warehouse1',
  'class="module-hero warehouse-page-head"',
  'id="stats" class="stats warehouse-metrics"',
  'class="tabs warehouse-tabs" role="tablist"',
  'role="tabpanel"',
  'id="warehouseReadOnlyNote"',
  'class="panel warehouse-list-panel"',
  'class="warehouse-admin-grid"',
  'id="receiptModal" class="modal hidden" role="dialog"',
  'id="detailModal" class="modal hidden" role="dialog"',
  'id="quickProductModal" class="modal hidden" role="dialog"',
  'aria-modal="true"',
  'aria-live="polite"'
]) requireText(html, text, `HTML canónico ${text}`);

const foundationIndex = html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerCssIndex = html.indexOf('/admin/warehouse.css?v=20260902-ux7warehouse1');
if (foundationIndex < 0 || ownerCssIndex < 0 || foundationIndex > ownerCssIndex) {
  failures.push('la base visual compartida debe cargar antes de warehouse.css');
}

forbid(html, /<style(?:\s|>)/i, 'warehouse.html conserva CSS incrustado');
forbid(html, /<script(?![^>]*\bsrc=)[^>]*>/i, 'warehouse.html conserva JavaScript incrustado');
forbid(html, /\sstyle\s*=/i, 'warehouse.html conserva estilos inline');
forbid(html, /\son(?:click|change|submit|load|error)\s*=/i, 'warehouse.html conserva handlers inline');

for (const selector of [
  '.warehouse-page-head',
  '.warehouse-metrics',
  '.warehouse-view-switcher',
  '.warehouse-list-panel',
  '.warehouse-list-toolbar',
  '.warehouse-receipt-list',
  '.warehouse-empty',
  '.warehouse-admin-grid',
  '.warehouse-form-panel',
  '.warehouse-directory-panel',
  '.warehouse-receipt-dialog',
  '.warehouse-modal-actions',
  '.warehouse-read-only-note',
  '@media(max-width:1100px)',
  '@media(max-width:820px)',
  '@media(max-width:650px)',
  '@media(max-width:430px)'
]) requireText(styles, selector, `CSS propietario ${selector}`);

forbid(styles, /@import|!important|font-family\s*:\s*Arial|linear-gradient/i, 'warehouse.css conserva estilos legacy, una importación tardía o una sobrescritura');
forbid(styles, /\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/, 'warehouse.css mezcla comportamiento de JavaScript');
forbid(foundation, /erp-module-warehouse\s+\.warehouse-page-head/, 'la base compartida invade el owner visual de Almacén');

for (const text of [
  "owner:'warehouse.js'",
  'const actionAllowed=(receipt,action)=>receipt?.capabilities?.actions?.[action]?.allowed===true',
  'warehouseWriteAccess=d.write_access===true',
  'function renderStats()',
  'function renderWarehouses()',
  'function renderProducts()',
  'function renderReceipts()',
  'function openWarehouseModal(',
  'function closeWarehouseModal(',
  "setAttribute('aria-selected',String(active))",
  "setAttribute('aria-pressed',String(active))",
  "data-view-receipt=",
  "data-cancel-receipt=",
  "data-toggle-warehouse=",
  "data-toggle-product=",
  "data-remove-line=",
  "data-new-product=",
  "if(event.key!=='Escape')return",
  "modal.setAttribute('aria-hidden','false')",
  "modal.setAttribute('aria-hidden','true')",
  "word:'ANULAR'",
  "action:'cancel_receipt'",
  'WAREHOUSE_UI_FAILED'
]) requireText(owner, text, `owner de Almacén ${text}`);

if ((owner.match(/error\?\.message/g) || []).length !== 1) {
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Almacén');
}
forbid(owner, /\berror\.message\b/, 'Almacén vuelve a renderizar error.message directamente');
forbid(owner, /\be\.message\b/, 'Almacén vuelve a renderizar e.message directamente');
forbid(owner, /<[^>]+\sonclick\s*=/i, 'Almacén vuelve a generar handlers inline');
forbid(owner, /\sstyle\s*=/i, 'warehouse.js conserva estilos inline');
forbid(owner, /\.style(?:\.|\[)/, 'warehouse.js vuelve a mutar estilos directamente');
forbid(owner, /document\.createElement\(['"]style['"]\)|style\.textContent/, 'warehouse.js vuelve a inyectar CSS');
forbid(owner, /\bMutationObserver\b/, 'warehouse.js vuelve a observar y recomponer el DOM');
forbid(owner, /\b(?:prompt|alert|confirm)\s*\(/, 'warehouse.js vuelve a usar diálogos nativos');
forbid(owner, /if\s*\(r\.status===['"]received['"]\)\s*.*cancel/i, 'Almacén no puede inferir la acción Anular desde status');

for (const text of [
  "authorizeAdmin(req, res, 'warehouse.read')",
  "action === 'create_product' ? 'procurement.write' : 'warehouse.write'",
  'loadWarehouseReceiptActionCapabilityMap(admin)',
  'capabilities:receiptAccess.map.get(String(receipt.id))',
  'rpc/cancel_warehouse_receipt_canonical'
]) requireText(api, text, `boundary canónico de Almacén ${text}`);

for (const text of [
  'WR DB action owner',
  'Warehouse UI',
  "actionAllowed(r,'cancel')"
]) requireText(canonical, text, `gate UX-5 preservado ${text}`);

for (const text of [
  'owner consolidado de Almacén',
  'acción canónica de recepción',
  'warehouse.js posee standalone y embedded'
]) requireText(ownership, text, `gate de ownership preservado ${text}`);

for (const text of [
  'name: UX7 Warehouse Visual Owner',
  'node scripts/check-ux7-warehouse-visual-owner.mjs',
  'node scripts/check-ux6-warehouse-embedded-ownership.mjs',
  'node scripts/check-ux5-warehouse-receipt-actions.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs'
]) requireText(workflow, text, `workflow ${text}`);

const openingBraces = (styles.match(/{/g) || []).length;
const closingBraces = (styles.match(/}/g) || []).length;
if (openingBraces !== closingBraces) failures.push(`warehouse.css está desbalanceado: ${openingBraces}/${closingBraces}`);

if (failures.length) {
  console.error('UX-7 Warehouse visual owner gate failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 Warehouse visual owner gate passed.');
console.log('- Almacén usa los owners canónicos warehouse.html, warehouse.css y warehouse.js.');
console.log('- Recepciones, ubicaciones y catálogo conservan permisos, capabilities y acciones de base de datos.');
console.log('- La interfaz es responsive, accesible y no depende de estilos o diálogos legacy.');
