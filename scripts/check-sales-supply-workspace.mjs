import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};

const html=read('admin/sales.html');
const salesUi=read('admin/sales.js');
const ui=read('admin/sales-supply-workspace.js');
const css=read('admin/sales-supply-workspace.css');
const api=read('api/sales-supply.js');
const directApi=read('api/direct-shipment-dispatch.js');
const migration=read('supabase/migrations/20260830053000_p1_direct_shipment_dispatch_lifecycle.sql');
const correctionMigration=read('supabase/migrations/20260910123500_direct_ship_quantity_corrections.sql');
const quickDirectMigration=read('supabase/migrations/20260920113000_sales_nationalization_and_quick_direct.sql');
const directSaleMigration=read('supabase/migrations/20260920213000_direct_sale_from_purchase.sql');

assert(html.includes('/admin/sales-supply-workspace.css?v=20260902-ux7sales1'),'Ventas no carga CSS de abastecimiento versionado');
assert(html.includes('/admin/sales-supply-workspace.js?v=20260920-direct2'),'Ventas no carga Asignar mercancía versionado');
assert(html.includes('id="openSupplyWorkspace"'),'Ventas no expone acceso a Abastecimiento');
assert(html.includes('Asignar mercancía'),'Ventas no muestra el acceso para asignar mercancía');
assert(salesUi.includes('data-supply-order'),'La lista de Ventas no expone Asignar mercancía');
assert(salesUi.includes('window.SalesSupplyWorkspace?.open'),'La lista de Ventas no abre el flujo Direct Ship');

for(const forbidden of ['MutationObserver','prompt(', 'alert(', 'confirm('])assert(!ui.includes(forbidden),`Abastecimiento contiene patrón prohibido: ${forbidden}`);
for(const required of ['Stock existente','Compra para almacén','Direct Ship','/api/sales-supply','/api/direct-shipment-dispatch','allocated_sales_quantity','allocated_purchase_quantity','Corregir cantidades','correct_quantity','planned_sales_quantity','latest_correction_reason'])assert(ui.includes(required),`Falta contrato UI de abastecimiento: ${required}`);
for(const required of ['data-supply-action="${directAction}"','Elegir Direct Ship',"action==='plan-direct'","editPlan(data.itemId,null,'purchase_direct')","plan?.supply_method||preferredMethod"])assert(ui.includes(required),`Direct Ship no queda visible o preseleccionado: ${required}`);
assert(!ui.includes('Usar almacén o inventario'),'Abastecimiento conserva un texto ambiguo frente a Direct Ship');
assert(ui.includes('El ERP asignará automáticamente el saldo disponible y sus pallets.'),'Direct Ship no explica la asignación automática');
assert(ui.includes("action:'quick_link_direct_purchase'"),'Una ruta Direct Ship existente no vincula la compra automáticamente');
assert(ui.includes('No tienes que escribir cantidades.'),'La ruta Direct Ship existente no explica que las cantidades son automáticas');
assert(ui.includes("plan.supply_method==='purchase_direct'?'':"),'Direct Ship todavía expone el botón para cambiar cantidades');
for(const removed of ['quickDirectSalesQty','quickDirectSalesPallets','quickDirectPurchaseQty','quickDirectPurchasePallets','quickDirectNotes'])assert(!ui.includes(removed),`Direct Ship todavía pide el campo redundante ${removed}`);
for(const removed of ['supplyDirectSalesQty','supplyDirectSalesPallets','supplyDirectPurchaseQty','supplyDirectPurchasePallets','supplyDirectNotes'])assert(!ui.includes(removed),`El contenedor Direct Ship todavía pide el campo redundante ${removed}`);
assert(ui.includes('No se aplica conversión automática')||ui.includes('sin conversión automática'),'La UI debe declarar que no inventa conversiones de unidad');
assert(css.includes('.sales-supply-modal')&&css.includes('.sales-supply-metrics'),'Faltan estilos estructurales de abastecimiento');

for(const required of ['sales_supply_plan_lines','sales_procurement_allocations','direct_shipment_allocations','sales_order_supply_item_progress'])assert(api.includes(required),`API abastecimiento no usa ${required}`);
assert(api.includes('rpc/assign_sales_order_item_direct_ship'),'API Direct Ship no usa la asignación atómica automática');
assert(api.includes('rpc/assign_procurement_to_direct_shipment'),'API de contenedor Direct Ship no usa el saldo automático');
assert(api.includes('rpc/assign_sales_supply_plan_direct_purchase'),'API de ruta Direct Ship no usa el vínculo automático');
assert(!api.includes('warehouses(id,code,name,location'),'API vuelve a consultar warehouses.location inexistente');
assert(!api.includes('unit_price,currency'),'API vuelve a consultar sales_order_items.currency inexistente');

for(const required of ['mark_direct_shipment_dispatched',"tracking_source:'erp'",'importer_id:order.importer_id','direct_shipment_dispatched','correct_direct_shipment_quantity','direct_shipment_quantity_corrected'])assert(directApi.includes(required),`Endpoint Direct Ship incompleto: ${required}`);
assert(!/registerShipsGo|shipsgo/i.test(directApi),'Direct Ship no puede depender de proveedor externo de tracking');
for(const required of ['direct_shipment_dispatches','SO_ALLOCATION_CONFLICTS_WITH_DIRECT_SUPPLY','SUPPLY_DIRECT_CONFLICTS_WITH_LOAD','shipment_customs_document_readiness'])assert(migration.includes(required),`Migration Direct Ship incompleta: ${required}`);
for(const required of ['direct_shipment_quantity_corrections','correct_direct_shipment_quantity','direct_shipment_effective_allocations','planned_sales_quantity','latest_correction_reason'])assert(correctionMigration.includes(required),`Migration de corrección Direct Ship incompleta: ${required}`);
for(const required of ['assign_sales_order_item_direct_ship','assign_procurement_to_direct_shipment','SUPPLY_QUICK_DIRECT_NO_SALE_BALANCE','SUPPLY_QUICK_DIRECT_NO_PURCHASE_BALANCE','SUPPLY_QUICK_DIRECT_NO_ALLOCATION_BALANCE','grant execute on function public.assign_sales_order_item_direct_ship','grant execute on function public.assign_procurement_to_direct_shipment'])assert(quickDirectMigration.includes(required),`Migration de asignación rápida incompleta: ${required}`);
for(const required of ['assign_sales_supply_plan_direct_purchase','create_direct_sale_from_purchase_order','DIRECT_SALE_PO_ALREADY_LINKED','grant execute on function public.assign_sales_supply_plan_direct_purchase'])assert(directSaleMigration.includes(required),`Migration Direct Ship desde compra incompleta: ${required}`);

console.log('Sales supply workspace checks passed');
