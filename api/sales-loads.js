import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const number = value => {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error('LOAD_QUANTITY_INVALID');
  return parsed;
};
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);

async function getOrder(orderId) {
  const [orders, items, progress] = await Promise.all([
    supabase('sales_orders', { query:`?select=id,so_number,client_id,importer_id,status,currency,client:clients(id,name,company,mipyme_name),importer:importers(id,name)&id=eq.${encodeURIComponent(orderId)}&limit=1` }),
    supabase('sales_order_items', { query:`?select=id,sales_order_id,product_id,ordered_quantity,ordered_pallets,unit,units_per_pallet,unit_price,product:products(id,sku,name,brand,unit,package_format)&sales_order_id=eq.${encodeURIComponent(orderId)}&order=created_at.asc` }),
    supabase('sales_order_item_progress', { query:`?select=*&sales_order_id=eq.${encodeURIComponent(orderId)}` })
  ]);
  const order = orders?.[0] || null;
  if (!order) return null;
  const progressByItem = new Map((progress || []).map(row => [row.sales_order_item_id, row]));
  return { ...order, items:(items || []).map(item => ({ ...item, progress:progressByItem.get(item.id) || null })) };
}

async function loadOptions(orderId) {
  const order = await getOrder(orderId);
  if (!order) throw new Error('SO_NOT_FOUND');
  if (order.status !== 'confirmed') throw new Error('SO_NOT_CONFIRMED');

  const productIds = new Set(order.items.map(item => item.product_id));
  const [warehouses, balances] = await Promise.all([
    supabase('warehouses', { query:'?select=id,code,name,city,country,active&active=eq.true&order=name.asc&limit=1000' }),
    supabase('inventory_source_balances', { query:'?select=receipt_item_id,receipt_id,receipt_number,received_at,warehouse_id,warehouse_code,warehouse_name,product_id,product_sku,product_name,product_brand,product_unit,receipt_unit,units_per_pallet,lot_number,physical_quantity,physical_pallets,reserved_quantity,reserved_pallets&warehouse_active=eq.true&order=received_at.asc&limit=5000' })
  ]);

  const sources = (balances || []).filter(source => productIds.has(source.product_id)).map(source => ({
    ...source,
    available_quantity:Number(source.physical_quantity || 0) - Number(source.reserved_quantity || 0),
    available_pallets:Number(source.physical_pallets || 0) - Number(source.reserved_pallets || 0)
  })).filter(source => source.available_quantity > 0 || source.available_pallets > 0);

  return { order, warehouses:warehouses || [], sources };
}

function cleanLoadLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('LOAD_HAS_NO_ITEMS');
  return lines.map((line, index) => {
    const salesOrderItemId = text(line.sales_order_item_id, 80);
    if (!salesOrderItemId) throw new Error(`Falta la línea de SO ${index + 1}`);
    const allocations = Array.isArray(line.allocations) ? line.allocations.map((allocation, allocationIndex) => {
      const receiptItemId = text(allocation.receipt_item_id, 80);
      if (!receiptItemId) throw new Error(`Falta el WR de la asignación ${allocationIndex + 1}`);
      const allocatedQuantity = number(allocation.allocated_quantity);
      const allocatedPallets = number(allocation.allocated_pallets);
      if (allocatedQuantity <= 0 && allocatedPallets <= 0) throw new Error('LOAD_QUANTITY_REQUIRED');
      return {
        receipt_item_id:receiptItemId,
        allocated_quantity:String(allocatedQuantity),
        allocated_pallets:String(allocatedPallets)
      };
    }) : [];
    if (!allocations.length) throw new Error(`Selecciona al menos un WR para la línea ${index + 1}`);
    return { sales_order_item_id:salesOrderItemId, allocations, notes:text(line.notes, 1000) || null };
  });
}

function translatedError(raw) {
  const translations = [
    ['SO_NOT_FOUND','Sales Order no encontrada.'],
    ['SO_NOT_CONFIRMED','La Sales Order debe estar confirmada para crear un Cargue.'],
    ['SO_ITEM_NOT_IN_ORDER','Una de las líneas no pertenece a esta Sales Order.'],
    ['SO_LOAD_DUPLICATE_SALES_ITEM','Una línea de la Sales Order está repetida en el Cargue.'],
    ['SO_ALLOCATION_EXCEEDS_ORDER','La cantidad seleccionada excede el saldo pendiente de la Sales Order.'],
    ['WAREHOUSE_REQUIRED','Selecciona el almacén desde donde saldrá la mercancía.'],
    ['LOAD_HAS_NO_ITEMS','Selecciona mercancía para el Cargue.'],
    ['LOAD_ALLOCATIONS_REQUIRED','Selecciona al menos un WR para cada línea incluida.'],
    ['LOAD_ALLOCATION_PRODUCT_MISMATCH','El WR seleccionado no corresponde al producto de la línea.'],
    ['LOAD_ALLOCATION_WAREHOUSE_MISMATCH','Todos los WR deben pertenecer al almacén seleccionado.'],
    ['WR_NOT_ACTIVE','Uno de los WR ya no está activo.'],
    ['RECEIPT_ITEM_NOT_FOUND','Uno de los WR seleccionados ya no existe.'],
    ['LOAD_QUANTITY_INVALID','La cantidad o pallets seleccionados son inválidos.'],
    ['LOAD_QUANTITY_REQUIRED','Indica una cantidad o pallets mayor que cero.'],
    ['LOAD_QUANTITY_REQUIRED_FOR_PALLETS','Ese WR no tiene unidades por pallet para convertir pallets a cantidad.'],
    ['SO_LOAD_PLAN_ENTRY_INVALID','El plan de Cargue contiene una línea inválida.']
  ];
  return translations.find(([key]) => raw.includes(key))?.[1] || raw;
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const orderId = text(req.query?.sales_order_id, 80);
      if (!orderId) return fail(res, 400, 'Falta la Sales Order');
      return ok(res, await loadOptions(orderId));
    }

    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const body = await readJson(req);
    if (text(body.action, 60).toLowerCase() !== 'create_load') return fail(res, 400, 'Acción de Cargue no válida');

    const orderId = text(body.sales_order_id, 80);
    if (!orderId) throw new Error('SO_REQUIRED');
    const warehouseId = text(body.warehouse_id, 80);
    if (!warehouseId) throw new Error('WAREHOUSE_REQUIRED');

    const result = await supabase('rpc/create_load_from_sales_order', { method:'POST', body:{
      p_sales_order_id:orderId,
      p_warehouse_id:warehouseId,
      p_lines:cleanLoadLines(body.lines),
      p_scheduled_at:text(body.scheduled_at, 80) || null,
      p_notes:text(body.notes, 2000) || null,
      p_actor:admin.admin_id || null
    }});
    const load = rpcRow(result);
    if (!load?.id) throw new Error('No se pudo crear el Cargue');
    await writeAudit(admin, 'load_created_from_sales_order', 'load', load.id, { sales_order_id:orderId, load_number:load.load_number, warehouse_id:warehouseId });
    return ok(res, { load, order:await getOrder(orderId) });
  } catch (error) {
    const raw = String(error.message || 'No se pudo crear el Cargue');
    console.error('[sales-loads]', error);
    return fail(res, 400, translatedError(raw));
  }
}
