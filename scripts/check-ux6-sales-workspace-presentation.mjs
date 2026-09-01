import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const api=read('api/sales-workspace.js');
const invoiceHelper=read('api/_invoice-actions.js');
const workspace=read('admin/sales-workspace.js');
const controller=read('admin/sales-controller.js');
const css=read('admin/sales-workspace.css');
const html=read('admin/sales.html');
const profitabilityGate=read('scripts/check-sales-order-profitability.mjs');
const cubaGate=read('scripts/check-cuba-documentation.mjs');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

for(const text of [
  'loadAdminAccessContext',
  'loadSalesActionCapabilities',
  'loadInvoiceFinanceCapabilityMaps',
  'workspaceAccess(admin)',
  "permissions.has('documents.read')",
  "permissions.has('finance.read')",
  "permissions.has('finance.write')",
  "permissions.has('sales.write')",
  'loadSalesActionCapabilities(admin,salesOrderId,access.salesWritable)',
  'const financeWritable=access.financeReadable&&access.financeWritable',
  'loadInvoiceFinanceCapabilityMaps(admin,financeWritable)',
  'capabilities:salesCapabilities',
  'capabilities:capabilityMap.get(invoice.id)',
  "return fail(res,500,'No se pudo cargar el workspace de la venta')"
]) requireText(api,text,`owner backend ${text}`);
forbid(api,/\bhasPermission\s*\(/,'sales-workspace API no puede consultar permisos con un helper ficticio');
forbid(api,/return fail\(res,\s*(?:400|500),\s*raw\)/,'sales-workspace API no puede devolver errores internos crudos');

for(const text of [
  'loadInvoiceFinanceCapabilityMaps(admin,writeAccessOverride=null)',
  'writeAccessOverride===null?loadFinanceWriteAccess(admin):Promise.resolve(writeAccessOverride===true)'
]) requireText(invoiceHelper,text,`reuso del contexto financiero ${text}`);

for(const text of [
  'function saleCapability(key)',
  'function saleAllowed(key)',
  'function invoiceCapability(invoice,key)',
  'function invoiceAllowed(invoice,key)',
  'SAFE_WORKSPACE_ERROR_PATTERNS',
  'function safeWorkspaceMessage(error,fallback',
  'function workspaceDecision({title,copy,accept=',
  "saleAllowed('edit')",
  "saleAllowed('confirm')",
  "saleAllowed('close')",
  "saleAllowed('allocate_load')",
  "invoiceAllowed(invoice,'issue')",
  "invoiceAllowed(invoice,'record_payment')",
  'function historyTitle(row)',
  'function historyDetail(row)',
  'HISTORY_ACTION_LABELS',
  'HISTORY_ENTITY_LABELS',
  'SALES_WORKSPACE_LOAD_FAILED',
  'SALES_WORKSPACE_ACTION_FAILED',
  'SALES_WORKSPACE_INVOICE_CREATE_FAILED',
  'SALES_WORKSPACE_PAYMENT_FAILED',
  'SALES_WORKSPACE_COST_FAILED',
  "owner:'sales-workspace.js'"
]) requireText(workspace,text,`presentación ${text}`);

forbid(workspace,/\b(?:prompt|alert|confirm)\s*\(/,'Ventas no puede usar diálogos nativos');
forbid(workspace,/(?:showMessage|textContent|innerHTML)\s*(?:\([^)]*|=)\s*(?:esc\s*\(\s*)?error(?:\?\.)?\.message/,'Ventas no puede mostrar error.message crudo');
forbid(workspace,/JSON\.stringify\s*\(\s*row\.details\s*\)/,'Historial de Ventas no puede mostrar JSON técnico crudo');
forbid(workspace,/\bhasUnallocated\b/,'Workspace de Ventas no puede depender del helper roto hasUnallocated');
forbid(workspace,/commercial_status\s*===\s*['"](?:draft|confirmed)['"][^\n]{0,240}data-ws-action/,'Workspace de Ventas no puede inferir acciones desde commercial_status');
forbid(workspace,/invoice\.status\s*===\s*['"](?:draft|issued)['"][^\n]{0,240}data-ws-action/,'Workspace de Ventas no puede inferir acciones de factura desde status');
forbid(workspace,/byId\(['"]detailModal['"]\)\.classList\.add\(['"]hidden['"]\);if\(c\.createLoad/,'Workspace no debe ocultarse antes de que el owner acepte Preparar Cargue');

for(const text of [
  "order?.capabilities?.actions?.edit?.allowed !== true",
  "order?.capabilities?.actions?.[action]?.allowed !== true",
  "order?.capabilities?.actions?.allocate_load?.allowed !== true",
  "owner:'sales-controller.js'"
]) requireText(controller,text,`controller canónico ${text}`);
forbid(controller,/\bhasUnallocated\b/,'Controller de Ventas no puede exportar ni invocar hasUnallocated');
forbid(controller,/order\.status\s*!==|order\.status\s*===/,'Controller de Ventas no puede decidir acciones desde status');

for(const text of [
  '.sales-ws-decision-overlay',
  '.sales-ws-decision-panel',
  '.sales-ws-decision-actions',
  ':focus-visible',
  '@media(max-width:700px)'
]) requireText(css,text,`CSS ${text}`);

for(const asset of [
  '/admin/sales-workspace.css?v=20260901-ux6owner1',
  '/admin/sales-workspace.js?v=20260901-ux6owner1',
  '/admin/sales-controller.js?v=20260901-ux6owner1'
]) requireText(html,asset,`asset versionado ${asset}`);

for(const gate of [profitabilityGate,cubaGate]){
  requireText(gate,'loadAdminAccessContext','gate legacy alineado con P3');
  requireText(gate,'workspaceAccess(admin)','gate legacy alineado con el owner del workspace');
  forbid(gate,/hasPermission\(admin/,'gate legacy no puede exigir hasPermission ficticio');
}

for(const contract of [
  "request('/api/invoices'",
  "request('/api/invoice-payments'",
  "request('/api/costs'",
  "request(`/api/sales-workspace?sales_order_id=",
  'financialReadable()',
  'financialWritable()',
  'Documentos Cuba'
]) requireText(workspace,contract,`contrato preservado ${contract}`);
forbid(workspace,/\bexpediente(?:s)?\b/i,'Workspace de Ventas no puede reintroducir Expedientes');

if(failures.length){
  console.error('UX6 Sales workspace presentation gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Sales workspace presentation gate passed.');
