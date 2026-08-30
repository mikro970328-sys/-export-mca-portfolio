import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const required=[
  'api/reports.js','admin/reports.html','admin/reports.js','admin/reports.css','admin/navigation-shell.js',
  'supabase/migrations/20260830225000_p12_executive_report_datasets.sql'
];
const errors=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
for(const file of required)if(!fs.existsSync(file))errors.push(`Falta ${file}`);
for(const file of ['api/reports.js','admin/reports.js','admin/navigation-shell.js']){
  if(!fs.existsSync(file))continue;
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0)errors.push(`Sintaxis inválida en ${file}: ${result.stderr||result.stdout}`);
}

const sql=read(required[5]);
const api=read('api/reports.js');
const html=read('admin/reports.html');
const ui=read('admin/reports.js');
const nav=read('admin/navigation-shell.js');

for(const fragment of [
  'executive_report_dataset','security invoker','REPORT_DATASET_INVALID','REPORT_FILTER_NOT_APPLICABLE',
  "'currency_policy','separate_no_fx'",'limit v_limit','grant execute on function public.executive_report_dataset'
])if(!sql.toLowerCase().includes(fragment.toLowerCase()))errors.push(`Contrato SQL P12 incompleto: ${fragment}`);
for(const role of ['public','anon','authenticated'])if(!sql.includes(role))errors.push(`Falta revocación explícita P12 para ${role}`);
if(!sql.includes('to service_role'))errors.push('RPC P12 no queda reservado a service_role.');
for(const source of ['executive_sales_order_kpi_source','executive_purchase_order_kpi_source','executive_invoice_kpi_source','executive_supplier_bill_kpi_source','executive_customer_payment_kpi_source','executive_supplier_payment_kpi_source','inventory_by_receipt']){
  if(!sql.includes(source))errors.push(`Dataset P12 no usa fuente autoritativa: ${source}`);
}
if(/\boperations\b|expediente/i.test(sql))errors.push('El contrato P12 no debe depender de Operations/Expedientes legacy.');

for(const fragment of [
  "authorizeAdmin(req,res,'reports.read')",'rpc/executive_report_dataset','parseExecutiveFilters','Content-Disposition',"format || '').toLowerCase()==='csv'",'currency_policy'
])if(!api.includes(fragment))errors.push(`API P12 incompleta: ${fragment}`);
for(const forbidden of ["supabase('payments'","supabase('invoices'","supabase('supplier_bills'","supabase('purchase_orders'","supabase('sales_orders'",'mode === \'operations\'','export-mca-expedientes']){
  if(api.includes(forbidden))errors.push(`API P12 evita fuente/flujo legacy directo: ${forbidden}`);
}

for(const fragment of ['Reportes','Exportar CSV','data-filter-dimension="period"','data-filter-dimension="currency"','data-filter-dimension="client"','data-filter-dimension="supplier"','data-filter-dimension="product"']){
  if(!html.includes(fragment))errors.push(`UI P12 incompleta: ${fragment}`);
}
for(const fragment of ['/api/reports','Authorization:`Bearer ${token()}`','response.blob()','URL.createObjectURL','FX: no se aplica','snapshot actual','window.ExecutiveReports=Object.freeze']){
  if(!ui.includes(fragment))errors.push(`Comportamiento P12 incompleto: ${fragment}`);
}
for(const forbidden of ['window.open(export','executive_dashboard_rollup','gross_margin -','cash_collected -','contribution_margin /','Expediente','newOperationsSection']){
  if(ui.includes(forbidden))errors.push(`Frontend P12 viola boundary: ${forbidden}`);
}
if(/[?&]token=|(?:searchParams|params)\.set\(\s*['"]token['"]/.test(ui))errors.push('Frontend P12 no puede exponer el token en URL/query string.');
if(/recognized_merchandise_cogs\s*[+\-*/]|gross_margin\s*[+\-*/]|contribution_margin\s*[+\-*/]|balance_due\s*[+\-*/]/.test(ui))errors.push('Frontend P12 contiene matemática financiera sobre métricas backend.');

for(const fragment of ["id:'reportsSection'","src:'/admin/reports.html?embedded=1'","permission:'reports.read'","sections:['payablesSection','costsSection','reportsSection']","openReports: () => openEmbeddedById('reportsSection')"]){
  if(!nav.includes(fragment))errors.push(`NavigationShell P12 incompleto: ${fragment}`);
}

if(errors.length){
  console.error('Validación P12 Reportes fallida:');
  errors.forEach(error=>console.error(`- ${error}`));
  process.exit(1);
}
console.log('Validación P12 Reportes superada.');
console.log('- JSON y CSV comparten api/reports.js + executive_report_dataset.');
console.log('- Filtros y dimensiones están whitelisted; inventario se marca snapshot actual.');
console.log('- Monedas permanecen separadas y no hay FX ni matemática financiera en frontend.');
console.log('- La autenticación del CSV viaja por Authorization header; el gate bloquea token en URL/query string.');
console.log('- NavigationShell muestra Reportes únicamente con reports.read.');
console.log('- No se reutiliza Operations/Expedientes como fuente financiera P12.');
