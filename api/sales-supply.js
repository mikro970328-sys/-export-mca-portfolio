import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const METHODS = new Set(['inventory','purchase_warehouse','purchase_direct']);

const uuid = (value, label = 'ID') => {
  const result = String(value || '').trim();
  if (!UUID_RE.test(result)) throw new Error(`${label}_INVALID`);
  return result;
};
const quantity = (value, label, { allowZero = false } = {}) => {
  const result = Number(value);
  if (!Number.isFinite(result) || (allowZero ? result < 0 : result <= 0)) throw new Error(`${label}_INVALID`);
  return result;
};
const optionalPallets = (value) => quantity(value ?? 0, 'PALLETS', { allowZero: true });
const notes = (value) => String(value ?? '').trim() || null;
const inFilter = (values) => `in.(${values.join(',')})`;
const indexBy = (rows, key = 'id') => new Map((rows || []).map((row) => [row[key], row]));
const groupBy = (rows, key) => {
  const map = new Map();
  for (const row of rows || []) {
    const value = row[key];
    if (!map.has(value)) map.set(value, []);
    map.get(value).push(row);
  }
  return map;
};

const friendlyErrors = {
  SALES_ORDER_ID_INVALID:'Venta inválida.',
  SALES_ORDER_ITEM_ID_INVALID:'Producto de venta inválido.',
  PLAN_ID_INVALID:'Plan de abastecimiento inválido.',
  PROCUREMENT_ID_INVALID:'Relación de compra inválida.',
  PURCHASE_ORDER_ITEM_ID_INVALID:'Línea de compra inválida.',
  SHIPMENT_ID_INVALID:'Contenedor inválido.',
  PLANNED_QUANTITY_INVALID:'La cantidad planificada debe ser mayor que cero.',
  ALLOCATED_SALES_QUANTITY_INVALID:'La cantidad aplicada a la venta debe ser mayor que cero.',
  ALLOCATED_PURCHASE_QUANTITY_INVALID:'La cantidad aplicada de la compra debe ser mayor que cero.',
  PALLETS_INVALID:'Los pallets no pueden ser negativos.',
  SUPPLY_SO_NOT_CONFIRMED:'La venta debe estar confirmada antes de planificar su abastecimiento.',
  SUPPLY_WAREHOUSE_REQUIRED:'Selecciona el almacén para esta ruta de abastecimiento.',
  SUPPLY_DIRECT_WAREHOUSE_FORBIDDEN:'Un envío directo no debe pasar por un almacén.',
  SUPPLY_WAREHOUSE_INACTIVE:'El almacén seleccionado no está activo.',
  SUPPLY_PLAN_EXCEEDS_ORDER_QUANTITY:'La cantidad planificada supera la cantidad vendida.',
  SUPPLY_PLAN_EXCEEDS_ORDER_PALLETS:'Los pallets planificados superan los pallets de la venta.',
  SUPPLY_PLAN_CONTEXT_LOCKED_BY_PROCUREMENT:'Desvincula primero las compras relacionadas antes de cambiar la ruta o el almacén.',
  SUPPLY_PLAN_BELOW_PROCUREMENT_QUANTITY:'La cantidad planificada no puede quedar por debajo de lo ya vinculado a compras.',
  SUPPLY_PLAN_BELOW_PROCUREMENT_PALLETS:'Los pallets planificados no pueden quedar por debajo de lo ya vinculado a compras.',
  SUPPLY_PLAN_NOT_PURCHASE:'Esta ruta se abastece desde inventario y no necesita vincular una compra.',
  SUPPLY_PO_CANCELLED:'No se puede usar una orden de compra cancelada.',
  SUPPLY_PRODUCT_MISMATCH:'La compra seleccionada corresponde a otro producto.',
  SUPPLY_PO_WAREHOUSE_MISMATCH:'La compra corresponde a otro almacén.',
  SUPPLY_DIRECT_PO_HAS_WAREHOUSE:'Para envío directo, la compra no debe estar destinada a un almacén.',
  SUPPLY_PROCUREMENT_EXCEEDS_PLAN:'La compra vinculada supera lo planificado para esta ruta.',
  SUPPLY_PROCUREMENT_EXCEEDS_PLAN_PALLETS:'Los pallets vinculados superan lo planificado para esta ruta.',
  SUPPLY_PROCUREMENT_EXCEEDS_PO:'La cantidad asignada supera la cantidad disponible de esa línea de compra.',
  SUPPLY_PROCUREMENT_EXCEEDS_PO_PALLETS:'Los pallets asignados superan los pallets disponibles de esa línea de compra.',
  SUPPLY_PROCUREMENT_CONTEXT_LOCKED_BY_DIRECT_SHIPMENT:'No se puede cambiar la compra o el plan porque ya existen contenedores directos vinculados.',
  SUPPLY_PROCUREMENT_BELOW_DIRECT_SALES_QUANTITY:'La cantidad de venta no puede quedar por debajo de lo ya asignado a contenedores.',
  SUPPLY_PROCUREMENT_BELOW_DIRECT_PURCHASE_QUANTITY:'La cantidad de compra no puede quedar por debajo de lo ya asignado a contenedores.',
  DIRECT_SHIPMENT_REQUIRES_DIRECT_PURCHASE:'Este contenedor solo puede vincularse a una compra marcada como envío directo.',
  DIRECT_SHIPMENT_SALE_NOT_CONFIRMED:'La venta ya no está disponible para un envío directo.',
  DIRECT_SHIPMENT_PO_NOT_CONFIRMED:'La orden de compra debe estar confirmada antes de asignar un contenedor directo.',
  DIRECT_SHIPMENT_HAS_LOAD:'Ese contenedor ya pertenece a un Cargue y no puede usarse como envío directo.',
  DIRECT_SHIPMENT_CLIENT_MISMATCH:'El contenedor pertenece a otro cliente.',
  DIRECT_SHIPMENT_IMPORTER_MISMATCH:'La importadora del contenedor no coincide con la venta.',
  DIRECT_SHIPMENT_MIXED_COMMERCIAL_CONTEXT:'No se pueden mezclar clientes o importadoras diferentes dentro de este contenedor.',
  DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_SALES:'La cantidad de venta asignada al contenedor supera lo vinculado a la compra.',
  DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_PURCHASE:'La cantidad de compra asignada al contenedor supera lo vinculado a la compra.'
};

