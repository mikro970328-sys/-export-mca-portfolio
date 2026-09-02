import fs from 'node:fs';

const files={
  html:'admin/sales.html',
  owner:'admin/sales-supply-workspace.js',
  styles:'admin/sales-supply-workspace.css',
  supplyApi:'api/sales-supply.js',
  directApi:'api/direct-shipment-dispatch.js',
  workflow:'.github/workflows/ux6-sales-supply-feedback.yml'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const html=read(files.html);
const owner=read(files.owner);
const css=read(files.styles);
const supplyApi=read(files.supplyApi);
const directApi=read(files.directApi);
const workflow=read(files.workflow);

for(const text of [
  "const publicErrorEndpoints=new Set(['/api/sales-supply','/api/direct-shipment-dispatch'])",
  'function safeSupplyMessage(',
  'SALES_SUPPLY_WORKSPACE_FAILED',
  'error.status=response.status',
  'error.code=data.details?.code||data.code||data.reason_code||null',
  "error.endpoint=String(path).split('?')[0]",
  "status===403",
  '[400,404,409,422].includes(status)',
  'sales-supply-main-message',
  'sales-supply-form-dialog',
  'sales-supply-decision-dialog',
  'sales-supply-proc-list',
  "classList.toggle('sales-supply-field-hidden'"
])requireText(owner,text,`contrato del owner ${text}`);

if((owner.match(/error\?\.message/g)||[]).length!==1)failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b/,'Abastecimiento vuelve a renderizar error.message directamente');
forbid(owner,/\sstyle\s*=/i,'Abastecimiento conserva estilos inline');
forbid(owner,/\.style(?:\.|\[)/,'Abastecimiento vuelve a mutar presentación desde JavaScript');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Abastecimiento vuelve a inyectar CSS desde JavaScript');
forbid(owner,/\bMutationObserver\b/,'Abastecimiento vuelve a observar y recomponer el DOM');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Abastecimiento vuelve a usar diálogos nativos');

for(const text of [
  '.sales-supply-main-message{margin:0 18px 14px}',
  '.sales-supply-modal .sales-supply-form-dialog{width:min(680px,95vw)}',
  '.sales-supply-modal .sales-supply-decision-dialog{width:min(520px,94vw)}',
  '.sales-supply-proc-list{margin-top:8px}',
  '.sales-supply-field-hidden{display:none}',
  '@media(max-width:700px)'
])requireText(css,text,`presentación dedicada ${text}`);

requireText(html,'/admin/sales-supply-workspace.css?v=20260902-ux6supply1','revisión del CSS de Abastecimiento');
requireText(html,'/admin/sales-supply-workspace.js?v=20260902-ux6supply1','revisión del JS de Abastecimiento');

for(const text of [
  "const errors={",
  "return raw.includes('SALES_ORDER_NOT_FOUND')?'Venta no encontrada.':'No se pudo actualizar el abastecimiento.'",
  "return fail(res,400,friendly(error))"
])requireText(supplyApi,text,`boundary seguro de sales-supply ${text}`);
for(const text of [
  'function friendly(error)',
  "||'No se pudo actualizar el Direct Ship.'",
  "return fail(res,400,friendly(error))"
])requireText(directApi,text,`boundary seguro de Direct Ship ${text}`);

for(const text of [
  '/api/sales-supply',
  '/api/direct-shipment-dispatch',
  'allocated_sales_quantity',
  'allocated_purchase_quantity',
  "owner:'sales-supply-workspace.js'"
])requireText(owner,text,`contrato funcional ${text}`);

for(const text of [
  'node scripts/check-ux6-sales-supply-feedback.mjs',
  'node scripts/check-sales-supply-workspace.mjs',
  'node scripts/check-ux5-sales-actions.mjs',
  'node scripts/check-ux6-sales-explicit-owner.mjs',
  'node scripts/check-ux6-sales-workspace-presentation.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs',
  'node scripts/check-cuba-documentation.mjs'
])requireText(workflow,text,`workflow ${text}`);

if(failures.length){
  console.error('UX-6 Sales supply feedback gate failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-6 Sales supply feedback gate passed.');
console.log('- Abastecimiento conserva un único owner sin observers ni presentación generada por JavaScript.');
console.log('- Los errores inesperados quedan en diagnóstico y la interfaz usa mensajes operativos seguros.');
console.log('- Cantidades, reservas, Purchase Orders, Direct Ship y APIs canónicas permanecen intactos.');
