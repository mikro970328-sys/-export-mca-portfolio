import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const uuid=(value,label='ID')=>{const result=String(value||'').trim();if(!UUID_RE.test(result))throw new Error(`${label}_INVALID`);return result;};
const note=value=>String(value??'').trim().slice(0,2000)||null;
const rpcRow=value=>Array.isArray(value)?value[0]||null:value||null;

function dispatchTime(value){
  const raw=String(value??'').trim();
  if(!raw)return null;
  const parsed=new Date(raw);
  if(Number.isNaN(parsed.getTime()))throw new Error('DIRECT_DISPATCH_TIME_INVALID');
  return parsed.toISOString();
}

function friendly(error){
  const raw=String(error?.message||error||'');
  const map=[
    ['SALES_ORDER_ID_INVALID','Venta inválida.'],
    ['SHIPMENT_ID_INVALID','Contenedor inválido.'],
    ['DIRECT_DISPATCH_TIME_INVALID','La fecha y hora de despacho no son válidas.'],
    ['DIRECT_SHIPMENT_NOT_FOUND','Contenedor no encontrado.'],
    ['DIRECT_SHIPMENT_ALREADY_DISPATCHED','Este Direct Ship ya fue marcado como despachado.'],
    ['DIRECT_SHIPMENT_HAS_LOAD','Ese contenedor pertenece a un Cargue y no puede despacharse como Direct Ship.'],
    ['DIRECT_SHIPMENT_HAS_NO_ALLOCATIONS','El contenedor todavía no tiene mercancía Direct Ship vinculada.'],
    ['DIRECT_SHIPMENT_SALE_NOT_CONFIRMED','La venta vinculada debe estar confirmada.'],
    ['DIRECT_SHIPMENT_PO_NOT_CONFIRMED','La orden de compra vinculada debe estar confirmada antes del despacho.']
  ];
  return map.find(([key])=>raw.includes(key))?.[1]||'No se pudo actualizar el despacho Direct Ship.';
}

async function listForSale(salesOrderId){
  return await supabase('shipment_direct_supply_contents',{
    query:`?select=*&sales_order_id=eq.${encodeURIComponent(salesOrderId)}&order=container_number.asc,product_name.asc&limit=5000`
  })||[];
}

export default async function handler(req,res){
  const admin=requireAdmin(req,res);if(!admin)return;
  try{
    if(req.method==='GET'){
      const salesOrderId=uuid(req.query?.sales_order_id,'SALES_ORDER_ID');
      return ok(res,{rows:await listForSale(salesOrderId)});
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),action=String(body.action||'').trim().toLowerCase();
    if(action!=='dispatch')return fail(res,400,'Acción Direct Ship no válida.');
    const shipmentId=uuid(body.shipment_id,'SHIPMENT_ID');
    const result=rpcRow(await supabase('rpc/mark_direct_shipment_dispatched',{
      method:'POST',
      body:{
        p_shipment_id:shipmentId,
        p_dispatched_at:dispatchTime(body.dispatched_at),
        p_actor:admin.admin_id||null,
        p_notes:note(body.notes)
      }
    }));
    if(!result?.shipment_id)throw new Error('DIRECT_SHIPMENT_DISPATCH_FAILED');
    await writeAudit(admin,'direct_shipment_dispatched','shipment',shipmentId,{dispatched_at:result.dispatched_at});
    return ok(res,{dispatch:result});
  }catch(error){
    console.error('[direct-shipment-dispatch]',error);
    return fail(res,400,friendly(error));
  }
}
