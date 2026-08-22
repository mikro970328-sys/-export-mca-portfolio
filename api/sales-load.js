import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const num = value => {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new Error('LOAD_QUANTITY_INVALID');
  return n;
};

async function bootstrap() {
  const [warehouses, sources] = await Promise.all([
    supabase('warehouses', { query:'?select=id,code,name,city,country,active&active=eq.true&order=name.asc&limit=1000' }),
    supabase('inventory_source_balances', { query:'?select=receipt_item_id,receipt_id,receipt_number,received_at,warehouse_id,warehouse_code,warehouse_name,product_id,product_sku,product_name,product_brand,product_unit,receipt_unit,units_per_pallet,lot_number,physical_quantity,physical_pallets,reserved_quantity,reserved_pallets&warehouse_active=eq.true&order=received_at.asc&limit=5000' })
  ]);
  const available = (sources || []).map(source => ({
    ...source,
    available_quantity:Number(source.physical_quantity || 0) - Number(source.reserved_quantity || 0),
    available_pallets:Number(source.physical_pallets || 0) - Number(source.reserved_pallets || 0)
  })).filter(source => source.available_quantity > 0 || source.available_pallets > 0);
  return { warehouses:warehouses || [], sources:available };
}

function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('LOAD_HAS_NO_ITEMS');
  return lines.map((line, index) => {
    const salesOrderItemId = text(line.sales_order_item_id, 80);
    if (!salesOrderItemId) throw new Error(`Falta la línea de venta ${index + 1}`);
    const allocations = Array.isArray(line.allocations) ? line.allocations.map(a => ({
      receipt_item_id:text(a.receipt_item_id,80),
      allocated_quantity:num(a.allocated_quantity),
      allocated_pallets:num(a.allocated_pallets)
    })).filter(a => a.receipt_item_id && (a.allocated_quantity > 0 || a.allocated_pallets > 0)) : [];
    if (!allocations.length) throw new Error(`Selecciona al menos un WR para la línea ${index + 1}`);
    return { sales_order_item_id:salesOrderItemId, allocations, notes:text(line.notes,1000) || null };
  });
}

function translated(raw) {
  const table = [
    ['SO_NOT_CONFIRMED','La Sales Order debe estar confirmada.'],
    ['SO_ITEM_NOT_IN_ORDER','Una línea no pertenece a esta Sales Order.'],
    ['SO_ALLOCATION_EXCEEDS_ORDER','La cantidad seleccionada supera lo pendiente de la Sales Order.'],
    ['LOAD_ALLOCATION_PRODUCT_MISMATCH','El WR seleccionado corresponde a otro producto.'],
    ['LOAD_ALLOCATION_WAREHOUSE_MISMATCH','Todos los WR deben pertenecer al almacén seleccionado.'],
    ['WR_NOT_ACTIVE','Uno de los WR ya no está activo.'],
    ['LOAD_QUANTITY_REQUIRED','Indica una cantidad o pallets mayor que cero.'],
    ['LOAD_QUANTITY_REQUIRED_FOR_PALLETS','Ese WR no tiene unidades por pallet definidas; indica también las unidades.'],
    ['WAREHOUSE_REQUIRED','Selecciona un almacén.'],
    ['LOAD_HAS_NO_ITEMS','Selecciona mercancía para crear el Cargue.']
  ];
  return table.find(([key]) => raw.includes(key))?.[1] || raw;
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    if (req.method === 'GET') return ok(res, await bootstrap());
    if (req.method !== 'POST') return fail(res,405,'Método no permitido');
    const body = await readJson(req);
    const salesOrderId = text(body.sales_order_id,80);
    const warehouseId = text(body.warehouse_id,80);
    if (!salesOrderId) return fail(res,400,'Falta la Sales Order');
    const result = await supabase('rpc/create_load_from_sales_order', { method:'POST', body:{
      p_sales_order_id:salesOrderId,
      p_warehouse_id:warehouseId || null,
      p_lines:cleanLines(body.lines),
      p_scheduled_at:text(body.scheduled_at,80) || null,
      p_notes:text(body.notes,2000) || null,
      p_actor:admin.admin_id || null
    }});
    const load = Array.isArray(result) ? result[0] : result;
    if (!load?.id) throw new Error('No se pudo crear el Cargue');
    await writeAudit(admin,'load_created_from_sales_order','load',load.id,{ sales_order_id:salesOrderId, load_number:load.load_number });
    return ok(res,{ load });
  } catch (error) {
    const raw = String(error.message || 'No se pudo crear el Cargue');
    console.error('[sales-load]',error);
    return fail(res,400,translated(raw));
  }
}
