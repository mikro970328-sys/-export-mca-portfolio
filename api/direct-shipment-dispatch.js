import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { registerShipsGo } from './_shipsgo.js';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_CONTAINER_RE=/^[A-Z]{4}\d{7}$/;
const uuid=(value,label='ID')=>{const result=String(value||'').trim();if(!UUID_RE.test(result))throw new Error(`${label}_INVALID`);return result;};
const note=value=>String(value??'').trim().slice(0,2000)||null;
const text=(value,max=250)=>String(value??'').trim().slice(0,max)||null;
const rpcRow=value=>Array.isArray(value)?value[0]||null:value||null;
const containerReference=value=>{const result=String(value??'').trim().toUpperCase().replace(/\s+/g,' ');if(!result||result.length>40||!/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(result))throw new Error('CONTAINER_REFERENCE_INVALID');return result;};

function dispatchTime(value){
  const raw=String(value??'').trim();
  if(!raw)return null;
  const parsed=new Date(raw);
  if(Number.isNaN(parsed.getTime()))throw new Error('DIRECT_DISPATCH_TIME_INVALID');
  return parsed.toISOString();
}

function departureDate(value){
  const raw=String(value??'').trim();
  if(!raw)return null;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(raw))throw new Error('DIRECT_DEPARTURE_DATE_INVALID');
  return raw;
}

function friendly(error){
  const raw=String(error?.message||error||'');
  const map=[
    ['SALES_ORDER_ID_INVALID','Venta inválida.'],
    ['SHIPMENT_ID_INVALID','Contenedor inválido.'],
    ['CONTAINER_REFERENCE_INVALID','La referencia del contenedor no es válida.'],
    ['DIRECT_DEPARTURE_DATE_INVALID','La fecha de salida no es válida.'],
    ['DIRECT_DISPATCH_TIME_INVALID','La fecha y hora de despacho no son válidas.'],
    ['DIRECT_SALE_NOT_FOUND','Venta no encontrada.'],
    ['DIRECT_SALE_NOT_CONFIRMED','La venta debe estar confirmada antes de crear un Direct Ship.'],
    ['DIRECT_CONTAINER_DUPLICATE','Esa referencia de contenedor ya tiene una operación activa.'],
    ['DIRECT_SHIPMENT_NOT_FOUND','Contenedor no encontrado.'],
    ['DIRECT_SHIPMENT_ALREADY_DISPATCHED','Este Direct Ship ya fue marcado como despachado.'],
    ['DIRECT_SHIPMENT_HAS_LOAD','Ese contenedor pertenece a un Cargue y no puede despacharse como Direct Ship.'],
    ['DIRECT_SHIPMENT_HAS_NO_ALLOCATIONS','El contenedor todavía no tiene mercancía Direct Ship vinculada.'],
    ['DIRECT_SHIPMENT_SALE_NOT_CONFIRMED','La venta vinculada debe estar confirmada.'],
    ['DIRECT_SHIPMENT_PO_NOT_CONFIRMED','La orden de compra vinculada debe estar confirmada antes del despacho.']
  ];
  return map.find(([key])=>raw.includes(key))?.[1]||'No se pudo actualizar el Direct Ship.';
}

async function history(shipment,eventType,title,details=null){
  try{
    await supabase('shipment_history',{method:'POST',body:[{shipment_id:shipment.id,client_id:shipment.client_id||null,event_type:eventType,title,details,source:'sales_supply'}]});
  }catch(error){console.error('[direct-shipment-history]',error.message);}
}

