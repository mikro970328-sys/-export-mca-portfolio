import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const files = {
  core:'admin/form-drafts.js',
  styles:'admin/form-drafts.css',
  index:'admin/index.html',
  clients:'admin/clients-module.js',
  containers:'admin/containers-module.js',
  productsHtml:'admin/products.html',
  products:'admin/products.js',
  suppliersHtml:'admin/suppliers.html',
  suppliers:'admin/suppliers.js',
  publicationsHtml:'admin/publications.html',
  publications:'admin/publications.js',
  purchasesHtml:'admin/purchases.html',
  purchases:'admin/purchases.js',
  salesHtml:'admin/sales.html',
  sales:'admin/sales.js',
  salesUx:'admin/sales-order-ux.js',
  invoicesHtml:'admin/invoices.html',
  invoices:'admin/invoices.js',
  payablesHtml:'admin/payables.html',
  payables:'admin/payables.js'
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

const source = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, read(file)]));

for (const text of [
  "const STORAGE_PREFIX = 'export_mca_form_draft_v1'",
  'const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000',
  'const DEFAULT_DEBOUNCE_MS = 700',
  'const MAX_RECORD_BYTES = 180000',
  "localStorage.getItem('export_mca_user')",
  "['button', 'submit', 'reset', 'file', 'password', 'hidden']",
  'control.dataset.draftIgnore',
  'window.addEventListener(\'pagehide\'',
  "window.addEventListener('export-mca:session-ending'",
  'clearScope',
  'aria-atomic="true"',
  'Descartar borrador',
  "owner:'form-drafts.js'"
]) requireText(source.core, text, `contrato central ${text}`);

forbid(source.core, /MutationObserver/, 'el autoguardado no debe observar todo el DOM');
forbid(source.core, /sessionStorage/, 'el borrador debe sobrevivir a una pestaña cerrada mediante localStorage');
forbid(source.core, /\bfetch\s*\(/, 'el autoguardado local no debe enviar borradores a una API');

for (const text of [
  '.form-draft-status{',
  '[data-form-draft-status="restored"]',
  '.form-draft-discard{',
  '@media (max-width:640px)'
]) requireText(source.styles, text, `presentación de borradores ${text}`);

function requireAssetOrder(html, moduleAsset, label) {
  const draftIndex = html.indexOf('/admin/form-drafts.js?v=20260909-drafts1');
  const moduleIndex = html.indexOf(moduleAsset);
  if (draftIndex < 0 || moduleIndex < 0 || draftIndex > moduleIndex) {
    failures.push(`orden de carga incorrecto en ${label}`);
  }
  requireText(html, '/admin/form-drafts.css?v=20260909-drafts1', `CSS de borradores en ${label}`);
}

requireAssetOrder(source.index, '/admin/erp.js?v=20260905-accessflow1', 'admin/index.html');
requireAssetOrder(source.productsHtml, '/admin/products.js?', 'productos');
requireAssetOrder(source.suppliersHtml, '/admin/suppliers.js?', 'proveedores');
requireAssetOrder(source.publicationsHtml, '/admin/publications.js?', 'publicaciones');
requireAssetOrder(source.purchasesHtml, '/admin/purchases.js?', 'compras');
requireAssetOrder(source.salesHtml, '/admin/sales.js?', 'ventas');
requireAssetOrder(source.invoicesHtml, '/admin/invoices.js?', 'facturas por cobrar');
requireAssetOrder(source.payablesHtml, '/admin/payables.js?', 'facturas por pagar');

const integrations = [
  [source.clients, "key:'client:new'", "root:byId('clientCreateForm')", 'clientes'],
  [source.containers, "key:'container:new'", "root:byId('shipmentRegistrationForm')", 'contenedores'],
  [source.products, "`product:${item.id}` : 'product:new'", "root:$('productForm')", 'productos'],
  [source.suppliers, "`supplier:${item.id}` : 'supplier:new'", "root:$('supplierForm')", 'proveedores'],
  [source.publications, "`publication:${id}` : 'publication:new'", "root:$('publicationForm')", 'publicaciones'],
  [source.purchases, "`purchase-order:${order.id}`:'purchase-order:new'", "root:document.querySelector('#orderModal .purchase-order-dialog')", 'compras'],
  [source.sales, "`sales-order:${order.id}`:'sales-order:new'", "root:document.querySelector('#orderModal .sales-order-dialog')", 'ventas'],
  [source.invoices, "key:`invoice:${invoice ? 'edit' : 'new'}:${suffix}`", "root:document.querySelector('#invoiceModal .invoice-form-dialog')", 'facturas por cobrar'],
  [source.payables, "`supplier-bill:${bill.id}` : 'supplier-bill:new'", "root:document.querySelector('#billModal .payable-form-dialog')", 'facturas por pagar']
];

for (const [moduleSource, key, root, label] of integrations) {
  requireText(moduleSource, 'ExportMcaDrafts?.register', `registro de borrador en ${label}`);
  requireText(moduleSource, key, `clave estable de borrador en ${label}`);
  requireText(moduleSource, root, `raíz explícita de borrador en ${label}`);
  requireText(moduleSource, 'clear({', `limpieza tras guardado en ${label}`);
}

for (const [moduleSource, label] of [
  [source.publications, 'publicaciones'],
  [source.purchases, 'compras'],
  [source.sales, 'ventas'],
  [source.invoices, 'facturas por cobrar'],
  [source.payables, 'facturas por pagar']
]) {
  requireText(moduleSource, 'capture', `captura personalizada en ${label}`);
  requireText(moduleSource, 'restore', `restauración personalizada en ${label}`);
}

for (const text of ['draft_pricing_mode', 'draft_price_value', 'lines:']) {
  requireText(source.purchases, text, `líneas dinámicas de compras ${text}`);
}
for (const text of ['price_mode', 'line_total', 'lines:']) {
  requireText(source.sales, text, `líneas dinámicas de ventas ${text}`);
}
requireText(source.publications, 'image_urls', 'fotos de publicación en el borrador');
requireText(source.invoices, 'sales_order_item_id', 'identidad estable de líneas de factura por cobrar');
requireText(source.payables, 'purchase_order_item_id', 'identidad estable de líneas de factura por pagar');
requireText(source.salesUx, 'window.SalesOrderDrafts?.saved?.()', 'limpieza después de guardar una venta');

const allIntegrationSource = [source.clients, source.containers, source.products, source.suppliers, source.publications, source.purchases, source.sales, source.invoices, source.payables].join('\n');
forbid(allIntegrationSource, /key\s*:\s*[`'"][^\n`'"]*(?:payment|collection|allocation|reverse|reversal)/i, 'pagos, cobros, asignaciones o reversiones no pueden tener borrador');
forbid(allIntegrationSource, /root\s*:[^\n]*(?:payment|collection|allocation|reverse|reversal).*ExportMcaDrafts/i, 'un formulario financiero irreversible quedó conectado al autoguardado');

for (const file of [files.core, files.clients, files.containers, files.products, files.suppliers, files.publications, files.purchases, files.sales, files.salesUx, files.invoices, files.payables]) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio:'pipe' });
  } catch (error) {
    failures.push(`error de sintaxis en ${file}: ${String(error.stderr || error.message).trim()}`);
  }
}

if (failures.length) {
  console.error('Form draft contract failed:');
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Form draft contract passed.');
console.log('- Los borradores son locales, caducan, están separados por usuario y excluyen campos sensibles.');
console.log('- Todos los formularios operativos autorizados cargan el owner antes de su módulo.');
console.log('- Las líneas dinámicas se conservan y las acciones financieras irreversibles quedan fuera.');
