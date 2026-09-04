import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { loadLoadActionCapabilityMap, loadLoadActionCapabilities } from './_load-actions.js';
import { assertLoadPlanAvailability } from './_load-plan-availability.js';

const text=value=>String(value??'').trim()||null;
const number=value=>{
  const n=Number(value??0);
  if(!Number.isFinite(n)||n<0)throw new Error('LOAD_QUANTITY_INVALID');
  return n;
};
const containerReference=value=>{
  const cleaned=String(value??'').trim().toUpperCase().replace(/\s+/g,' ');
  if(!cleaned||cleaned.length>40||!/^[A-Z0-9][A-Z0-9 ._/-]*$/.test(cleaned))throw new Error('CONTAINER_REFERENCE_INVALID');
  return cleaned;
};
const rpcRow=value=>Array.isArray(value)?(value[0]||null):(value||null);

async function shipmentHistory(shipment,eventType,title,details=null,source='admin'){
  try{
    await supabase('shipment_history',{method:'POST',body:[{shipment_id:shipment.id,client_id:shipment.client_id||null,event_type:eventType,title,details,source}]});
  }catch(error){
    console.error('LOAD_SHIPMENT_HISTORY_FAILED',error.message);
  }
}

const LOAD_SELECT='id,load_number,warehouse_id,client_id,importer_id,shipment_id,status,scheduled_at,loading_started_at,loaded_at,dispatched_at,cancelled_at,notes,created_at,updated_at,warehouse:warehouses(id,code,name),client:clients(id,name,company,mipyme_name),importer:importers(id,name),shipment:shipments(id,container_number,client_id,importer_id,operation_id,booking_number,bol_number,carrier,product,quantity,quantity_unit,departure_date,operational_status,last_status,last_location,last_event_at)';

async function getLoad(id,capabilities=null){
  const rows=await supabase('loads',{query:`?select=${LOAD_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`});
  const load=rows?.[0]||null;
  if(!load)return null;
  const [items,traceability]=await Promise.all([
    supabase('load_items',{query:`?select=id,load_id,product_id,planned_quantity,planned_pallets,unit,notes,product:products(id,sku,name,brand,category,unit,package_format),allocations:load_allocations(id,receipt_item_id,allocated_quantity,allocated_pallets,receipt_item:warehouse_receipt_items(id,receipt_id,product_id,lot_number,units_per_pallet,receipt:warehouse_receipts(id,receipt_number,status,received_at)))&load_id=eq.${encodeURIComponent(id)}&order=created_at.asc`}),
    supabase('load_traceability_sources',{query:`?select=*&load_id=eq.${encodeURIComponent(id)}&order=product_name.asc,receipt_number.asc`})
  ]);
  return {...load,capabilities:capabilities||{actions:{}},items:items||[],traceability:traceability||[]};
}

async function getLoadForAdmin(id,admin){
  const capabilities=await loadLoadActionCapabilities(admin,id);
  return getLoad(id,capabilities);
}

async function listLoads(capabilityMap=new Map()){
  const rows=await supabase('loads',{query:`?select=${LOAD_SELECT}&order=created_at.desc&limit=1000`})||[];
  return rows.map(load=>({...load,capabilities:capabilityMap.get(String(load.id))||{actions:{}}}));
}

async function bootstrap(admin){
  const capabilityBundle=await loadLoadActionCapabilityMap(admin);
  const [loads,warehouses,sources,clients,importers,shipments]=await Promise.all([
    listLoads(capabilityBundle.map),
    supabase('warehouses',{query:'?select=id,code,name,city,country,active&active=eq.true&order=name.asc'}),
    supabase('inventory_source_balances',{query:'?select=receipt_item_id,receipt_id,receipt_number,received_at,warehouse_id,warehouse_code,warehouse_name,product_id,product_sku,product_name,product_brand,product_unit,receipt_unit,units_per_pallet,lot_number,physical_quantity,physical_pallets,reserved_quantity,reserved_pallets&warehouse_active=eq.true&order=received_at.asc&limit=5000'}),
    supabase('clients',{query:'?select=id,name,company,active&active=eq.true&order=name.asc&limit=1000'}),
    supabase('importers',{query:'?select=id,name,active&active=eq.true&order=name.asc&limit=1000'}),
    supabase('shipments',{query:'?select=id,container_number,client_id,importer_id,operation_id,booking_number,bol_number,carrier,product,quantity,quantity_unit,active,operational_status,last_status&active=eq.true&order=created_at.desc&limit=1000'})
  ]);

  const availableSources=(sources||[]).map(source=>({
    ...source,
    available_quantity:Number(source.physical_quantity||0)-Number(source.reserved_quantity||0),
    available_pallets:Number(source.physical_pallets||0)-Number(source.reserved_pallets||0)
  })).filter(source=>source.available_quantity>0||source.available_pallets>0);

  const stats={
    total:loads.length,
    draft:loads.filter(x=>x.status==='draft').length,
    reserved:loads.filter(x=>x.status==='reserved').length,
    loading:loads.filter(x=>x.status==='loading').length,
    loaded:loads.filter(x=>x.status==='loaded').length,
    dispatched:loads.filter(x=>x.status==='dispatched').length,
    cancelled:loads.filter(x=>x.status==='cancelled').length
  };

  return {loads,warehouses:warehouses||[],sources:availableSources,clients:clients||[],importers:importers||[],shipments:shipments||[],stats,write_access:capabilityBundle.write_access};
}

