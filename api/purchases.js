import { authorizeAdmin, fail, loadAdminAccessContext, ok, readJson, supabase, writeAudit } from './_lib.js';

const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const rpcRow=value=>Array.isArray(value)?(value[0]||null):(value||null);
const PO_SELECT='id,po_number,supplier_id,warehouse_id,order_date,expected_at,currency,supplier_reference,status,notes,created_by,created_at,updated_at,supplier:suppliers(id,name,legal_name,country,active),warehouse:warehouses(id,code,name,city,country,active)';

function permissionAwareCapabilities(raw,access){
  const state=raw&&typeof raw==='object'?JSON.parse(JSON.stringify(raw)):{actions:{}};
  const actions=state.actions&&typeof state.actions==='object'?state.actions:{};
  const permissionSet=new Set(access?.permissions||[]);
  const master=access?.master===true;
  const procurementWritable=master||permissionSet.has('procurement.write');
  const warehouseWritable=master||permissionSet.has('warehouse.write');
  for(const [key,entry] of Object.entries(actions)){
    if(!entry||typeof entry!=='object')continue;
    const required=key.startsWith('receive_')?'warehouse.write':'procurement.write';
    const permissionAllowed=required==='warehouse.write'?warehouseWritable:procurementWritable;
    entry.business_allowed=entry.allowed===true;
    if(entry.allowed===true&&!permissionAllowed){entry.allowed=false;entry.reason='PERMISSION_REQUIRED';}
    entry.required_permission=required;
  }
  state.actions=actions;
  return state;
}

async function listOrders(admin){
  const access=admin?.role==='master_admin'
    ? {master:true,permissions:[]}
    : {master:false,...await loadAdminAccessContext(admin?.admin_id)};
  const [orders,progress,items,allocations,capabilities]=await Promise.all([
    supabase('purchase_orders',{query:`?select=${PO_SELECT}&order=created_at.desc&limit=1000`}),
    supabase('purchase_order_progress',{query:'?select=*&order=po_number.desc&limit=1000'}),
    supabase('purchase_order_items',{query:'?select=id,purchase_order_id,product_id,ordered_quantity,ordered_pallets,unit,units_per_pallet,unit_cost,entered_line_total,currency,notes,created_at,updated_at,product:products(id,sku,name,brand,category,unit,package_format,default_units_per_pallet)&order=created_at.asc&limit=5000'}),
    supabase('purchase_receipt_allocations',{query:'?select=id,purchase_order_item_id,receipt_item_id,received_quantity,received_pallets,created_at,receipt_item:warehouse_receipt_items(id,receipt_id,lot_number,receipt:warehouse_receipts(id,receipt_number,status,received_at,warehouse_id,supplier_id))&order=created_at.asc&limit=5000'}),
    supabase('purchase_order_action_capabilities',{query:'?select=purchase_order_id,capabilities&limit=1000'})
  ]);
  const progressByPo=new Map((progress||[]).map(row=>[row.purchase_order_id,row]));
  const capabilitiesByPo=new Map((capabilities||[]).map(row=>[row.purchase_order_id,permissionAwareCapabilities(row.capabilities,access)]));
  const allocationsByItem=new Map();
  for(const allocation of allocations||[]){
    if(!allocationsByItem.has(allocation.purchase_order_item_id))allocationsByItem.set(allocation.purchase_order_item_id,[]);
    allocationsByItem.get(allocation.purchase_order_item_id).push(allocation);
  }
  const itemsByPo=new Map();
  for(const item of items||[]){
    const normalized={...item,allocations:allocationsByItem.get(item.id)||[]};
    if(!itemsByPo.has(item.purchase_order_id))itemsByPo.set(item.purchase_order_id,[]);
    itemsByPo.get(item.purchase_order_id).push(normalized);
  }
  return (orders||[]).map(order=>({...order,progress:progressByPo.get(order.id)||null,capabilities:capabilitiesByPo.get(order.id)||{actions:{}},items:itemsByPo.get(order.id)||[]}));
}

async function bootstrap(admin){
  const [orders,suppliers,warehouses,products]=await Promise.all([
    listOrders(admin),
    supabase('suppliers',{query:'?select=id,name,legal_name,country,active&active=eq.true&order=name.asc&limit=1000'}),
    supabase('warehouses',{query:'?select=id,code,name,city,country,active&active=eq.true&order=name.asc&limit=1000'}),
    supabase('products',{query:'?select=id,sku,name,brand,category,unit,package_format,default_units_per_pallet,active&active=eq.true&order=name.asc&limit=2000'})
  ]);
  return {orders,suppliers:suppliers||[],warehouses:warehouses||[],products:products||[]};
}

