import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const requiredFiles=[
  'admin/operational-navigation.js',
  'admin/operational-context-bridge.js',
  'admin/tasks-navigation.js',
  'api/operational-links.js'
];
for(const file of requiredFiles)if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta archivo P6`);

if(requiredFiles.every(file=>fs.existsSync(path.join(root,file)))){
  const nav=read(requiredFiles[0]);
  const bridge=read(requiredFiles[1]);
  const taskNav=read(requiredFiles[2]);
  const api=read(requiredFiles[3]);

  for(const required of [
    'const WORKFLOW_ACCESS=',
    'async function openEntity',
    'async function openWork',
    'function openInvoice(',
    'function openSupplierBill(',
    'function openPurchaseReceipt(',
    'function openSalesSupply(',
    "context.type==='invoice'",
    "context.type==='supplier_bill'",
    "workflowKey==='shipment_cuba_documents'",
    "workflowKey==='supplier_bill_payment'",
    "workflowKey==='sales_invoice'",
    "workflowKey==='invoice_collection'",
    'missing_permissions'
  ]) if(!nav.includes(required))failures.push(`operational-navigation.js: falta ${required}`);

  for(const forbidden of ['openExpediente','loadsForOperation']){
    if(nav.includes(forbidden))failures.push(`operational-navigation.js: referencia legacy prohibida ${forbidden}`);
  }

  for(const required of [
    'openOperationalPurchaseReceipt',
    'openOperationalSalesSupply',
    'openOperationalInvoiceCollection',
    'openOperationalInvoiceForSalesOrder',
    'openOperationalSupplierBill',
    'direct_shipments',
    'Contenedores / Tracking'
  ]) if(!bridge.includes(required))failures.push(`operational-context-bridge.js: falta ${required}`);
  for(const forbidden of ['openExpediente','Tracking / Expediente','Expediente ·']){
    if(bridge.includes(forbidden))failures.push(`operational-context-bridge.js: referencia activa prohibida ${forbidden}`);
  }

  for(const required of ['Abrir trabajo','OperationalNavigation','openWork','stopImmediatePropagation','tasksModalActions']){
    if(!taskNav.includes(required))failures.push(`tasks-navigation.js: falta ${required}`);
  }
  if(taskNav.includes('MutationObserver'))failures.push('tasks-navigation.js: no debe usar MutationObserver');
  for(const forbidden of ['prompt(', 'alert(', 'confirm(']){
    if(taskNav.includes(forbidden))failures.push(`tasks-navigation.js: diálogo nativo prohibido ${forbidden}`);
    if(bridge.includes(forbidden))failures.push(`operational-context-bridge.js: diálogo nativo prohibido ${forbidden}`);
  }

  for(const required of [
    'authenticateAdmin',
    'loadAdminAccessContext',
    "can('finance.read')",
    'loadFinanceLinks',
    'shipment_direct_supply_contents',
    'supplier_bills',
    'invoices:financeData.invoices'
  ]) if(!api.includes(required))failures.push(`api/operational-links.js: falta ${required}`);
  if(api.includes("authorizeAdmin(req, res, 'logistics.read')"))failures.push('api/operational-links.js: no debe exigir logistics.read globalmente');
}

if(failures.length){
  console.error('P6 contextual-sync check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('P6 contextual-sync check passed.');