function normalizeLines(lines){
  if(!Array.isArray(lines)||!lines.length)throw new Error('LOAD_HAS_NO_ITEMS');
  return lines.map(line=>({
    product_id:text(line.product_id),
    planned_quantity:number(line.planned_quantity),
    planned_pallets:number(line.planned_pallets),
    unit:text(line.unit)||'unit',
    notes:text(line.notes),
    allocations:(Array.isArray(line.allocations)?line.allocations:[]).map(a=>({
      receipt_item_id:text(a.receipt_item_id),
      allocated_quantity:number(a.allocated_quantity),
      allocated_pallets:number(a.allocated_pallets)
    }))
  }));
}

async function runLifecycle(action,loadId,admin){
  const lifecycleActions=new Set(['reserve','release','start_loading','mark_loaded','dispatch','cancel','unassign_container']);
  if(!lifecycleActions.has(action))return null;
  await supabase('rpc/execute_load_action',{method:'POST',body:{p_load_id:loadId,p_action:action,p_actor:admin.admin_id||null}});
  await writeAudit(admin,`load_${action}`,'load',loadId,{});
  return getLoadForAdmin(loadId,admin);
}

function translatedError(raw){
  const translations=[
    ['JSON_INVALID','La solicitud no tiene un formato válido.'],
    ['PERMISSION_REQUIRED','No tienes permiso para ejecutar esta acción.'],
    ['LOAD_ACTION_INVALID','La acción de Cargue no es válida.'],
    ['LOAD_ACTION_NOT_ALLOWED','El cargue no admite esta acción en su estado actual.'],
    ['LOAD_NOT_FOUND','Cargue no encontrado.'],
    ['LOAD_QUANTITY_INVALID','La cantidad o los pallets seleccionados no son válidos.'],
    ['LOAD_QUANTITY_PALLET_MISMATCH','La cantidad debe coincidir con los pallets multiplicados por las unidades por pallet del WR.'],
    ['CONTAINER_REFERENCE_INVALID','La referencia del contenedor no es válida. Usa letras/números y, si necesitas, espacios, guion, punto, slash o underscore.'],
    ['LOAD_SHIPMENT_CLIENT_MISMATCH','El cliente del contenedor no coincide con el cliente de la venta vinculada al cargue.'],
    ['LOAD_SHIPMENT_IMPORTER_MISMATCH','La importadora del contenedor no coincide con la importadora de la venta vinculada al cargue.'],
    ['LOAD_ALREADY_HAS_CONTAINER','Este cargue ya tiene un contenedor asignado.'],
    ['LOAD_SHIPMENT_LOCKED_BY_STATUS','El contenedor ya no puede cambiarse en el estado actual del cargue.'],
    ['LOAD_HAS_NO_CONTAINER','Asigna un contenedor antes de despachar la mercancía.'],
    ['SHIPMENT_NOT_ELIGIBLE_FOR_LOAD','El contenedor ya no es elegible para este cargue.'],
    ['LOAD_NOT_DRAFT','Solo un cargue en borrador puede editarse.'],
    ['LOAD_NOT_RESERVED','El cargue debe estar reservado para ejecutar esta acción.'],
    ['LOAD_NOT_LOADING','El cargue debe estar en carga para marcarlo como cargado.'],
    ['LOAD_NOT_LOADED','El cargue debe estar cargado antes de despacharlo.'],
    ['LOAD_CANNOT_BE_CANCELLED','El cargue ya no puede cancelarse en su estado actual.'],
    ['LOAD_HAS_NO_ITEMS','Agrega mercancía al cargue.'],
    ['LOAD_ALLOCATIONS_REQUIRED','Selecciona al menos un WR para cada producto.'],
    ['LOAD_ALLOCATIONS_INCOMPLETE','Las cantidades seleccionadas por WR deben coincidir con el total del producto.'],
    ['RECEIPT_ITEM_NOT_FOUND','Uno de los WR seleccionados ya no existe.'],
    ['INSUFFICIENT_WR_AVAILABLE_BALANCE','Uno de los WR ya no tiene saldo suficiente disponible.'],
    ['INSUFFICIENT_WR_PHYSICAL_BALANCE','Uno de los WR ya no tiene inventario físico suficiente para el despacho.'],
    ['LOAD_RESERVATION_LEDGER_NOT_ZERO','El ledger del cargue contiene una reserva previa inconsistente.'],
    ['LOAD_RESERVATION_LEDGER_MISMATCH','La reserva del cargue no coincide con el ledger de inventario.'],
    ['WAREHOUSE_REQUIRED','Selecciona un almacén.']
  ];
  const matched=translations.find(([key])=>raw.includes(key));
  if(matched)return matched[1];
  if(raw.includes('duplicate key')||raw.includes('23505'))return 'Esa referencia de contenedor ya tiene una operación activa.';
  return null;
}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,req.method==='GET'?'logistics.read':'logistics.write');
  if(!admin)return;

  try{
    if(req.method==='GET'){
      const id=text(req.query?.id);
      if(id){
        const load=await getLoadForAdmin(id,admin);
        if(!load)return fail(res,404,'Cargue no encontrado');
        return ok(res,{load});
      }
      if(String(req.query?.bootstrap||'')==='1')return ok(res,await bootstrap(admin));
      const capabilityBundle=await loadLoadActionCapabilityMap(admin);
      return ok(res,{loads:await listLoads(capabilityBundle.map),write_access:capabilityBundle.write_access});
    }

    if(req.method!=='POST')return fail(res,405,'Método no permitido');
    const body=await readJson(req);
    const action=text(body.action);

    if(action==='create_plan'){
      const lines=normalizeLines(body.lines);
      await assertLoadPlanAvailability(lines);
      const result=await supabase('rpc/create_load_plan',{method:'POST',body:{p_warehouse_id:text(body.warehouse_id),p_lines:lines,p_scheduled_at:text(body.scheduled_at),p_notes:text(body.notes),p_actor:admin.admin_id||null}});
      const load=rpcRow(result);
      if(!load?.id)throw new Error('No se pudo crear el cargue');
      await writeAudit(admin,'load_created','load',load.id,{warehouse_id:body.warehouse_id,commercial_context:'generic'});
      return ok(res,{load:await getLoadForAdmin(load.id,admin)});
    }

    const loadId=text(body.load_id);
    if(!loadId)return fail(res,400,'Falta el cargue');

    if(action==='replace_plan'){
      const lines=normalizeLines(body.lines);
      await assertLoadPlanAvailability(lines);
      await supabase('rpc/replace_load_plan_canonical',{method:'POST',body:{p_load_id:loadId,p_lines:lines,p_scheduled_at:text(body.scheduled_at),p_notes:text(body.notes)}});
      await writeAudit(admin,'load_plan_updated','load',loadId,{});
      return ok(res,{load:await getLoadForAdmin(loadId,admin)});
    }

    const lifecycle=await runLifecycle(action,loadId,admin);
    if(lifecycle)return ok(res,{load:lifecycle});

    if(action==='create_container'){
      const reference=containerReference(body.container_number);
      const result=await supabase('rpc/create_load_shipment_canonical',{method:'POST',body:{p_load_id:loadId,p_container_number:reference,p_client_id:text(body.client_id),p_importer_id:text(body.importer_id),p_booking_number:text(body.booking_number),p_bol_number:text(body.bol_number),p_carrier:text(body.carrier),p_departure_date:text(body.departure_date)}});
      const shipment=rpcRow(result);
      if(!shipment?.id)throw new Error('No se pudo crear el contenedor desde el cargue');
      await shipmentHistory(shipment,'created_from_load','Contenedor creado desde Cargue',`Cargue: ${loadId}`);
      await writeAudit(admin,'shipment_created_from_load','shipment',shipment.id,{load_id:loadId,container_number:shipment.container_number,tracking_source:'erp'});
      return ok(res,{shipment,load:await getLoadForAdmin(loadId,admin)});
    }

    if(action==='assign_existing_container'){
      const shipmentId=text(body.shipment_id);
      if(!shipmentId)return fail(res,400,'Falta el contenedor');
      await supabase('rpc/assign_load_shipment_canonical',{method:'POST',body:{p_load_id:loadId,p_shipment_id:shipmentId}});
      await writeAudit(admin,'load_shipment_assigned','load',loadId,{shipment_id:shipmentId});
      return ok(res,{load:await getLoadForAdmin(loadId,admin)});
    }

    return fail(res,400,'Acción de Cargue no válida');
  }catch(error){
    const raw=String(error.message||'Error de Cargue');
    console.error('[loads]',error);
    const translated=translatedError(raw);
    if(translated)return fail(res,400,translated);
    return fail(res,500,'No se pudo procesar Cargues');
  }
}
