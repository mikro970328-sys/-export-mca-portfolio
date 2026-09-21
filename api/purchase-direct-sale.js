import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text=(value,max=2000)=>String(value??'').trim().slice(0,max);
const uuid=(value,label='ID')=>{const result=text(value,80);if(!UUID_RE.test(result))throw new Error(`${label}_INVALID`);return result;};
const rpcRow=value=>Array.isArray(value)?(value[0]||null):(value||null);

function cleanLineTotals(lines){
  if(!Array.isArray(lines)||!lines.length)throw new Error('DIRECT_SALE_PRICES_INCOMPLETE');
  return lines.map(line=>{
    const purchaseOrderItemId=uuid(line?.purchase_order_item_id,'PURCHASE_ORDER_ITEM_ID');
    const raw=text(line?.line_total,80),lineTotal=Number(raw);
    if(raw===''||!Number.isFinite(lineTotal)||lineTotal<0)throw new Error('SO_LINE_TOTAL_INVALID');
    return {purchase_order_item_id:purchaseOrderItemId,line_total:String(lineTotal)};
  });
}

const errors={
  PURCHASE_ORDER_ID_INVALID:'Compra inválida.',PURCHASE_ORDER_ITEM_ID_INVALID:'Una línea de la compra es inválida.',CLIENT_ID_INVALID:'Selecciona el cliente.',IMPORTER_ID_INVALID:'Selecciona un importador válido.',
  DIRECT_SALE_PO_NOT_FOUND:'La compra ya no está disponible.',DIRECT_SALE_PO_NOT_CONFIRMED:'Confirma primero la compra para crear la venta.',
  DIRECT_SALE_PO_NOT_DIRECT:'Esta opción solo corresponde a compras Direct Ship.',DIRECT_SALE_PO_EMPTY:'La compra no contiene mercancía.',
  DIRECT_SALE_PO_ALREADY_LINKED:'Esta compra ya está relacionada con una venta activa.',DIRECT_SALE_PRICES_INVALID:'Los precios de venta no tienen un formato válido.',
  DIRECT_SALE_PRICES_INCOMPLETE:'Escribe el precio total de venta de cada producto.',SO_CLIENT_REQUIRED:'Selecciona el cliente.',
  SO_CLIENT_NOT_FOUND:'Cliente no encontrado.',SO_CLIENT_INACTIVE:'El cliente está inactivo.',SO_IMPORTER_NOT_FOUND:'Importador no encontrado.',
  SO_IMPORTER_INACTIVE:'El importador está inactivo.',SO_CLIENT_IMPORTER_MISMATCH:'Ese importador no está asociado al cliente seleccionado.',
  SO_CURRENCY_INVALID:'La moneda debe tener un código de tres letras, por ejemplo USD.',SO_NATIONALIZATION_STATUS_INVALID:'Selecciona si la mercancía está nacionalizada o no nacionalizada.',
  SO_PRODUCT_INACTIVE:'Uno de los productos está inactivo.',SO_LINE_TOTAL_INVALID:'Escribe un precio total de venta válido para cada producto.',
  SUPPLY_QUICK_DIRECT_NO_PURCHASE_BALANCE:'La compra ya no tiene mercancía disponible para vender.',SUPPLY_QUICK_DIRECT_NO_SALE_BALANCE:'La mercancía de la venta ya está asignada.'
};
function friendly(error){const raw=String(error?.message||error||'');const key=Object.keys(errors).find(code=>raw.includes(code));return key?errors[key]:'No se pudo crear la venta Direct Ship. Intenta nuevamente.';}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,'sales.write');if(!admin)return;
  try{
    if(req.method==='GET'){
      uuid(req.query?.purchase_order_id,'PURCHASE_ORDER_ID');
      const [clients,importers,clientImporters]=await Promise.all([
        supabase('clients',{query:'?select=id,name,company,mipyme_name,active&active=eq.true&order=name.asc&limit=1000'}),
        supabase('importers',{query:'?select=id,name,active&active=eq.true&order=name.asc&limit=1000'}),
        supabase('client_importers',{query:'?select=client_id,importer_id&limit=5000'})
      ]);
      return ok(res,{clients:clients||[],importers:importers||[],client_importers:clientImporters||[]});
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),purchaseOrderId=uuid(body.purchase_order_id,'PURCHASE_ORDER_ID');
    const result=await supabase('rpc/create_direct_sale_from_purchase_order',{method:'POST',body:{
      p_purchase_order_id:purchaseOrderId,
      p_client_id:uuid(body.client_id,'CLIENT_ID'),
      p_line_totals:cleanLineTotals(body.line_totals),
      p_importer_id:text(body.importer_id,80)?uuid(body.importer_id,'IMPORTER_ID'):null,
      p_currency:text(body.currency,10).toUpperCase()||null,
      p_customer_reference:text(body.customer_reference,250)||null,
      p_nationalization_status:text(body.nationalization_status,40)||'not_nationalized',
      p_actor:admin.admin_id||null
    }});
    const sale=rpcRow(result);
    if(!sale?.sales_order_id)throw new Error('DIRECT_SALE_CREATE_FAILED');
    await writeAudit(admin,'direct_sale_created_from_purchase','sales_order',sale.sales_order_id,{purchase_order_id:purchaseOrderId,so_number:sale.so_number,linked_lines:sale.linked_lines});
    return ok(res,{sale});
  }catch(error){
    const message=friendly(error);
    if(message.startsWith('No se pudo'))console.error('[purchase-direct-sale]',error);
    return fail(res,message.startsWith('No se pudo')?500:400,message);
  }
}
