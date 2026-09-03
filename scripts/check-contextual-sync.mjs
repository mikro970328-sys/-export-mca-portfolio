import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const requiredFiles=[
  'admin/operational-navigation.js',
  'admin/operational-context-bridge.js',
  'admin/tasks-navigation.js',
  'api/operational-links.js',
  'admin/invoices.js',
  'admin/payables.js'
];
for(const file of requiredFiles)if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta archivo P6`);

if(requiredFiles.every(file=>fs.existsSync(path.join(root,file)))){
  const nav=read(requiredFiles[0]);
  const bridge=read(requiredFiles[1]);
  const taskNav=read(requiredFiles[2]);
  const api=read(requiredFiles[3]);
  const invoiceOwner=read(requiredFiles[4]);
  const payablesOwner=read(requiredFiles[5]);

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
    'direct_shipments',
    'Contenedores / Tracking'
  ]) if(!bridge.includes(required))failures.push(`operational-context-bridge.js: falta ${required}`);
  for(const forbidden of ['openExpediente','Tracking / Expediente','Expediente ·']){
    if(bridge.includes(forbidden))failures.push(`operational-context-bridge.js: referencia activa prohibida ${forbidden}`);
  }
  if(/function initLoads\s*\(/.test(bridge))failures.push('operational-context-bridge.js: conserva un segundo owner de Cargues');
  if(bridge.includes('/admin/loads.html'))failures.push('operational-context-bridge.js: todavía se activa dentro de Cargues');
  if(!nav.includes("callEmbedded('loadsSection','LoadsModule.openLoad'"))failures.push('operational-navigation.js: Cargues no delega al owner canónico LoadsModule');
  if(/CONTEXT_SECTIONS[^;]*loadsSection/.test(nav))failures.push('operational-navigation.js: Cargues sigue incluido en el bridge compartido');
  if(/function initInvoices\s*\(/.test(bridge))failures.push('operational-context-bridge.js: conserva un segundo owner de Facturación');
  if(bridge.includes('/admin/invoices.html'))failures.push('operational-context-bridge.js: todavía se activa dentro de Facturación');
  if(/CONTEXT_SECTIONS[^;]*invoicesSection/.test(nav))failures.push('operational-navigation.js: Facturación sigue incluida en el bridge compartido');
  for(const required of [
    "callEmbedded('invoicesSection','InvoicesModule.openInvoice'",
    "callEmbedded('invoicesSection','InvoicesModule.openCollection'",
    "callEmbedded('invoicesSection','InvoicesModule.openForSalesOrder'"
  ]) if(!nav.includes(required))failures.push(`operational-navigation.js: Facturación no delega al owner canónico ${required}`);
  for(const required of [
    'window.InvoicesModule = Object.freeze({',
    'openInvoice,',
    'openCollection,',
    'openForSalesOrder',
    'window.openOperationalInvoice = openInvoice;',
    'window.openOperationalInvoiceCollection = openCollection;',
    'window.openOperationalInvoiceForSalesOrder = openForSalesOrder;'
  ]) if(!invoiceOwner.includes(required))failures.push(`admin/invoices.js: falta navegación canónica ${required}`);
  if(/function initPayables\s*\(/.test(bridge))failures.push('operational-context-bridge.js: conserva un segundo owner de Cuentas por pagar');
  if(bridge.includes('/admin/payables.html'))failures.push('operational-context-bridge.js: todavía se activa dentro de Cuentas por pagar');
  if(/CONTEXT_SECTIONS[^;]*payablesSection/.test(nav))failures.push('operational-navigation.js: Cuentas por pagar sigue incluida en el bridge compartido');
  if(!nav.includes("callEmbedded('payablesSection','PayablesModule.openBill'"))failures.push('operational-navigation.js: Cuentas por pagar no delega al owner canónico PayablesModule');
  for(const required of [
    'window.PayablesModule = Object.freeze({',
    "owner: 'payables.js'",
    'openBill,',
    'openPayment'
  ]) if(!payablesOwner.includes(required))failures.push(`admin/payables.js: falta navegación canónica ${required}`);

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