const friendlyError = (error) => {
  const raw = String(error?.message || error || '');
  const code = Object.keys(friendlyErrors).find((key) => raw.includes(key));
  if (code) return friendlyErrors[code];
  if (raw.includes('23503')) return 'No se puede eliminar porque este registro ya está relacionado con otra parte de la operación.';
  if (raw.includes('23505')) return 'Esa relación ya existe.';
  return 'No se pudo actualizar el abastecimiento.';
};

async function loadSupply(salesOrderId) {
  const orderRows = await supabase('sales_orders', {
    query:`?select=id,so_number,status,client_id,importer_id,currency,order_date,requested_at&limit=1&id=eq.${salesOrderId}`
  }) || [];
  const order = orderRows[0];
  if (!order) throw new Error('SALES_ORDER_NOT_FOUND');

  const items = await supabase('sales_order_items', {
    query:`?select=id,sales_order_id,product_id,ordered_quantity,ordered_pallets,unit,unit_price,currency&sales_order_id=eq.${salesOrderId}&order=created_at.asc&limit=5000`
  }) || [];
  const itemIds = items.map((row) => row.id);
  const productIds = [...new Set(items.map((row) => row.product_id).filter(Boolean))];

  const [progressRows, productRows, warehouseRows] = await Promise.all([
    supabase('sales_order_supply_item_progress', { query:`?select=*&sales_order_id=eq.${salesOrderId}&limit=5000` }),
    productIds.length ? supabase('products', { query:`?select=id,sku,name,unit,active&id=${inFilter(productIds)}&limit=5000` }) : [],
    supabase('warehouses', { query:'?select=id,code,name,location,active&active=eq.true&order=name.asc&limit=5000' })
  ]);

  const planRows = itemIds.length
    ? await supabase('sales_supply_plan_lines', { query:`?select=*&sales_order_item_id=${inFilter(itemIds)}&order=created_at.asc&limit=5000` }) || []
    : [];
  const planIds = planRows.map((row) => row.id);
  const procurementRows = planIds.length
    ? await supabase('sales_procurement_allocations', { query:`?select=*&supply_plan_line_id=${inFilter(planIds)}&order=created_at.asc&limit=5000` }) || []
    : [];
  const procurementIds = procurementRows.map((row) => row.id);
  const directRows = procurementIds.length
    ? await supabase('direct_shipment_allocations', { query:`?select=*&sales_procurement_allocation_id=${inFilter(procurementIds)}&order=created_at.asc&limit=5000` }) || []
    : [];

  const poItemRows = productIds.length
    ? await supabase('purchase_order_items', { query:`?select=id,purchase_order_id,product_id,ordered_quantity,ordered_pallets,unit,unit_cost,currency&product_id=${inFilter(productIds)}&limit=5000` }) || []
    : [];
  const poIds = [...new Set(poItemRows.map((row) => row.purchase_order_id).filter(Boolean))];
  const poRows = poIds.length
    ? await supabase('purchase_orders', { query:`?select=id,po_number,supplier_id,warehouse_id,status,order_date,expected_at,currency& id=${inFilter(poIds)}&limit=5000`.replace('& id=','&id=') }) || []
    : [];
  const supplierIds = [...new Set(poRows.map((row) => row.supplier_id).filter(Boolean))];
  const supplierRows = supplierIds.length
    ? await supabase('suppliers', { query:`?select=id,name,active&id=${inFilter(supplierIds)}&limit=5000` }) || []
    : [];

  const directShipmentIds = [...new Set(directRows.map((row) => row.shipment_id).filter(Boolean))];
  const clientShipments = await supabase('shipments', {
    query:`?select=id,container_number,client_id,importer_id,active,operational_status,last_status,departure_date,delivered_at&client_id=eq.${order.client_id}&limit=5000`
  }) || [];
  const candidateShipmentIds = clientShipments.map((row) => row.id);
  const activeLoads = candidateShipmentIds.length
    ? await supabase('loads', { query:`?select=id,shipment_id,status&shipment_id=${inFilter(candidateShipmentIds)}&status=neq.cancelled&limit=5000` }) || []
    : [];
  const loadShipmentIds = new Set(activeLoads.map((row) => row.shipment_id));
  const directShipmentOptions = clientShipments.filter((shipment) => {
    if (!shipment.active || loadShipmentIds.has(shipment.id)) return false;
    return shipment.importer_id == null || shipment.importer_id === order.importer_id;
  });
  const missingDirectShipments = directShipmentIds.filter((id) => !clientShipments.some((shipment) => shipment.id === id));
  const historicalDirectShipments = missingDirectShipments.length
    ? await supabase('shipments', { query:`?select=id,container_number,client_id,importer_id,active,operational_status,last_status,departure_date,delivered_at&id=${inFilter(missingDirectShipments)}&limit=5000` }) || []
    : [];

  const productById = indexBy(productRows || []);
  const progressByItem = indexBy(progressRows || [], 'sales_order_item_id');
  const plansByItem = groupBy(planRows, 'sales_order_item_id');
  const procurementByPlan = groupBy(procurementRows, 'supply_plan_line_id');
  const directByProcurement = groupBy(directRows, 'sales_procurement_allocation_id');
  const poById = indexBy(poRows);
  const supplierById = indexBy(supplierRows);
  const poItemById = indexBy(poItemRows);
  const shipmentById = indexBy([...clientShipments, ...historicalDirectShipments]);

  const purchaseOptions = poItemRows
    .map((poItem) => {
      const po = poById.get(poItem.purchase_order_id);
      if (!po || po.status === 'cancelled') return null;
      const supplier = supplierById.get(po.supplier_id) || null;
      return {
        ...poItem,
        purchase_order:{ ...po, supplier },
        compatible_methods:po.warehouse_id ? ['purchase_warehouse'] : ['purchase_warehouse','purchase_direct']
      };
    })
    .filter(Boolean);

  const enrichedItems = items.map((item) => ({
    ...item,
    product:productById.get(item.product_id) || null,
    supply_progress:progressByItem.get(item.id) || null,
    supply_plans:(plansByItem.get(item.id) || []).map((plan) => ({
      ...plan,
      procurement_allocations:(procurementByPlan.get(plan.id) || []).map((allocation) => ({
        ...allocation,
        purchase_order_item:poItemById.get(allocation.purchase_order_item_id) || null,
        direct_shipments:(directByProcurement.get(allocation.id) || []).map((direct) => ({
          ...direct,
          shipment:shipmentById.get(direct.shipment_id) || null
        }))
      }))
    }))
  }));

  return {
    order,
    items:enrichedItems,
    warehouses:warehouseRows || [],
    purchase_options:purchaseOptions,
    direct_shipment_options:directShipmentOptions
  };
}

