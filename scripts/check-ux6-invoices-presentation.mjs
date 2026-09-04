import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const html=read('admin/invoices.html');
const css=read('admin/invoices.css');
const ui=read('admin/invoices.js');
const invoices=read('api/invoices.js');
const payments=read('api/invoice-payments.js');
const canonicalGate=read('scripts/check-ux5-invoice-actions.mjs');
const workflow=read('.github/workflows/ux6-invoices-presentation.yml');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

for(const text of [
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/invoices.css?v=20260903-ux7invoices1',
  '/admin/invoices.js?v=20260903-ux7invoices1',
  '/admin/embedded-auto-refresh.js?v=20260904-live2',
  'data-owner="invoices.js"',
  'invoices-table-wrap',
  'invoice-modal-actions'
])requireText(html,text,`HTML ${text}`);
forbid(html,/\sstyle=/i,'Facturas conserva estilos inline en HTML');
forbid(html,/purchases\.css/i,'Facturas vuelve a depender del CSS de Compras');

for(const text of [
  '.invoices-page-head',
  '.invoices-hero-state',
  '.invoices-metrics',
  '.invoices-list-panel',
  '.invoices-table-wrap',
  '.invoice-row',
  '.invoice-modal-actions',
  '.invoice-detail-summary',
  '@media(max-width:720px)'
])requireText(css,text,`CSS ${text}`);
forbid(css,/@import/i,'Facturas conserva una importación CSS tardía');
requireText(css,'overflow-x:auto;','Facturas conserva scroll horizontal interno en la tabla');
requireText(css,'overflow-x:hidden;','Facturas protege el ancho del documento');

for(const text of [
  'SAFE_INVOICE_ERROR_PATTERNS',
  'function safeInvoiceMessage(error, fallback =',
  'function reportInvoiceError(context, error, fallback =',
  "console.error('INVOICES_UI_FAILED'",
  "reportInvoiceError('save_invoice', error)",
  "reportInvoiceError('save_payment', error)",
  "reportInvoiceError('decision', error)",
  "reportInvoiceError('bootstrap', error",
  'const PAYMENT_STATUS_LABELS = Object.freeze({',
  "PAYMENT_STATUS_LABELS[value] || 'Estado no disponible'",
  "can(invoice, 'record_payment')",
  "can(invoice, 'edit')",
  "can(invoice, 'issue')",
  "can(invoice, 'void')",
  "canPayment(payment, 'reverse')"
])requireText(ui,text,`owner de Facturas ${text}`);
forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Facturas no puede usar diálogos nativos');
forbid(ui,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?error(?:\?\.)?\.message/,'Facturas no puede mostrar error.message crudo');
forbid(ui,/\sstyle=/i,'Facturas no puede generar estilos inline');
forbid(ui,/esc\(payment\.status\)/,'Facturas no puede exponer estados técnicos de cobro');

for(const [source,label,stable,code] of [
  [invoices,'api/invoices.js',"return fail(res,500,'No se pudo procesar Facturación. Intenta nuevamente.'",'INVOICE_UNEXPECTED_ERROR'],
  [payments,'api/invoice-payments.js',"return fail(res,500,'No se pudo procesar el cobro. Intenta nuevamente.'",'PAYMENT_UNEXPECTED_ERROR']
]){
  requireText(source,'function translatedError(raw)',`${label} clasifica errores esperados`);
  requireText(source,"['JSON_INVALID','La solicitud no tiene un formato válido.']",`${label} traduce JSON inválido`);
  requireText(source,'if(translated)return fail(res,400,translated.message,{code:translated.code})',`${label} conserva errores operativos 400`);
  requireText(source,stable,`${label} usa 500 estable`);
  requireText(source,code,`${label} expone código estable inesperado`);
  forbid(source,/return\s+fail\([^\n]*(?:error\?\.message|error\.message|\|\|\s*raw)/,`${label} devuelve error interno crudo`);
  forbid(source,/return\s+messages\.find\([^\n]*\?\.\[1\]\|\|raw/,`${label} conserva fallback crudo`);
}

for(const text of [
  'loadInvoiceFinanceCapabilityMaps',
  "can(invoice, 'record_payment')",
  "can(invoice, 'edit')",
  "can(invoice, 'issue')",
  "can(invoice, 'void')",
  "canPayment(payment, 'reverse')"
])requireText(`${canonicalGate}\n${invoices}\n${ui}`,text,`ownership canónico ${text}`);

for(const text of [
  'node scripts/check-ux6-invoices-presentation.mjs',
  'node scripts/check-ux7-invoices-visual-owner.mjs',
  'node scripts/check-ux5-invoice-actions.mjs',
  'node scripts/check-sales-customer-finance.mjs',
  'node scripts/check-ux5-customer-finance-actions.mjs',
  'node scripts/check-contextual-sync.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,text,`workflow ${text}`);

if(failures.length){
  console.error('UX6 Invoices presentation gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Invoices presentation gate passed.');
