import { fail, ok, requireAdmin, supabase } from './_lib.js';

function inFilter(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))].join(',');
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const loads = await supabase('loads', {
      query: '?select=id,load_number,status,shipment_id,updated_at&order=updated_at.desc'
    });
    if (!loads?.length) return ok(res, { links: [] });

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

    const links = loads.map(load => {
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

    return ok(res, { links });
  } catch (error) {
    console.error('[operational-links]', error);
    return fail(res, 400, error.message || 'No se pudieron resolver los enlaces operativos');
  }
}
