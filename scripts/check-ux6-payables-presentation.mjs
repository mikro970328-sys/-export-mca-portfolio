import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const exists=file=>fs.existsSync(path.join(root,file));
const failures=[];
const requireText=(source,text,label)=>{if(!source.includes(text))failures.push(`${label}: falta ${text}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of ['admin/payables.css','admin/payables.html','admin/payables.js','api/payables.js','api/supplier-payments.js','scripts/check-ux5-supplier-ap-actions.mjs','.github/workflows/ux6-payables-presentation.yml']){
  if(!exists(file))failures.push(`falta ${file}`);
}

if(!failures.length){
  const css=read('admin/payables.css');
  const html=read('admin/payables.html');
  const ui=read('admin/payables.js');
  const bills=read('api/payables.js');
  const payments=read('api/supplier-payments.js');
  const ux5=read('scripts/check-ux5-supplier-ap-actions.mjs');
  const workflow=read('.github/workflows/ux6-payables-presentation.yml');

  requireText(html,'/admin/payables.css?v=20260902-ux6owner2','Payables HTML owner CSS');
  requireText(html,'id="newAdvancePayment"','Payables HTML anticipo explícito');
  requireText(html,'id="pOpenBalanceHint"','Payables HTML ayuda de saldo');
  requireText(html,'role="status"','Payables HTML feedback accesible');
  forbid(html,/\sstyle\s*=/i,'Payables HTML conserva estilos inline');
  forbid(html,/payables-payment-ux\.js/,'Payables HTML carga el decorador retirado');

  for(const token of [
    "actionAllowed(bill,'pay')",
    "actionAllowed(bill,'edit')",
    "actionAllowed(bill,'post')",
    "actionAllowed(bill,'void')",
    "actionAllowed(payment,'allocate')",
    "actionAllowed(payment,'reverse')",
    "state.paymentMode==='direct'",
    "state.paymentMode==='advance'",
    "body.action='pay_bill'",
    'state.advancePurchaseOrders = Array.isArray(payments.advance_purchase_orders)',
    'safeApMessage',
    'reportError',
    'Sin facturas en esta vista',
    'Sin pagos en esta vista',
    'class="allocation-amount"'
  ])requireText(ui,token,'Payables consolidated owner');
  forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Payables owner usa diálogos nativos');
  forbid(ui,/\bMutationObserver\b/,'Payables owner usa MutationObserver compensatorio');
  forbid(ui,/window\.fetch\s*=/,'Payables owner intercepta fetch');
  forbid(ui,/(?:textContent|innerHTML)\s*=\s*error\??\.message/,'Payables owner expone error técnico');
  forbid(ui,/message\([^\n;]*error\??\.message/,'Payables owner envía error crudo al feedback');
  forbid(ui,/expediente/i,'Payables owner reintroduce Expedientes');
  if(exists('admin/payables-payment-ux.js'))failures.push('admin/payables-payment-ux.js debe permanecer retirado');

  for(const [source,label,fallback] of [
    [bills,'Payables API',"return fail(res,500,'No se pudo procesar Cuentas por pagar')"],
    [payments,'Supplier payments API',"return fail(res,500,'No se pudo procesar el pago del proveedor')"]
  ]){
    requireText(source,'const translated = translatedError(raw)',`${label} traduce errores conocidos`);
    requireText(source,'if (translated) return fail(res,400,translated)',`${label} conserva validaciones operativas`);
    requireText(source,fallback,`${label} boundary inesperado estable`);
    forbid(source,/messages\.find\([^\n]+\)\?\.\[1\]\s*\|\|\s*raw/,`${label} devuelve error técnico crudo`);
  }

  for(const token of ['.ap-head','.ap-toolbar','.ap-payment-hint','.allocation-amount','.erp-module-payables .orders > .row','.erp-module-payables .summary','@media(max-width:680px)'])requireText(css,token,'Payables CSS dedicado');
  forbid(css,/@import|purchases\.css/i,'Payables conserva dependencia visual de Compras');
  requireText(ux5,"if(fs.existsSync('admin/payables-payment-ux.js'))",'Gate UX5 reconoce owner consolidado');
  requireText(workflow,'npm install --ignore-scripts --no-audit --no-fund','Workflow instala dependencias');
  requireText(workflow,'node scripts/check-ux6-payables-presentation.mjs','Workflow ejecuta gate UX6 AP');
  requireText(workflow,'node scripts/check-ux5-supplier-ap-actions.mjs','Workflow conserva owner UX5');
}

if(failures.length){
  console.error(`UX6 Payables presentation check failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}
console.log('UX6 Payables presentation check passed.');