function cleanLines(lines){
  if(!Array.isArray(lines)||!lines.length)throw new Error('Agrega al menos una línea a la PO');
  return lines.map((line,index)=>{
    const productId=text(line.product_id,80);
    if(!productId)throw new Error(`Selecciona el producto de la línea ${index+1}`);
    return {product_id:productId,ordered_quantity:text(line.ordered_quantity,80),ordered_pallets:text(line.ordered_pallets,80),units_per_pallet:text(line.units_per_pallet,80),unit_cost:text(line.unit_cost,80),line_total:text(line.line_total,80),notes:text(line.notes,1000)};
  });
}
function cleanReceiptLines(lines){
  if(!Array.isArray(lines)||!lines.length)throw new Error('Selecciona mercancía para recibir');
  return lines.map((line,index)=>{
    const itemId=text(line.purchase_order_item_id,80);
    if(!itemId)throw new Error(`Falta la línea de PO ${index+1}`);
    return {purchase_order_item_id:itemId,received_quantity:text(line.received_quantity,80),received_pallets:text(line.received_pallets,80),units_per_pallet:text(line.units_per_pallet,80),net_weight_kg:text(line.net_weight_kg,80),gross_weight_kg:text(line.gross_weight_kg,80),lot_number:text(line.lot_number,200),notes:text(line.notes,1000)};
  });
}
const PURCHASE_ERROR_TRANSLATIONS=[
  ['JSON_INVALID','La solicitud no tiene un formato válido.'],['PO_SUPPLIER_NOT_FOUND','Proveedor no encontrado.'],['PO_SUPPLIER_INACTIVE','El proveedor está inactivo.'],['PO_WAREHOUSE_NOT_FOUND','Almacén no encontrado.'],['PO_WAREHOUSE_INACTIVE','El almacén está inactivo.'],['PO_PRODUCT_NOT_FOUND','Uno de los productos no existe.'],['PO_PRODUCT_INACTIVE','Uno de los productos está inactivo.'],['PO_HAS_INACTIVE_PRODUCT','La PO contiene un producto inactivo.'],['PO_HAS_NO_ITEMS','La PO debe tener al menos una línea.'],['PO_QUANTITY_REQUIRED','Cada línea debe tener cantidad o pallets.'],['PO_QUANTITY_INVALID','La cantidad de la PO es inválida.'],['PO_QUANTITY_PALLET_MISMATCH','La cantidad debe coincidir con los pallets multiplicados por las unidades por pallet.'],['PO_UNITS_PER_PALLET_INVALID','Las unidades por pallet son inválidas.'],['PO_LINE_TOTAL_INVALID','El valor total de la línea es inválido.'],['PO_LINE_TOTAL_REQUIRES_QUANTITY','Indica la cantidad para poder calcular el costo unitario desde el valor total.'],['PO_UNIT_COST_INVALID','El costo unitario es inválido.'],['PO_NOT_DRAFT','Solo una PO en borrador puede editarse o emitirse.'],['PO_NOT_ISSUED','Solo una PO emitida puede confirmarse.'],['PO_ITEMS_LOCKED_BY_STATUS','Las líneas ya no pueden modificarse en el estado actual.'],['PO_NOT_RECEIVABLE','La PO debe estar emitida o confirmada para recibir mercancía.'],['PO_DIRECT_SHIP_NO_WR','Una compra Direct Ship no entra al almacén y no crea WR. Continúa desde Ventas → Origen / Direct Ship.'],['PO_ALREADY_FULLY_RECEIVED','La mercancía de esta PO ya fue recibida completamente. Usa el ajuste de exceso sólo si realmente necesitas registrar mercancía adicional.'],['PO_NOT_FULLY_RECEIVED','El ajuste de exceso sólo corresponde a una PO ya recibida completamente.'],['PO_WR_WAREHOUSE_MISMATCH','El almacén receptor no coincide con la PO.'],['PO_RECEIPT_MULTIPLE_SUPPLIERS','Una misma recepción no puede mezclar proveedores.'],['PO_OVER_RECEIPT_REQUIRES_CONFIRMATION','La recepción excede lo ordenado y requiere confirmación explícita.'],['PO_RECEIPT_QUANTITY_REQUIRED','Indica una cantidad recibida mayor que cero.'],['PO_RECEIPT_QUANTITY_INVALID','La cantidad recibida es inválida.'],['WR_QUANTITY_PALLET_MISMATCH','La cantidad recibida debe coincidir con los pallets multiplicados por las unidades por pallet.'],['WR_GROSS_WEIGHT_LT_NET','El peso bruto no puede ser menor que el peso neto.'],['PO_HAS_ACTIVE_RECEIPTS','No se puede cancelar una PO con recepciones activas.'],['PO_CANNOT_CANCEL','La PO no puede cancelarse en su estado actual.'],['PO_CANNOT_CLOSE','La PO no puede cerrarse en su estado actual.'],['PO_ACTION_INVALID','Acción de Purchase Order no válida.'],['INVALID_PO_STATUS_TRANSITION','Transición de estado de PO no permitida.']
];
const SAFE_PURCHASE_INPUT_PATTERNS=[/^Agrega al menos /i,/^Selecciona /i,/^Falta la (?:línea|Purchase Order)/i];
function translatedError(raw){
  const translated=PURCHASE_ERROR_TRANSLATIONS.find(([key])=>raw.includes(key));
  if(translated)return{code:translated[0],message:translated[1],status:translated[0]==='PO_OVER_RECEIPT_REQUIRES_CONFIRMATION'?409:400};
  if(SAFE_PURCHASE_INPUT_PATTERNS.some(pattern=>pattern.test(raw)))return{code:'PURCHASE_INPUT_INVALID',message:raw,status:400};
  return{code:'PURCHASE_UNEXPECTED_ERROR',message:'No se pudo procesar Compras. Intenta nuevamente.',status:500};
}

