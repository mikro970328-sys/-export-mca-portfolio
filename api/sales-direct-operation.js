import {authorizeAdmin,fail,loadAdminAccessContext,ok,readJson,supabase} from './_lib.js';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value,max=250)=>String(value??'').trim().slice(0,max);
const messages={
  DIRECT_OPERATION_PERMISSION:'Necesitas permisos de Ventas y Compras para registrar esta operación.',
  DIRECT_OPERATION_LOGISTICS_PERMISSION:'Necesitas permiso de Logística para registrar el contenedor.',
  DIRECT_OPERATION_FINANCE_PERMISSION:'Necesitas permiso de Finanzas para registrar la factura del proveedor.',
  DIRECT_OPERATION_SALE_INVALID:'La venta ya no está disponible para Direct Ship.',
  DIRECT_OPERATION_SUPPLIER_REQUIRED:'Selecciona el proveedor de la mercancía.',
  DIRECT_OPERATION_PRICES_REQUIRED:'Indica el costo total de cada producto pendiente de comprar.',
  DIRECT_OPERATION_ALREADY_PURCHASED:'La mercancía ya tiene una compra vinculada. Actualiza la pantalla para continuar.',
  DIRECT_OPERATION_PO_INVALID:'La compra debe estar confirmada y tener destino Direct Ship.',
  DIRECT_OPERATION_UNITS_MISMATCH:'La compra debe usar la misma unidad de la venta.',
  DIRECT_OPERATION_PURCHASE_BALANCE:'La compra no tiene suficiente mercancía pendiente para esta venta.',
  DIRECT_OPERATION_CONTAINER_INVALID:'Indica un número de contenedor válido.',
  DIRECT_OPERATION_CONTAINER_CONFLICT:'Ese contenedor pertenece a otra operación. Revisa su número.',
  DIRECT_OPERATION_RETRY_CONFLICT:'Esta solicitud ya fue guardada con otros datos. Actualiza la operación.',
  DIRECT_OPERATION_BILL_CONFLICT:'La compra ya tiene una factura de proveedor. Revísala en Cuentas por pagar.'
};
function clean(body){
  if(!uuid.test(body.sales_order_id||'')||!uuid.test(body.request_id||''))throw Error('La venta o solicitud no es válida.');
  if(body.purchase_order_id&&!uuid.test(body.purchase_order_id))throw Error('Selecciona una compra válida.');
  if(!body.purchase_order_id&&!uuid.test(body.supplier_id||''))throw Error(messages.DIRECT_OPERATION_SUPPLIER_REQUIRED);
  const lines=Array.isArray(body.lines)?body.lines:[];
  if(lines.length>100)throw Error('La operación admite hasta 100 productos.');
  const ids=new Set();
  for(const line of lines){
    if(!uuid.test(line?.sales_order_item_id||'')||ids.has(line.sales_order_item_id))throw Error('Revisa los productos de esta venta.');
    ids.add(line.sales_order_item_id);
    if(!/^\d+(?:\.\d{1,2})?$/.test(String(line.total??''))||!Number.isFinite(Number(line.total)))throw Error(messages.DIRECT_OPERATION_PRICES_REQUIRED);
  }
  return {sales_order_id:body.sales_order_id,purchase_order_id:body.purchase_order_id||null,supplier_id:body.supplier_id||null,
    supplier_reference:text(body.supplier_reference),lines:lines.map(line=>({sales_order_item_id:line.sales_order_item_id,total:String(line.total)})),
    container_number:text(body.container_number,40).toUpperCase(),carrier:text(body.carrier),booking_number:text(body.booking_number),bol_number:text(body.bol_number),
    departure_date:text(body.departure_date,10)||null,supplier_invoice_number:text(body.supplier_invoice_number,200)};
}
export default async function handler(req,res){
  const actor=await authorizeAdmin(req,res,req.method==='GET'?'sales.read':'sales.write');if(!actor)return;
  try{
    if(req.method==='GET'){
      const access=actor.role==='master_admin'?null:await loadAdminAccessContext(actor.admin_id);
      const can=key=>actor.role==='master_admin'||access?.permissions?.includes(key)===true;
      const suppliers=can('procurement.read')?await supabase('suppliers',{query:'?select=id,name,legal_name&active=eq.true&order=name.asc&limit=1000'}):[];
      return ok(res,{suppliers,write_access:can('sales.write')&&can('procurement.write'),logistics_write:can('logistics.write'),finance_write:can('finance.write')});
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),payload=clean(body);
    const value=await supabase('rpc/save_sales_direct_operation',{method:'POST',body:{p_payload:payload,p_actor:actor.admin_id,p_request_id:body.request_id}});
    return ok(res,{operation:Array.isArray(value)?value[0]:value});
  }catch(error){
    const raw=String(error.message||''),key=Object.keys(messages).find(code=>raw.includes(code));
    if(key)return fail(res,key.includes('PERMISSION')?403:400,messages[key],{code:key});
    if(/^(Selecciona|Indica|La venta o solicitud|La operación admite|Revisa los productos)/.test(raw))return fail(res,400,raw);
    console.error('[sales-direct-operation]',error);
    return fail(res,500,'No se pudo guardar la operación. Tus cambios no se han contabilizado; intenta nuevamente.');
  }
}
