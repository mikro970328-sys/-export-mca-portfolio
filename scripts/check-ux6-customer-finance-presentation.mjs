import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const html=read('admin/sales.html');
const ui=read('admin/sales-customer-finance.js');
const css=read('admin/sales-customer-finance.css');
const printCss=read('admin/proforma-print.css');
const advances=read('api/customer-advances.js');
const proformas=read('api/proformas.js');
const canonicalGate=read('scripts/check-ux5-customer-finance-actions.mjs');
const workflow=read('.github/workflows/ux6-customer-finance-presentation.yml');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

for(const text of [
  '/admin/sales-customer-finance.css?v=20260902-ux7sales1',
  '/admin/sales-customer-finance.js?v=20260902-ux6owner1'
])requireText(html,text,`asset versionado ${text}`);

for(const text of [
  'SAFE_CUSTOMER_FINANCE_ERROR_PATTERNS',
  'function safeCustomerFinanceMessage(error, fallback =',
  'function reportCustomerFinanceError(context, error, fallback)',
  "console.error('CUSTOMER_FINANCE_UI_FAILED'",
  "reportCustomerFinanceError('form_save', error)",
  "reportCustomerFinanceError('decision_accept', error)",
  "reportCustomerFinanceError('open', error",
  "return STATUS_LABELS[value] || 'Estado no disponible'",
  '/admin/proforma-print.css?v=20260902-ux6owner1',
  "canSalesOrder('register_advance')",
  "canSalesOrder('create_proforma')",
  "can(row,'apply')",
  "can(row,'refund')",
  "can(row,'reverse')",
  "can(row,'issue')",
  "can(row,'void')"
])requireText(ui,text,`owner financiero ${text}`);
forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Anticipos/Proformas no puede usar diálogos nativos');
forbid(ui,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?error(?:\?\.)?\.message/,'Anticipos/Proformas no puede mostrar error.message crudo');
forbid(ui,/\sstyle=/i,'Anticipos/Proformas no puede generar estilos inline');
forbid(ui,/<style\b|createElement\(['"]style|style\.textContent/i,'Anticipos/Proformas no puede inyectar CSS');

for(const text of [
  '.sales-finance-form-dialog',
  '.sales-finance-decision-dialog',
  '#salesFinanceMsg',
  '.sales-finance-decision-copy'
])requireText(css,text,`CSS financiero ${text}`);
for(const text of [
  '.page{max-width:850px',
  '.proforma-print-actions',
  '@media print',
  '.no-print{display:none}'
])requireText(printCss,text,`CSS de impresión ${text}`);

for(const [source,label,stable,code] of [
  [advances,'customer-advances.js',"return fail(res,500,'No se pudieron procesar los anticipos. Intenta nuevamente.'",'CUSTOMER_ADVANCE_UNEXPECTED_ERROR'],
  [proformas,'proformas.js',"return fail(res,500,'No se pudo procesar Proformas. Intenta nuevamente.'",'PROFORMA_UNEXPECTED_ERROR']
]){
  requireText(source,'function translatedError(error)',`${label} clasifica errores esperados`);
  requireText(source,"['JSON_INVALID','La solicitud no tiene un formato válido.']",`${label} traduce JSON inválido`);
  requireText(source,'if(translated)return fail(res,400,translated.message,{code:translated.code})',`${label} conserva errores operativos 400`);
  requireText(source,stable,`${label} usa un 500 estable`);
  requireText(source,code,`${label} expone código estable inesperado`);
  forbid(source,/return\s+fail\([^\n]*(?:error\?\.message|error\.message|\|\|\s*raw)/,`${label} devuelve error interno crudo`);
  forbid(source,/return\s+fail\(res,400,(?:friendly|translatedError)\(/,`${label} clasifica todo fallo como 400`);
}

for(const text of [
  "canSalesOrder('register_advance')",
  "canSalesOrder('create_proforma')",
  "can(row,'issue')",
  "can(row,'void')",
  'loadCustomerFinanceCapabilityMaps'
])requireText(`${canonicalGate}\n${ui}\n${advances}\n${proformas}`,text,`ownership canónico ${text}`);

for(const text of [
  'node scripts/check-ux6-customer-finance-presentation.mjs',
  'node scripts/check-sales-customer-finance.mjs',
  'node scripts/check-ux5-customer-finance-actions.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,text,`workflow ${text}`);

if(failures.length){
  console.error('UX6 Customer Finance presentation gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Customer Finance presentation gate passed.');
