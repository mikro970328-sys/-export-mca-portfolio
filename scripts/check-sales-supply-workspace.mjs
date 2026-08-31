import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};

const html=read('admin/sales.html');
const ui=read('admin/sales-supply-workspace.js');
const css=read('admin/sales-supply-workspace.css');
const api=read('api/sales-supply.js');
const directApi=read('api/direct-shipment-dispatch.js');
const migration=read('supabase/migrations/20260830053000_p1_direct_shipment_dispatch_lifecycle.sql');

assert(html.includes('/admin/sales-supply-workspace.css?v=20260830-p1'),'Ventas no carga CSS de abastecimiento');
assert(html.includes('/admin/sales-supply-workspace.js?v=20260830-p1'),'Ventas no carga workspace de abastecimiento');
assert(html.includes('id="openSupplyWorkspace"'),'Ventas no expone acceso a Abastecimiento');

for(const forbidden of ['MutationObserver','prompt(', 'alert(', 'confirm(']){
  assert(!ui.includes(forbidden),`Abastecimiento contiene patrón prohibido: ${forbidden}`);
}
for(const required of ['Stock existente','Compra para almacén','Direct Ship','/api/sales-supply','/api/direct-shipment-dispatch','allocated_sales_quantity','allocated_purchase_quantity']){
  assert(ui.includes(required),`Falta contrato UI de abastecimiento: ${required}`);
}
assert(ui.includes('No se aplica conversión automática')||ui.includes('sin conversión automática'),'La UI debe declarar que no inventa conversiones de unidad');
assert(css.includes('.sales-supply-modal')&&css.includes('.sales-supply-metrics'),'Faltan estilos estructurales de abastecimiento');

for(const required of ['sales_supply_plan_lines','sales_procurement_allocations','direct_shipment_allocations','sales_order_supply_item_progress']){
  assert(api.includes(required),`API abastecimiento no usa ${required}`);
}
assert(!api.includes('warehouses(id,code,name,location'),'API vuelve a consultar warehouses.location inexistente');
assert(!api.includes('unit_price,currency'),'API vuelve a consultar sales_order_items.currency inexistente');

for(const required of ['mark_direct_shipment_dispatched',"tracking_source:'erp'",'importer_id:order.importer_id','direct_shipment_dispatched']){
  assert(directApi.includes(required),`Endpoint Direct Ship incompleto: ${required}`);
}
assert(!/registerShipsGo|shipsgo/i.test(directApi),'Direct Ship no puede depender de proveedor externo de tracking');
for(const required of ['direct_shipment_dispatches','SO_ALLOCATION_CONFLICTS_WITH_DIRECT_SUPPLY','SUPPLY_DIRECT_CONFLICTS_WITH_LOAD','shipment_customs_document_readiness']){
  assert(migration.includes(required),`Migration Direct Ship incompleta: ${required}`);
}

console.log('Sales supply workspace checks passed');
