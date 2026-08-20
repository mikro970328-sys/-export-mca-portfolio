import { fail, ok, requireAdmin, supabase } from './_lib.js';

function unique(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function inFilter(values) {
  return unique(values).join(',');
}

async function loadLoadLinks() {
  const loads = await supabase('loads', {
    query: '?select=id,load_number,status,shipment_id,updated_at&order=updated_at.desc'
  });
  if (!loads?.length) return [];

  const shipmentIds = inFilter(loads.map(item => item.shipment_id));
  const shipments = shipmentIds ? await supabase('shipments', {
    query: `?select=id,operation_id,container_number&id=in.(${shipmentIds})`
  }) : [];
  const byShipment = new Map((shipments || []).map(item => [String(item.id), item]));

  const loadIds = inFilter(loads.map(item => item.id));
  const loadItems = loadIds ? await supabase('load_items', {
    query: `?select=id,load_id&load_id=in.(${loadIds})`
  }) : [];
  const loadByItem = new Map((loadItems || []).map(item => [String(item.id), String(item.load_id)]));

  const loadItemIds = inFilter((loadItems || []).map(item => item.id));
  const allocations = loadItemIds ? await supabase('load_allocations', {
    query: `?select=load_item_id,receipt_item_id&load_item_id=in.(${loadItemIds})`
  }) : [];

  const receiptItemIds = inFilter((allocations || []).map(item => item.receipt_item_id));
  const receiptItems = receiptItemIds ? await supabase('warehouse_receipt_items', {
    query: `?select=id,receipt_id&id=in.(${receiptItemIds})`
  }) : [];
  const receiptByItem = new Map((receiptItems || []).map(item => [String(item.id), String(item.receipt_id)]));

  const receiptIds = inFilter((receiptItems || []).map(item => item.receipt_id));
  const receipts = receiptIds ? await supabase('warehouse_receipts', {
    query: `?select=id,receipt_number&id=in.(${receiptIds})`
  }) : [];
  const receiptNumberById = new Map((receipts || []).map(item => [String(item.id), item.receipt_number]));
  const receiptNumbersByLoad = new Map();

  (allocations || []).forEach(allocation => {
    const loadId = loadByItem.get(String(allocation.load_item_id));
    const receiptId = receiptByItem.get(String(allocation.receipt_item_id));
    const receiptNumber = receiptNumberById.get(String(receiptId || ''));
    if (!loadId || !receiptNumber) return;
    if (!receiptNumbersByLoad.has(loadId)) receiptNumbersByLoad.set(loadId, new Set());
    receiptNumbersByLoad.get(loadId).add(receiptNumber);
  });

  return loads.map(load => {
    const shipment = load.shipment_id ? byShipment.get(String(load.shipment_id)) || null : null;
    return {
      load_id: load.id,
      load_number: load.load_number,
      load_status: load.status,
      shipment_id: load.shipment_id || null,
      container_number: shipment?.container_number || null,
      operation_id: shipment?.operation_id || null,
      receipt_numbers: [...(receiptNumbersByLoad.get(String(load.id)) || [])].sort(),
      updated_at: load.updated_at || null
    };
  });
}

async function loadPurchaseLinks() {
  const [orders, progress, receipts] = await Promise.all([
    supabase('purchase_orders', {
      query:'?select=id,po_number,supplier_id,warehouse_id,status,order_date,expected_at,updated_at&order=updated_at.desc&limit=2000'
    }),
    supabase('purchase_order_progress', {
      query:'?select=purchase_order_id,receipt_status,has_excess&limit=2000'
    }),
    supabase('warehouse_receipts', {
      query:'?select=id,receipt_number,supplier_id,warehouse_id,status,received_at,updated_at&order=received_at.desc&limit=5000'
    })
  ]);

  const receiptRows = receipts || [];
  const progressByOrder = new Map((progress || []).map(item => [String(item.purchase_order_id), item]));
  if (!orders?.length) return { purchases:[], receipts:receiptRows };

  const orderIds = inFilter(orders.map(item => item.id));
  const items = orderIds ? await supabase('purchase_order_items', {
    query:`?select=id,purchase_order_id&purchase_order_id=in.(${orderIds})&limit=10000`
  }) : [];
  const orderByItem = new Map((items || []).map(item => [String(item.id), String(item.purchase_order_id)]));

  const itemIds = inFilter((items || []).map(item => item.id));
  const allocations = itemIds ? await supabase('purchase_receipt_allocations', {
    query:`?select=purchase_order_item_id,receipt_item_id&purchase_order_item_id=in.(${itemIds})&limit=20000`
  }) : [];

  const receiptItemIds = inFilter((allocations || []).map(item => item.receipt_item_id));
  const receiptItems = receiptItemIds ? await supabase('warehouse_receipt_items', {
    query:`?select=id,receipt_id&id=in.(${receiptItemIds})&limit=20000`
  }) : [];
  const receiptIdByItem = new Map((receiptItems || []).map(item => [String(item.id), String(item.receipt_id)]));
  const receiptById = new Map(receiptRows.map(item => [String(item.id), item]));
  const receiptsByOrder = new Map();

  (allocations || []).forEach(allocation => {
    const orderId = orderByItem.get(String(allocation.purchase_order_item_id));
    const receiptId = receiptIdByItem.get(String(allocation.receipt_item_id));
    const receipt = receiptById.get(String(receiptId || ''));
    if (!orderId || !receipt) return;
    if (!receiptsByOrder.has(orderId)) receiptsByOrder.set(orderId, new Map());
    receiptsByOrder.get(orderId).set(String(receipt.id), receipt);
  });

  const purchases = orders.map(order => {
    const physical = progressByOrder.get(String(order.id)) || null;
    const relatedReceipts = [...(receiptsByOrder.get(String(order.id))?.values() || [])]
      .sort((a,b) => String(b.received_at || '').localeCompare(String(a.received_at || '')))
      .map(receipt => ({
        receipt_id:receipt.id,
        receipt_number:receipt.receipt_number,
        receipt_status:receipt.status,
        received_at:receipt.received_at || null,
        warehouse_id:receipt.warehouse_id || null
      }));
    return {
      purchase_order_id:order.id,
      po_number:order.po_number,
      po_status:order.status,
      receipt_status:physical?.receipt_status || 'pending',
      has_excess:Boolean(physical?.has_excess),
      supplier_id:order.supplier_id,
      warehouse_id:order.warehouse_id || null,
      order_date:order.order_date || null,
      expected_at:order.expected_at || null,
      receipts:relatedReceipts,
      updated_at:order.updated_at || null
    };
  });

  return { purchases, receipts:receiptRows };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const [links, purchaseData] = await Promise.all([
      loadLoadLinks(),
      loadPurchaseLinks()
    ]);
    return ok(res, {
      links,
      purchases:purchaseData.purchases,
      receipts:purchaseData.receipts
    });
  } catch (error) {
    console.error('[operational-links]', error);
    return fail(res, 400, error.message || 'No se pudieron resolver los enlaces operativos');
  }
}