async function activateTracking(shipment,admin){
  if(!ISO_CONTAINER_RE.test(shipment.container_number)){
    await supabase('shipments',{method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{shipsgo_status:'manual',shipsgo_error:null,updated_at:new Date().toISOString()}});
    await history(shipment,'tracking_manual_reference','Referencia provisional de contenedor','Tracking automático pendiente de número ISO real.');
    return {...shipment,shipsgo_status:'manual',shipsgo_error:null};
  }
  try{
    const tracking=await registerShipsGo(shipment.container_number,shipment.shipsgo_tracking_id||null);
    const trackingId=tracking.id||shipment.shipsgo_tracking_id||null;
    await supabase('shipments',{method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{shipsgo_status:'active',shipsgo_tracking_id:trackingId,shipsgo_link_mode:tracking.mode,shipsgo_error:null,updated_at:new Date().toISOString()}});
    await history(shipment,tracking.mode==='created'?'shipsgo_created':'shipsgo_linked',tracking.mode==='created'?'Tracking creado en ShipsGo':'Tracking existente vinculado en ShipsGo',trackingId||shipment.container_number);
    await writeAudit(admin,'shipsgo_tracking_ready','shipment',shipment.id,{tracking_id:trackingId,mode:tracking.mode,source:'direct_ship'});
    return {...shipment,shipsgo_status:'active',shipsgo_tracking_id:trackingId,shipsgo_link_mode:tracking.mode,shipsgo_error:null};
  }catch(error){
    await supabase('shipments',{method:'PATCH',query:`?id=eq.${encodeURIComponent(shipment.id)}`,body:{shipsgo_status:'failed',shipsgo_error:error.message,updated_at:new Date().toISOString()}});
    await history(shipment,'shipsgo_failed','No se pudo activar el tracking en ShipsGo',error.message);
    await writeAudit(admin,'shipsgo_tracking_failed','shipment',shipment.id,{error:error.message,source:'direct_ship'});
    return {...shipment,shipsgo_status:'failed',shipsgo_error:error.message};
  }
}

async function createDirectShipment(body,admin){
  const salesOrderId=uuid(body.sales_order_id,'SALES_ORDER_ID');
  const orders=await supabase('sales_orders',{query:`?select=id,so_number,status,client_id,importer_id&id=eq.${encodeURIComponent(salesOrderId)}&limit=1`})||[];
  const order=orders[0];
  if(!order)throw new Error('DIRECT_SALE_NOT_FOUND');
  if(order.status!=='confirmed')throw new Error('DIRECT_SALE_NOT_CONFIRMED');
  const containerNumber=containerReference(body.container_number);
  const duplicate=await supabase('shipments',{query:`?select=id&container_number=eq.${encodeURIComponent(containerNumber)}&active=eq.true&limit=1`})||[];
  if(duplicate.length)throw new Error('DIRECT_CONTAINER_DUPLICATE');
  const rows=await supabase('shipments',{
    method:'POST',
    body:[{
      client_id:order.client_id,
      importer_id:order.importer_id||null,
      container_number:containerNumber,
      booking_number:text(body.booking_number),
      bol_number:text(body.bol_number),
      carrier:text(body.carrier),
      departure_date:departureDate(body.departure_date),
      product:null,
      quantity:null,
      quantity_unit:null,
      active:true,
      last_status:'Registrado',
      operational_status:'Registrado',
      last_location:null,
      last_event_at:null,
      shipsgo_status:ISO_CONTAINER_RE.test(containerNumber)?'pending':'manual'
    }],
    prefer:'return=representation'
  })||[];
  let shipment=rows[0];
  if(!shipment)throw new Error('DIRECT_SHIPMENT_CREATE_FAILED');
  await history(shipment,'created_direct_from_sale','Contenedor Direct Ship registrado',`${order.so_number} · ${containerNumber}`);
  await writeAudit(admin,'direct_shipment_created_from_sale','shipment',shipment.id,{sales_order_id:salesOrderId,so_number:order.so_number,container_number:containerNumber,provisional:!ISO_CONTAINER_RE.test(containerNumber)});
  shipment=await activateTracking(shipment,admin);
  return shipment;
}

async function listForSale(salesOrderId){
  return await supabase('shipment_direct_supply_contents',{
    query:`?select=*&sales_order_id=eq.${encodeURIComponent(salesOrderId)}&order=container_number.asc,product_name.asc&limit=5000`
  })||[];
}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,req.method==='GET'?'sales.read':'sales.write');if(!admin)return;
  try{
    if(req.method==='GET'){
      const salesOrderId=uuid(req.query?.sales_order_id,'SALES_ORDER_ID');
      return ok(res,{rows:await listForSale(salesOrderId)});
    }
    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req),action=String(body.action||'').trim().toLowerCase();
    if(action==='create')return ok(res,{shipment:await createDirectShipment(body,admin)});
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
