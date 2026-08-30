import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);
const ALLOCATION_TARGETS = ['purchase_order_id','warehouse_receipt_id','load_id','shipment_id','operation_id','sales_order_id','sales_order_item_id'];
const BASES = new Set(['manual','quantity','pallets','value','weight']);

function translatedError(raw) {
  const messages = [
    ['COST_CHARGE_ACTOR_REQUIRED','No se pudo identificar al administrador que realiza la operación.'],
    ['COST_CHARGE_ACTOR_INVALID','El administrador no está activo.'],
    ['COST_CHARGE_NOT_FOUND','Cargo de costo no encontrado.'],
    ['COST_CHARGE_NOT_DRAFT','Solo un cargo en borrador puede modificarse.'],
    ['COST_CHARGE_CATEGORY_INVALID','Categoría de costo no válida.'],
    ['COST_CHARGE_STAGE_INVALID','Etapa de costo no válida.'],
    ['COST_CHARGE_AMOUNT_INVALID','El monto del cargo debe ser mayor que cero.'],
    ['COST_CHARGE_CURRENCY_INVALID','La moneda debe ser un código de tres letras.'],
    ['COST_CHARGE_ALLOCATIONS_INVALID','La distribución del cargo no es válida.'],
    ['COST_CHARGE_ALLOCATION_INVALID','Una línea de distribución no es válida.'],
    ['COST_CHARGE_ALLOCATION_AMOUNT_INVALID','Cada monto distribuido debe ser mayor que cero.'],
    ['COST_CHARGE_ALLOCATION_BASIS_INVALID','La base informativa de distribución no es válida.'],
    ['COST_CHARGE_ALLOCATION_TARGET_INVALID','Cada distribución debe apuntar exactamente a un objetivo.'],
    ['COST_CHARGE_ALLOCATION_EXCEEDS_TOTAL','La suma distribuida supera el monto total del cargo.'],
    ['COST_CHARGE_TOTAL_BELOW_ALLOCATIONS','El monto total no puede quedar por debajo de lo ya distribuido.'],
    ['COST_CHARGE_HAS_NO_ALLOCATIONS','Distribuye el cargo antes de contabilizarlo.'],
    ['COST_CHARGE_NOT_FULLY_ALLOCATED','El cargo debe estar distribuido al 100% antes de contabilizarlo.'],
    ['COST_CHARGE_ALLOCATIONS_LOCKED','La distribución de un cargo contabilizado no puede modificarse.'],
    ['COST_CHARGE_HEADER_LOCKED','El cargo contabilizado ya no puede modificarse.'],
    ['COST_CHARGE_CANNOT_VOID','El cargo no puede anularse en su estado actual.'],
    ['COST_CHARGE_STATUS_FINAL','El cargo anulado es final y conserva su historia.']
  ];
  return messages.find(([key]) => raw.includes(key))?.[1] || raw;
}

function cleanAllocations(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('La distribución del cargo no es válida');
  if (value.length > 500) throw new Error('La distribución tiene demasiadas líneas');
  return value.map((row, index) => {
    const amount = Number(row?.amount);
    const basis = text(row?.basis, 40).toLowerCase() || 'manual';
    const targets = Object.fromEntries(ALLOCATION_TARGETS.map(key => [key, text(row?.[key], 80) || null]));
    const selected = Object.values(targets).filter(Boolean);
    if (!Number.isFinite(amount) || amount <= 0) throw new Error(`Indica un monto válido en la distribución ${index + 1}`);
    if (!BASES.has(basis)) throw new Error(`Base inválida en la distribución ${index + 1}`);
    if (selected.length !== 1) throw new Error(`Selecciona exactamente un objetivo en la distribución ${index + 1}`);
    return { amount:String(amount), basis, ...targets, notes:text(row?.notes, 1000) || null };
  });
}

