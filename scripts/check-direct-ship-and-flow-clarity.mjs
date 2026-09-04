import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const purchasesHtml=read('admin/purchases.html');
const purchasesJs=read('admin/purchases.js');
const purchasesCss=read('admin/purchases.css');
const purchasesApi=read('api/purchases.js');
const salesHtml=read('admin/sales.html');
const salesJs=read('admin/sales.js');
const salesSupply=read('admin/sales-supply-workspace.js');
const salesSupplyApi=read('api/sales-supply.js');
const navigation=read('admin/navigation-shell.js');
const operationalNavigation=read('admin/operational-navigation.js');
const warehouseHtml=read('admin/warehouse.html');
const inventoryHtml=read('admin/inventory.html');
const refresh=read('admin/embedded-auto-refresh.js');
const migration=read('supabase/migrations/20260904013221_purchase_direct_ship_no_wr.sql');
const supplyConsistencyMigration=read('supabase/migrations/20260904013835_purchase_destination_supply_consistency.sql');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};

for(const text of [
  'id="oDestinationMode"',
  'Recibir en mi almacén',
  'Direct Ship al cliente (sin WR)',
  'id="oDestinationHelp"',
  '/admin/purchases.js?v=20260904-safeedit1',
  '/admin/embedded-auto-refresh.js?v=20260904-live2'
])requireText(purchasesHtml,text,`Compras ${text}`);

for(const text of [
  'function isDirectPurchase(order)',
  'function setPurchaseDestination(mode)',
  "warehouse_id:direct?null:$('oWarehouse').value",
  'Ventas → Origen / Direct Ship',
  'Direct Ship · sin WR',
  'No entra a inventario',
  'No se creará un WR.'
])requireText(purchasesJs,text,`flujo Direct Ship en Compras ${text}`);

for(const text of [
  '.purchase-destination-help',
  '.purchase-destination-help.direct',
  '.purchase-direct-pill'
])requireText(purchasesCss,text,`presentación de destino ${text}`);

requireText(purchasesApi,'PO_DIRECT_SHIP_NO_WR','mensaje seguro para una PO Direct Ship');

for(const text of [
  'Origen / Direct Ship',
  '/admin/sales.js?v=20260904-directflow1',
  '/admin/embedded-auto-refresh.js?v=20260904-live2'
])requireText(salesHtml,text,`ruta visible desde Ventas ${text}`);
for(const text of [
  'data-supply-order=',
  'window.SalesSupplyWorkspace?.open'
])requireText(salesJs,text,`acceso Direct Ship por venta ${text}`);
for(const text of [
  '<option value="purchase_direct">Direct Ship</option>',
  "warehouse_id:method==='purchase_direct'?null:byId('supplyWarehouse').value"
])requireText(salesSupply,text,`flujo Direct Ship canónico ${text}`);
for(const text of [
  "compatible_methods:po.warehouse_id?['purchase_warehouse']:['purchase_direct']",
  'SUPPLY_WAREHOUSE_PO_REQUIRED',
  'la compra debe tener destino Direct Ship'
])requireText(salesSupplyApi,text,`compatibilidad de destino ${text}`);

for(const text of [
  "label:'Recepciones (WR)'",
  "label:'Existencias'",
  "src:'/admin/warehouse.html?embedded=1&v=20260904-flowclarity1'",
  "src:'/admin/inventory.html?embedded=1&v=20260904-flowclarity1'"
])requireText(navigation,text,`navegación clara ${text}`);
requireText(operationalNavigation,"warehouse_receipt:{label:'Recepciones (WR)'",'nombre operativo de Recepciones');
requireText(operationalNavigation,"'warehouse.write':'registrar Recepciones WR'",'permiso explicado como recepción');

for(const text of [
  '<title>Recepciones (WR) · Export MCA</title>',
  '<h1 id="warehousePageTitle">Recepciones (WR)</h1>',
  'Cada WR recibido suma mercancía a Existencias',
  'un Direct Ship no pasa por esta etapa',
  'Registrar entrada WR',
  '/admin/embedded-auto-refresh.js?v=20260904-live2'
])requireText(warehouseHtml,text,`Recepciones ${text}`);

for(const text of [
  '<title>Existencias · Export MCA</title>',
  '<h1 id="inventoryPageTitle">Existencias</h1>',
  'Aquí no registras entradas',
  'un Direct Ship tampoco aparece como stock propio',
  '/admin/embedded-auto-refresh.js?v=20260904-live2'
])requireText(inventoryHtml,text,`Existencias ${text}`);

for(const text of [
  'function scheduleSourceRefresh(frame,scope)',
  'if(sourceFrame)scheduleSourceRefresh(sourceFrame,scope)',
  "if(method==='GET'&&current?.fallbackTimer)",
  "if(current.wasBusy&&!busy&&current.pending)refreshFrame(frame,'close-after-change')",
  "scheduleShellRefresh('cross-tab-change',scope)"
])requireText(refresh,text,`actualización después de guardar ${text}`);
for(const forbidden of [
  "window.addEventListener('focus'",
  "document.addEventListener('visibilitychange'",
  "refreshFrame(frame, 'section-open')",
  "refreshFrame(sourceFrame, `mutation:${scope}:self`)"
])if(refresh.includes(forbidden))failures.push(`recarga pasiva prohibida ${forbidden}`);

for(const text of [
  'NULL means Direct Ship',
  "'destination_mode',case when v_po.warehouse_id is null then 'direct' else 'warehouse' end",
  'v_po.warehouse_id is not null',
  "when v_po.warehouse_id is null then 'PO_DIRECT_SHIP_NO_WR'",
  'revoke all on function public.purchase_order_action_state(uuid) from public,anon,authenticated;',
  'grant execute on function public.purchase_order_action_state(uuid) to service_role;'
])requireText(migration,text,`contrato de datos Direct Ship ${text}`);

for(const text of [
  'validate_sales_procurement_purchase_destination()',
  "v_supply_method='purchase_direct' and v_purchase_warehouse_id is not null",
  "v_supply_method='purchase_warehouse'",
  "raise exception 'SUPPLY_WAREHOUSE_PO_REQUIRED'",
  'new.warehouse_id is null',
  'sales_procurement_allocations_destination_consistency',
  'revoke execute on function public.validate_sales_procurement_purchase_destination()',
  'grant execute on function public.validate_sales_procurement_purchase_destination()'
])requireText(supplyConsistencyMigration,text,`consistencia Compra → ruta ${text}`);

if(failures.length){
  console.error('Direct Ship and flow clarity check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Direct Ship and flow clarity check passed.');