export default async function handler(req,res){
  try{
    if(req.method==='GET'){
      const admin=await authorizeAdmin(req,res,'procurement.read');if(!admin)return;
      const data=await bootstrap(admin),id=text(req.query?.id,80);
      if(!id)return ok(res,data);
      const order=data.orders.find(item=>String(item.id)===id);
      if(!order)return fail(res,404,'Purchase Order no encontrada');
      return ok(res,{order,suppliers:data.suppliers,warehouses:data.warehouses,products:data.products});
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),action=text(body.action,60).toLowerCase();
    const admin=await authorizeAdmin(req,res,action==='receive'?'warehouse.write':'procurement.write');if(!admin)return;

    if(action==='create_plan'){
      const result=await supabase('rpc/create_purchase_order_plan',{method:'POST',body:{p_supplier_id:text(body.supplier_id,80)||null,p_lines:cleanLines(body.lines),p_warehouse_id:text(body.warehouse_id,80)||null,p_order_date:text(body.order_date,40)||null,p_expected_at:text(body.expected_at,80)||null,p_currency:text(body.currency,10).toUpperCase()||'USD',p_supplier_reference:text(body.supplier_reference,250)||null,p_notes:text(body.notes,2000)||null,p_actor:admin.admin_id||null}});
      const order=rpcRow(result);if(!order?.id)throw new Error('No se pudo crear la Purchase Order');
      await writeAudit(admin,'purchase_order_created','purchase_order',order.id,{po_number:order.po_number,supplier_id:order.supplier_id});
      return ok(res,{order:(await listOrders(admin)).find(item=>item.id===order.id)||order});
    }
    if(action==='replace_plan'){
      const orderId=text(body.purchase_order_id,80);if(!orderId)throw new Error('Falta la Purchase Order');
      const result=await supabase('rpc/replace_purchase_order_plan',{method:'POST',body:{p_purchase_order_id:orderId,p_supplier_id:text(body.supplier_id,80)||null,p_lines:cleanLines(body.lines),p_warehouse_id:text(body.warehouse_id,80)||null,p_order_date:text(body.order_date,40)||null,p_expected_at:text(body.expected_at,80)||null,p_currency:text(body.currency,10).toUpperCase()||'USD',p_supplier_reference:text(body.supplier_reference,250)||null,p_notes:text(body.notes,2000)||null}});
      const order=rpcRow(result);await writeAudit(admin,'purchase_order_updated','purchase_order',orderId,{po_number:order?.po_number||null});
      return ok(res,{order:(await listOrders(admin)).find(item=>item.id===orderId)||order});
    }
    if(['issue','confirm','cancel','close'].includes(action)){
      const orderId=text(body.purchase_order_id,80);if(!orderId)throw new Error('Falta la Purchase Order');
      const result=await supabase('rpc/transition_purchase_order',{method:'POST',body:{p_purchase_order_id:orderId,p_action:action}}),order=rpcRow(result);
      await writeAudit(admin,`purchase_order_${action}`,'purchase_order',orderId,{po_number:order?.po_number||null});
      return ok(res,{order:(await listOrders(admin)).find(item=>item.id===orderId)||order});
    }
    if(action==='receive'){
      const result=await supabase('rpc/receive_purchase_order_lines',{method:'POST',body:{p_warehouse_id:text(body.warehouse_id,80)||null,p_lines:cleanReceiptLines(body.lines),p_received_at:text(body.received_at,80)||null,p_truck_reference:text(body.truck_reference,250)||null,p_driver_name:text(body.driver_name,250)||null,p_reference_number:text(body.reference_number,500)||null,p_notes:text(body.notes,2000)||null,p_allow_over_receipt:Boolean(body.allow_over_receipt),p_actor:admin.admin_id||null}}),receipt=rpcRow(result);
      if(!receipt?.id)throw new Error('No se pudo registrar la recepción');
      await writeAudit(admin,'purchase_order_received','warehouse_receipt',receipt.id,{receipt_number:receipt.receipt_number,reference_number:receipt.reference_number});
      return ok(res,{receipt,orders:await listOrders(admin)});
    }
    return fail(res,400,'Acción de Compras no válida');
  }catch(error){const raw=String(error.message||'No se pudo procesar Compras'),failure=translatedError(raw);console.error('[purchases]',error);return fail(res,failure.status,failure.message,{code:failure.code});}
}