async function bootstrap() {
  const [
    charges, allocations, progress, suppliers,
    purchaseOrders, receipts, loads, shipments, operations,
    salesOrders, salesOrderItems, products,
    poCosts, wrCosts, loadCogs, postedAllocations,
    loadDirect, shipmentDirect, operationDirect, salesOrderDirect
  ] = await Promise.all([
    supabase('cost_charges', { query:'?select=id,cost_number,category,stage,amount,currency,incurred_date,supplier_id,reference,status,notes,created_by,posted_by,voided_by,posted_at,voided_at,created_at,updated_at&order=created_at.desc&limit=2000' }),
    supabase('cost_charge_allocations', { query:'?select=id,cost_charge_id,amount,basis,purchase_order_id,warehouse_receipt_id,load_id,shipment_id,operation_id,sales_order_id,sales_order_item_id,notes,created_by,created_at&order=created_at.asc&limit=10000' }),
    supabase('cost_charge_progress', { query:'?select=*&order=incurred_date.desc&limit=2000' }),
    supabase('suppliers', { query:'?select=id,name,legal_name&order=name.asc&limit=2000' }),
    supabase('purchase_orders', { query:'?select=id,po_number,status,currency,supplier_id&order=created_at.desc&limit=2000' }),
    supabase('warehouse_receipts', { query:'?select=id,receipt_number,status,supplier_id,warehouse_id,received_at&order=created_at.desc&limit=2000' }),
    supabase('loads', { query:'?select=id,load_number,status,shipment_id,warehouse_id&order=created_at.desc&limit=2000' }),
    supabase('shipments', { query:'?select=id,container_number,operation_id,status&order=id.desc&limit=3000' }),
    supabase('operations', { query:'?select=id,operation_code,status,currency,container_number&order=created_at.desc&limit=3000' }),
    supabase('sales_orders', { query:'?select=id,so_number,status,currency,client_id,importer_id&order=created_at.desc&limit=3000' }),
    supabase('sales_order_items', { query:'?select=id,sales_order_id,product_id,ordered_quantity,unit,entered_line_total&order=created_at.asc&limit=10000' }),
    supabase('products', { query:'?select=id,sku,name,brand&order=name.asc&limit=5000' }),
    supabase('purchase_order_item_merchandise_cost_basis', { query:'?select=*&limit=10000' }),
    supabase('warehouse_receipt_item_merchandise_cost', { query:'?select=*&limit=10000' }),
    supabase('load_merchandise_cogs', { query:'?select=*&limit=5000' }),
    supabase('posted_cost_charge_allocations', { query:'?select=*&order=incurred_date.desc&limit=10000' }),
    supabase('load_direct_costs', { query:'?select=*&limit=5000' }),
    supabase('shipment_direct_costs', { query:'?select=*&limit=5000' }),
    supabase('operation_direct_costs', { query:'?select=*&limit=5000' }),
    supabase('sales_order_direct_costs', { query:'?select=*&limit=5000' })
  ]);

  const allocationsByCharge = new Map();
  for (const row of allocations || []) {
    if (!allocationsByCharge.has(row.cost_charge_id)) allocationsByCharge.set(row.cost_charge_id, []);
    allocationsByCharge.get(row.cost_charge_id).push(row);
  }
  const progressByCharge = new Map((progress || []).map(row => [row.cost_charge_id, row]));
  const chargesDecorated = (charges || []).map(row => ({
    ...row,
    allocations:allocationsByCharge.get(row.id) || [],
    progress:progressByCharge.get(row.id) || null
  }));

  return {
    charges:chargesDecorated,
    targets:{
      suppliers:suppliers || [],
      purchase_orders:purchaseOrders || [],
      warehouse_receipts:receipts || [],
      loads:loads || [],
      shipments:shipments || [],
      operations:operations || [],
      sales_orders:salesOrders || [],
      sales_order_items:salesOrderItems || []
    },
    products:products || [],
    cost_models:{
      purchase_order_items:poCosts || [],
      warehouse_receipt_items:wrCosts || [],
      loads:loadCogs || [],
      posted_allocations:postedAllocations || [],
      load_direct:loadDirect || [],
      shipment_direct:shipmentDirect || [],
      operation_direct:operationDirect || [],
      sales_order_direct:salesOrderDirect || []
    }
  };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    if (req.method === 'GET') return ok(res, await bootstrap());
    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');

    const body = await readJson(req);
    const action = text(body.action, 60).toLowerCase();
    const actor = admin.admin_id || null;

    if (action === 'create' || action === 'replace') {
      const category = text(body.category, 60).toLowerCase();
      const stage = text(body.stage, 60).toLowerCase();
      const amount = Number(body.amount);
      const currency = text(body.currency, 3).toUpperCase() || 'USD';
      const allocations = cleanAllocations(body.allocations);
      if (!category) throw new Error('Selecciona una categoría');
      if (!stage) throw new Error('Selecciona una etapa');
      if (!Number.isFinite(amount) || amount <= 0) throw new Error('El monto debe ser mayor que cero');
      if (!/^[A-Z]{3}$/.test(currency)) throw new Error('La moneda debe tener tres letras');

      const rpc = action === 'create' ? 'rpc/create_cost_charge' : 'rpc/replace_cost_charge';
      const payload = {
        ...(action === 'replace' ? { p_cost_charge_id:text(body.cost_charge_id, 80) } : {}),
        p_category:category,
        p_stage:stage,
        p_amount:amount,
        p_currency:currency,
        p_incurred_date:text(body.incurred_date, 40) || null,
        p_supplier_id:text(body.supplier_id, 80) || null,
        p_reference:text(body.reference, 300) || null,
        p_notes:text(body.notes, 2000) || null,
        p_allocations:allocations,
        p_actor:actor
      };
      if (action === 'replace' && !payload.p_cost_charge_id) throw new Error('Falta el cargo a modificar');
      const result = rpcRow(await supabase(rpc, { method:'POST', body:payload }));
      if (!result?.id) throw new Error('No se pudo guardar el cargo');
      await writeAudit(admin, action === 'create' ? 'cost_charge_created' : 'cost_charge_updated', 'cost_charge', result.id, { cost_number:result.cost_number, category, stage, amount, currency });
      return ok(res, { charge:result });
    }

    if (action === 'post' || action === 'void') {
      const id = text(body.cost_charge_id, 80);
      if (!id) throw new Error('Falta el cargo');
      const rpc = action === 'post' ? 'rpc/post_cost_charge' : 'rpc/void_cost_charge';
      const result = rpcRow(await supabase(rpc, { method:'POST', body:{ p_cost_charge_id:id, p_actor:actor } }));
      await writeAudit(admin, `cost_charge_${action}`, 'cost_charge', id, { cost_number:result?.cost_number || null });
      return ok(res, { charge:result });
    }

    return fail(res, 400, 'Acción de Costos no válida');
  } catch (error) {
    const raw = String(error.message || 'No se pudo procesar Costos');
    console.error('[costs]', error);
    return fail(res, 400, translatedError(raw));
  }
}