export default async function handler(req,res) {
  const admin = requireAdmin(req,res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const salesOrderId = uuid(req.query?.sales_order_id || req.query?.id, 'SALES_ORDER_ID');
      return ok(res, await loadSupply(salesOrderId));
    }

    if (req.method !== 'POST') return fail(res,405,'Método no permitido');
    const body = await readJson(req);
    const action = String(body.action || '').trim().toLowerCase();

    if (action === 'create_plan') {
      const salesOrderItemId = uuid(body.sales_order_item_id, 'SALES_ORDER_ITEM_ID');
      const supplyMethod = String(body.supply_method || '').trim();
      if (!METHODS.has(supplyMethod)) return fail(res,400,'Selecciona una ruta de abastecimiento válida.');
      const warehouseId = supplyMethod === 'purchase_direct' ? null : uuid(body.warehouse_id, 'WAREHOUSE_ID');
      const rows = await supabase('sales_supply_plan_lines', {
        method:'POST',
        body:{
          sales_order_item_id:salesOrderItemId,
          supply_method:supplyMethod,
          warehouse_id:warehouseId,
          planned_quantity:quantity(body.planned_quantity,'PLANNED_QUANTITY'),
          planned_pallets:optionalPallets(body.planned_pallets),
          notes:notes(body.notes),
          created_by:admin.admin_id
        },
        prefer:'return=representation'
      }) || [];
      const record = rows[0];
      await writeAudit(admin,'sales_supply_plan_created','sales_order_item',salesOrderItemId,{ plan_id:record?.id,supply_method:supplyMethod });
      return ok(res,{ record });
    }

    if (action === 'update_plan') {
      const planId = uuid(body.plan_id, 'PLAN_ID');
      const patch = {};
      if (body.planned_quantity !== undefined) patch.planned_quantity = quantity(body.planned_quantity,'PLANNED_QUANTITY');
      if (body.planned_pallets !== undefined) patch.planned_pallets = optionalPallets(body.planned_pallets);
      if (body.notes !== undefined) patch.notes = notes(body.notes);
      if (body.supply_method !== undefined) {
        const method = String(body.supply_method || '').trim();
        if (!METHODS.has(method)) return fail(res,400,'Selecciona una ruta de abastecimiento válida.');
        patch.supply_method = method;
        patch.warehouse_id = method === 'purchase_direct' ? null : uuid(body.warehouse_id, 'WAREHOUSE_ID');
      } else if (body.warehouse_id !== undefined) {
        patch.warehouse_id = body.warehouse_id == null ? null : uuid(body.warehouse_id, 'WAREHOUSE_ID');
      }
      if (!Object.keys(patch).length) return fail(res,400,'No hay cambios para guardar.');
      const rows = await supabase('sales_supply_plan_lines', { method:'PATCH',query:`?id=eq.${planId}`,body:patch,prefer:'return=representation' }) || [];
      if (!rows[0]) return fail(res,404,'Plan de abastecimiento no encontrado.');
      await writeAudit(admin,'sales_supply_plan_updated','sales_supply_plan_line',planId,{ fields:Object.keys(patch) });
      return ok(res,{ record:rows[0] });
    }

    if (action === 'delete_plan') {
      const planId = uuid(body.plan_id, 'PLAN_ID');
      const rows = await supabase('sales_supply_plan_lines', { method:'DELETE',query:`?id=eq.${planId}`,prefer:'return=representation' }) || [];
      if (!rows[0]) return fail(res,404,'Plan de abastecimiento no encontrado.');
      await writeAudit(admin,'sales_supply_plan_deleted','sales_supply_plan_line',planId,{ sales_order_item_id:rows[0].sales_order_item_id });
      return ok(res,{ deleted:true });
    }

    if (action === 'link_purchase') {
      const planId = uuid(body.supply_plan_line_id, 'PLAN_ID');
      const purchaseOrderItemId = uuid(body.purchase_order_item_id, 'PURCHASE_ORDER_ITEM_ID');
      const rows = await supabase('sales_procurement_allocations', {
        method:'POST',
        body:{
          supply_plan_line_id:planId,
          purchase_order_item_id:purchaseOrderItemId,
          allocated_sales_quantity:quantity(body.allocated_sales_quantity,'ALLOCATED_SALES_QUANTITY'),
          allocated_sales_pallets:optionalPallets(body.allocated_sales_pallets),
          allocated_purchase_quantity:quantity(body.allocated_purchase_quantity,'ALLOCATED_PURCHASE_QUANTITY'),
          allocated_purchase_pallets:optionalPallets(body.allocated_purchase_pallets),
          notes:notes(body.notes),
          created_by:admin.admin_id
        },
        prefer:'return=representation'
      }) || [];
      const record = rows[0];
      await writeAudit(admin,'sales_procurement_linked','sales_supply_plan_line',planId,{ procurement_allocation_id:record?.id,purchase_order_item_id:purchaseOrderItemId });
      return ok(res,{ record });
    }

    if (action === 'update_purchase_link') {
      const procurementId = uuid(body.procurement_allocation_id, 'PROCUREMENT_ID');
      const patch = {};
      if (body.allocated_sales_quantity !== undefined) patch.allocated_sales_quantity = quantity(body.allocated_sales_quantity,'ALLOCATED_SALES_QUANTITY');
      if (body.allocated_sales_pallets !== undefined) patch.allocated_sales_pallets = optionalPallets(body.allocated_sales_pallets);
      if (body.allocated_purchase_quantity !== undefined) patch.allocated_purchase_quantity = quantity(body.allocated_purchase_quantity,'ALLOCATED_PURCHASE_QUANTITY');
      if (body.allocated_purchase_pallets !== undefined) patch.allocated_purchase_pallets = optionalPallets(body.allocated_purchase_pallets);
      if (body.notes !== undefined) patch.notes = notes(body.notes);
      if (!Object.keys(patch).length) return fail(res,400,'No hay cambios para guardar.');
      const rows = await supabase('sales_procurement_allocations', { method:'PATCH',query:`?id=eq.${procurementId}`,body:patch,prefer:'return=representation' }) || [];
      if (!rows[0]) return fail(res,404,'Relación de compra no encontrada.');
      await writeAudit(admin,'sales_procurement_updated','sales_procurement_allocation',procurementId,{ fields:Object.keys(patch) });
      return ok(res,{ record:rows[0] });
    }

    if (action === 'unlink_purchase') {
      const procurementId = uuid(body.procurement_allocation_id, 'PROCUREMENT_ID');
      const rows = await supabase('sales_procurement_allocations', { method:'DELETE',query:`?id=eq.${procurementId}`,prefer:'return=representation' }) || [];
      if (!rows[0]) return fail(res,404,'Relación de compra no encontrada.');
      await writeAudit(admin,'sales_procurement_unlinked','sales_procurement_allocation',procurementId,{ purchase_order_item_id:rows[0].purchase_order_item_id });
      return ok(res,{ deleted:true });
    }

    if (action === 'link_direct_shipment') {
      const procurementId = uuid(body.procurement_allocation_id, 'PROCUREMENT_ID');
      const shipmentId = uuid(body.shipment_id, 'SHIPMENT_ID');
      const rows = await supabase('direct_shipment_allocations', {
        method:'POST',
        body:{
          sales_procurement_allocation_id:procurementId,
          shipment_id:shipmentId,
          allocated_sales_quantity:quantity(body.allocated_sales_quantity,'ALLOCATED_SALES_QUANTITY'),
          allocated_sales_pallets:optionalPallets(body.allocated_sales_pallets),
          allocated_purchase_quantity:quantity(body.allocated_purchase_quantity,'ALLOCATED_PURCHASE_QUANTITY'),
          allocated_purchase_pallets:optionalPallets(body.allocated_purchase_pallets),
          notes:notes(body.notes),
          created_by:admin.admin_id
        },
        prefer:'return=representation'
      }) || [];
      const record = rows[0];
      await writeAudit(admin,'direct_shipment_linked','shipment',shipmentId,{ direct_shipment_allocation_id:record?.id,procurement_allocation_id:procurementId });
      return ok(res,{ record });
    }

    if (action === 'unlink_direct_shipment') {
      const directId = uuid(body.direct_shipment_allocation_id, 'DIRECT_SHIPMENT_ID');
      const rows = await supabase('direct_shipment_allocations', { method:'DELETE',query:`?id=eq.${directId}`,prefer:'return=representation' }) || [];
      if (!rows[0]) return fail(res,404,'Relación de contenedor directo no encontrada.');
      await writeAudit(admin,'direct_shipment_unlinked','shipment',rows[0].shipment_id,{ direct_shipment_allocation_id:directId,procurement_allocation_id:rows[0].sales_procurement_allocation_id });
      return ok(res,{ deleted:true });
    }

    return fail(res,400,'Acción de abastecimiento no válida.');
  } catch (error) {
    console.error('[sales-supply]',error);
    if (String(error?.message || '').includes('SALES_ORDER_NOT_FOUND')) return fail(res,404,'Venta no encontrada.');
    return fail(res,400,friendlyError(error));
  }
}
