import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { loadSalesActionCapabilityMap, loadSalesWriteAccess } from './_sales-actions.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);

const SO_SELECT = 'id,so_number,client_id,importer_id,order_date,requested_at,currency,customer_reference,status,notes,created_by,created_at,updated_at,client:clients(id,name,company,mipyme_name,active),importer:importers(id,name,active)';

async function listOrders(admin, writableOverride = null) {
  const [orders, progress, items, itemProgress, allocations, capabilityMap] = await Promise.all([
    supabase('sales_orders', { query:`?select=${SO_SELECT}&order=created_at.desc&limit=1000` }),
    supabase('sales_order_progress', { query:'?select=*&order=so_number.desc&limit=1000' }),
    supabase('sales_order_items', { query:'?select=id,sales_order_id,product_id,ordered_quantity,ordered_pallets,unit,units_per_pallet,unit_price,notes,created_at,updated_at,product:products(id,sku,name,brand,category,unit,package_format,default_units_per_pallet)&order=created_at.asc&limit=5000' }),
    supabase('sales_order_item_progress', { query:'?select=*&limit=5000' }),
    supabase('sales_fulfillment_allocations', { query:'?select=id,sales_order_item_id,load_item_id,allocated_quantity,allocated_pallets,created_at,load_item:load_items(id,load_id,product_id,planned_quantity,planned_pallets,unit,load:loads(id,load_number,status,shipment_id,client_id,importer_id))&order=created_at.asc&limit=5000' }),
    loadSalesActionCapabilityMap(admin, writableOverride)
  ]);

  const progressByOrder = new Map((progress || []).map(row => [row.sales_order_id, row]));
  const itemProgressById = new Map((itemProgress || []).map(row => [row.sales_order_item_id, row]));
  const allocationsByItem = new Map();
  for (const allocation of allocations || []) {
    if (!allocationsByItem.has(allocation.sales_order_item_id)) allocationsByItem.set(allocation.sales_order_item_id, []);
    allocationsByItem.get(allocation.sales_order_item_id).push(allocation);
  }
  const itemsByOrder = new Map();
  for (const item of items || []) {
    const normalized = {
      ...item,
      progress:itemProgressById.get(item.id) || null,
      allocations:allocationsByItem.get(item.id) || []
    };
    if (!itemsByOrder.has(item.sales_order_id)) itemsByOrder.set(item.sales_order_id, []);
    itemsByOrder.get(item.sales_order_id).push(normalized);
  }

  return (orders || []).map(order => ({
    ...order,
    progress:progressByOrder.get(order.id) || null,
    capabilities:capabilityMap.get(String(order.id)) || { actions:{}, write_access:false },
    items:itemsByOrder.get(order.id) || []
  }));
}

async function bootstrap(admin) {
  const writeAccess = await loadSalesWriteAccess(admin);
  const [orders, clients, importers, clientImporters, products] = await Promise.all([
    listOrders(admin, writeAccess),
    supabase('clients', { query:'?select=id,name,company,mipyme_name,active&active=eq.true&order=name.asc&limit=1000' }),
    supabase('importers', { query:'?select=id,name,active&active=eq.true&order=name.asc&limit=1000' }),
    supabase('client_importers', { query:'?select=client_id,importer_id&limit=5000' }),
    supabase('products', { query:'?select=id,sku,name,brand,category,unit,package_format,default_units_per_pallet,active&active=eq.true&order=name.asc&limit=2000' })
  ]);
  return { orders, clients:clients || [], importers:importers || [], client_importers:clientImporters || [], products:products || [], write_access:writeAccess };
}

function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Agrega al menos una línea a la Sales Order');
  return lines.map((line, index) => {
    const productId = text(line.product_id, 80);
    if (!productId) throw new Error(`Selecciona el producto de la línea ${index + 1}`);
    return {
      product_id:productId,
      ordered_quantity:text(line.ordered_quantity, 80),
      ordered_pallets:text(line.ordered_pallets, 80),
      units_per_pallet:text(line.units_per_pallet, 80),
      unit_price:text(line.unit_price, 80),
      notes:text(line.notes, 1000)
    };
  });
}

