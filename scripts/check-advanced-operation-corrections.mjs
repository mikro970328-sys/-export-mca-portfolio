import assert from 'node:assert/strict';
import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const migration=read('supabase/migrations/20261013181011_advanced_operation_corrections.sql');
const salesApi=read('api/sales.js');
const workspace=read('admin/sales-workspace.js');
const supply=read('admin/sales-supply-workspace.js');
const navigation=read('admin/operational-navigation.js');
const shipmentEditor=read('admin/shipment-editor.js');
const html=read('admin/sales.html');

for(const token of [
  'function public.revise_sales_order_details',
  "set_config('export_mca.so_details_revision','on',true)",
  "'correct_details'",
  'security_invoker=true',
  'grant execute on function public.revise_sales_order_details'
])assert.ok(migration.includes(token),`missing migration contract: ${token}`);

assert.match(migration,/new\.client_id is distinct from old\.client_id[\s\S]*new\.currency is distinct from old\.currency/);
assert.match(migration,/new\.nationalization_status is distinct from old\.nationalization_status/);
assert.ok(salesApi.includes("action === 'correct_details'"));
assert.ok(salesApi.includes("'sales_order_details_corrected'"));

for(const token of [
  "data-ws-action=\"correct_sale_details\"",
  "action:'correct_details'",
  "data-ws-action=\"collect_sale\"",
  'async function collectSale()',
  'No necesitas crear ni emitir una factura antes de cobrar.',
  "data-ws-action=\"edit_tracking\"",
  'Editar BK / B/L / contenedor'
])assert.ok(workspace.includes(token),`missing sales UX contract: ${token}`);

const renderBilling=workspace.slice(workspace.indexOf('function renderBilling()'),workspace.indexOf('function costLabel('));
assert.doesNotMatch(renderBilling,/data-ws-action="(?:new_invoice|issue_invoice)"/,'Sales billing cannot expose invoice workflow steps');
assert.match(renderBilling,/data-ws-action="collect_sale"/);

assert.match(supply,/data-supply-action="open-po"[^>]*>Editar compra</);
assert.match(supply,/Editar BK \/ B\/L \/ contenedor/);
assert.match(supply,/openTracking\?\.\(\{shipmentId:data\.shipmentId\},\{edit:true\}\)/);
assert.match(navigation,/options\.edit===true&&window\.ShipmentEditor\?\.open/);
for(const id of ['editorContainer','editorBooking','editorBol'])assert.ok(shipmentEditor.includes(`id="${id}"`),`missing shipment correction field ${id}`);

assert.ok(html.includes('/admin/sales-workspace.js?v=20261013-operation-corrections1'));
assert.ok(html.includes('/admin/sales-supply-workspace.js?v=20261013-operation-corrections1'));

console.log('Advanced ERP corrections: sale metadata, purchase access, container references and direct collection contracts passed.');