function translatedError(raw) {
  const translations = [
    ['SO_CLIENT_REQUIRED','Selecciona un cliente.'],
    ['SO_CLIENT_NOT_FOUND','Cliente no encontrado.'],
    ['SO_CLIENT_INACTIVE','El cliente está inactivo.'],
    ['SO_IMPORTER_NOT_FOUND','Importador no encontrado.'],
    ['SO_IMPORTER_INACTIVE','El importador está inactivo.'],
    ['SO_CLIENT_IMPORTER_MISMATCH','Ese importador no está asociado al cliente seleccionado.'],
    ['SO_CURRENCY_INVALID','La moneda debe tener un código de 3 letras.'],
    ['SO_HAS_NO_ITEMS','Agrega al menos una línea a la Sales Order.'],
    ['SO_PRODUCT_NOT_FOUND','Uno de los productos no existe.'],
    ['SO_PRODUCT_INACTIVE','Uno de los productos está inactivo.'],
    ['SO_QUANTITY_INVALID','La cantidad de la venta es inválida.'],
    ['SO_QUANTITY_REQUIRED','Indica una cantidad mayor que cero.'],
    ['SO_UNITS_PER_PALLET_INVALID','Las unidades por pallet son inválidas.'],
    ['SO_UNIT_PRICE_INVALID','El precio unitario es inválido.'],
    ['SO_NOT_DRAFT','Solo una Sales Order en borrador puede editarse o confirmarse.'],
    ['SO_ITEMS_LOCKED','Las líneas ya no pueden modificarse en el estado actual.'],
    ['SO_HAS_ACTIVE_CUSTOMER_ADVANCE','No se puede cancelar una Sales Order con un anticipo de cliente activo.'],
    ['SO_HAS_ACTIVE_LOAD_ALLOCATIONS','No se puede cancelar una Sales Order vinculada a un Cargue activo.'],
    ['SO_HAS_ACTIVE_SUPPLY_PLAN','No se puede cancelar una Sales Order con planificación de abastecimiento activa.'],
    ['SO_HAS_DIRECT_SHIPMENT_ALLOCATIONS','No se puede cancelar una Sales Order con asignaciones Direct Ship.'],
    ['SO_NO_UNALLOCATED_FULFILLMENT','La Sales Order ya no tiene mercancía pendiente para asignar a Cargues.'],
    ['SO_NOT_FULLY_DISPATCHED','La Sales Order solo puede cerrarse cuando toda la mercancía esté despachada.'],
    ['SO_CANNOT_CANCEL','La Sales Order no puede cancelarse en su estado actual.'],
    ['SO_CANNOT_CLOSE','La Sales Order no puede cerrarse en su estado actual.'],
    ['SO_STATUS_FINAL','La Sales Order ya está finalizada.'],
    ['SO_ACTION_INVALID','Acción de Sales Order inválida.'],
    ['PERMISSION_REQUIRED','No tienes permiso para ejecutar esta acción.']
  ];
  const translated = translations.find(([key]) => raw.includes(key))?.[1] || null;
  if (translated) return translated;
  if (/^(?:Agrega al menos una línea|Selecciona el producto de la línea \d+|Falta la Sales Order)$/.test(raw)) return raw;
  return null;
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, req.method === 'GET' ? 'sales.read' : 'sales.write');
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const data = await bootstrap(admin);
      const id = text(req.query?.id, 80);
      if (!id) return ok(res, data);
      const order = data.orders.find(item => String(item.id) === id);
      if (!order) return fail(res, 404, 'Sales Order no encontrada');
      return ok(res, { order, clients:data.clients, importers:data.importers, client_importers:data.client_importers, products:data.products, write_access:data.write_access });
    }

    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const body = await readJson(req);
    const action = text(body.action, 60).toLowerCase();

    if (action === 'create_plan') {
      const result = await supabase('rpc/create_sales_order_plan', { method:'POST', body:{
        p_client_id:text(body.client_id,80) || null,
        p_lines:cleanLines(body.lines),
        p_importer_id:text(body.importer_id,80) || null,
        p_order_date:text(body.order_date,40) || null,
        p_requested_at:text(body.requested_at,80) || null,
        p_currency:text(body.currency,10).toUpperCase() || 'USD',
        p_customer_reference:text(body.customer_reference,250) || null,
        p_notes:text(body.notes,2000) || null,
        p_actor:admin.admin_id || null
      }});
      const order = rpcRow(result);
      if (!order?.id) throw new Error('No se pudo crear la Sales Order');
      await writeAudit(admin,'sales_order_created','sales_order',order.id,{ so_number:order.so_number, client_id:order.client_id });
      return ok(res,{ order:(await listOrders(admin, true)).find(item => item.id === order.id) || order });
    }

    if (action === 'replace_plan') {
      const orderId = text(body.sales_order_id,80);
      if (!orderId) throw new Error('Falta la Sales Order');
      const result = await supabase('rpc/replace_sales_order_plan', { method:'POST', body:{
        p_sales_order_id:orderId,
        p_client_id:text(body.client_id,80) || null,
        p_lines:cleanLines(body.lines),
        p_importer_id:text(body.importer_id,80) || null,
        p_order_date:text(body.order_date,40) || null,
        p_requested_at:text(body.requested_at,80) || null,
        p_currency:text(body.currency,10).toUpperCase() || 'USD',
        p_customer_reference:text(body.customer_reference,250) || null,
        p_notes:text(body.notes,2000) || null
      }});
      const order = rpcRow(result);
      await writeAudit(admin,'sales_order_updated','sales_order',orderId,{ so_number:order?.so_number || null });
      return ok(res,{ order:(await listOrders(admin, true)).find(item => item.id === orderId) || order });
    }

    if (['confirm','cancel','close'].includes(action)) {
      const orderId = text(body.sales_order_id,80);
      if (!orderId) throw new Error('Falta la Sales Order');
      const result = await supabase('rpc/transition_sales_order', { method:'POST', body:{ p_sales_order_id:orderId, p_action:action } });
      const order = rpcRow(result);
      await writeAudit(admin,`sales_order_${action}`,'sales_order',orderId,{ so_number:order?.so_number || null });
      return ok(res,{ order:(await listOrders(admin, true)).find(item => item.id === orderId) || order });
    }

    return fail(res,400,'Acción de Ventas no válida');
  } catch (error) {
    const raw = String(error?.message || '');
    const translated = translatedError(raw);
    if (translated) return fail(res,400,translated);
    console.error('[sales]',error);
    return fail(res,500,'No se pudo procesar Ventas');
  }
}
