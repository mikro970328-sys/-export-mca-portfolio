import { authenticateAdmin, fail, loadAdminAccessContext, ok, supabase } from './_lib.js';

function unique(values) {
  return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function inFilter(values) {
  return unique(values).join(',');
}

async function paged(path, baseQuery, pageSize = 1000) {
  const rows = [];
  let offset = 0;
  while (true) {
    const separator = baseQuery.includes('?') ? '&' : '?';
    const page = await supabase(path, { query:`${baseQuery}${separator}limit=${pageSize}&offset=${offset}` });
    const batch = Array.isArray(page) ? page : [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
    offset += pageSize;
  }
  return rows;
}

async function loadLoadLinks() {
  const loads = await supabase('loads', {
    query:'?select=id,load_number,status,shipment_id,client_id,importer_id,updated_at&order=updated_at.desc'
  });
  if (!loads?.length) return [];

  const shipmentIds = inFilter(loads.map(item => item.shipment_id));
  const shipments = shipmentIds ? await supabase('shipments', {
    query:`?select=id,container_number&id=in.(${shipmentIds})`
  }) : [];
  const byShipment = new Map((shipments || []).map(item => [String(item.id), item]));

  const loadIds = inFilter(loads.map(item => item.id));
  const loadItems = loadIds ? await supabase('load_items', { query:`?select=id,load_id&load_id=in.(${loadIds})` }) : [];
  const loadByItem = new Map((loadItems || []).map(item => [String(item.id), String(item.load_id)]));

  const loadItemIds = inFilter((loadItems || []).map(item => item.id));
  const allocations = loadItemIds ? await supabase('load_allocations', {
    query:`?select=load_item_id,receipt_item_id&load_item_id=in.(${loadItemIds})`
  }) : [];

  const receiptItemIds = inFilter((allocations || []).map(item => item.receipt_item_id));
  const receiptItems = receiptItemIds ? await supabase('warehouse_receipt_items', {
    query:`?select=id,receipt_id&id=in.(${receiptItemIds})`
  }) : [];
  const receiptByItem = new Map((receiptItems || []).map(item => [String(item.id), String(item.receipt_id)]));

  const receiptIds = inFilter((receiptItems || []).map(item => item.receipt_id));
  const receipts = receiptIds ? await supabase('warehouse_receipts', {
    query:`?select=id,receipt_number&id=in.(${receiptIds})`
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
      load_id:load.id,
      load_number:load.load_number,
      load_status:load.status,
      client_id:load.client_id || null,
      importer_id:load.importer_id || null,
      shipment_id:load.shipment_id || null,
      container_number:shipment?.container_number || null,
      receipt_numbers:[...(receiptNumbersByLoad.get(String(load.id)) || [])].sort(),
      updated_at:load.updated_at || null
    };
  });
}

async function loadPurchaseLinks() {
  const [orders, progress, receipts, allocations] = await Promise.all([
    paged('purchase_orders','?select=id,po_number,supplier_id,warehouse_id,status,order_date,expected_at,updated_at&order=updated_at.desc'),
    paged('purchase_order_progress','?select=purchase_order_id,receipt_status,has_excess'),
    paged('warehouse_receipts','?select=id,receipt_number,supplier_id,warehouse_id,status,received_at,updated_at&order=received_at.desc'),
    paged('purchase_receipt_allocations','?select=purchase_order_item_id,receipt_item_id,purchase_order_item:purchase_order_items(purchase_order_id),receipt_item:warehouse_receipt_items(receipt_id)')
  ]);

  const progressByOrder = new Map(progress.map(item => [String(item.purchase_order_id), item]));
  const receiptById = new Map(receipts.map(item => [String(item.id), item]));
  const receiptsByOrder = new Map();

  allocations.forEach(allocation => {
    const orderId = allocation.purchase_order_item?.purchase_order_id;
    const receiptId = allocation.receipt_item?.receipt_id;
    const receipt = receiptById.get(String(receiptId || ''));
    if (!orderId || !receipt) return;
    const key = String(orderId);
    if (!receiptsByOrder.has(key)) receiptsByOrder.set(key, new Map());
    receiptsByOrder.get(key).set(String(receipt.id), receipt);
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

  return { purchases, receipts };
}

async function loadSalesLinks(loadLinks) {
  const [orders, items, allocations, directRows] = await Promise.all([
    paged('sales_orders','?select=id,so_number,client_id,importer_id,status,order_date,requested_at,updated_at&order=updated_at.desc'),
    paged('sales_order_items','?select=id,sales_order_id'),
    paged('sales_fulfillment_allocations','?select=sales_order_item_id,load_item_id'),
    paged('shipment_direct_supply_contents','?select=sales_order_id,shipment_id,container_number,po_number,direct_dispatched_at,client_id,importer_id')
  ]);

  if (!orders.length) return { sales:[], links:loadLinks.map(link => ({ ...link, sales_orders:[] })) };

  const loadItems = await paged('load_items','?select=id,load_id');
  const orderByItem = new Map(items.map(item => [String(item.id), String(item.sales_order_id)]));
  const loadByItem = new Map(loadItems.map(item => [String(item.id), String(item.load_id)]));
  const linkByLoad = new Map(loadLinks.map(link => [String(link.load_id), link]));
  const loadIdsByOrder = new Map();
  const orderIdsByLoad = new Map();

  allocations.forEach(allocation => {
    const orderId = orderByItem.get(String(allocation.sales_order_item_id));
    const loadId = loadByItem.get(String(allocation.load_item_id));
    if (!orderId || !loadId) return;
    if (!loadIdsByOrder.has(orderId)) loadIdsByOrder.set(orderId, new Set());
    if (!orderIdsByLoad.has(loadId)) orderIdsByLoad.set(loadId, new Set());
    loadIdsByOrder.get(orderId).add(loadId);
    orderIdsByLoad.get(loadId).add(orderId);
  });

  const directByOrder = new Map();
  directRows.forEach(row => {
    if (!row.sales_order_id || !row.shipment_id) return;
    const key = String(row.sales_order_id);
    if (!directByOrder.has(key)) directByOrder.set(key,new Map());
    const bucket = directByOrder.get(key);
    if (!bucket.has(String(row.shipment_id))) bucket.set(String(row.shipment_id),{
      shipment_id:row.shipment_id,
      container_number:row.container_number || null,
      po_numbers:new Set(),
      dispatched_at:row.direct_dispatched_at || null
    });
    const target=bucket.get(String(row.shipment_id));
    if (row.po_number) target.po_numbers.add(row.po_number);
    if (row.direct_dispatched_at && !target.dispatched_at) target.dispatched_at=row.direct_dispatched_at;
  });

  const orderById = new Map(orders.map(order => [String(order.id), order]));
  const snapshotOrder = order => ({
    sales_order_id:order.id,
    so_number:order.so_number,
    so_status:order.status,
    client_id:order.client_id,
    importer_id:order.importer_id || null,
    order_date:order.order_date || null,
    requested_at:order.requested_at || null,
    updated_at:order.updated_at || null
  });
  const snapshotLoad = link => ({
    load_id:link.load_id,
    load_number:link.load_number,
    load_status:link.load_status,
    shipment_id:link.shipment_id || null,
    container_number:link.container_number || null,
    receipt_numbers:Array.isArray(link.receipt_numbers) ? link.receipt_numbers : [],
    updated_at:link.updated_at || null
  });

  const sales = orders.map(order => ({
    ...snapshotOrder(order),
    loads:[...(loadIdsByOrder.get(String(order.id)) || [])]
      .map(loadId => linkByLoad.get(String(loadId)))
      .filter(Boolean)
      .map(snapshotLoad),
    direct_shipments:[...(directByOrder.get(String(order.id))?.values() || [])].map(row=>({
      shipment_id:row.shipment_id,
      container_number:row.container_number,
      po_numbers:[...row.po_numbers],
      dispatched_at:row.dispatched_at
    }))
  }));

  const enrichedLinks = loadLinks.map(link => ({
    ...link,
    sales_orders:[...(orderIdsByLoad.get(String(link.load_id)) || [])]
      .map(orderId => orderById.get(String(orderId)))
      .filter(Boolean)
      .map(snapshotOrder)
  }));

  return { sales, links:enrichedLinks };
}

async function loadFinanceLinks() {
  const [invoices,bills] = await Promise.all([
    paged('invoices','?select=id,invoice_number,sales_order_id,status,issue_date,due_date,created_at&order=created_at.desc'),
    paged('supplier_bills','?select=id,bill_number,purchase_order_id,supplier_id,status,bill_date,due_date,created_at&order=created_at.desc')
  ]);
  return {
    invoices:invoices.map(row=>({
      invoice_id:row.id,
      invoice_number:row.invoice_number,
      sales_order_id:row.sales_order_id,
      status:row.status,
      issue_date:row.issue_date || null,
      due_date:row.due_date || null,
      created_at:row.created_at || null
    })),
    supplier_bills:bills.map(row=>({
      supplier_bill_id:row.id,
      bill_number:row.bill_number,
      purchase_order_id:row.purchase_order_id,
      supplier_id:row.supplier_id,
      status:row.status,
      bill_date:row.bill_date || null,
      due_date:row.due_date || null,
      created_at:row.created_at || null
    }))
  };
}

export default async function handler(req, res) {
  const admin = await authenticateAdmin(req,res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res,405,'Método no permitido');

  try {
    const access = admin.role === 'master_admin' ? { permissions:['*'] } : await loadAdminAccessContext(admin.admin_id);
    const permissions = new Set(access.permissions || []);
    const can = key => admin.role === 'master_admin' || permissions.has(key);
    const canLogistics = can('logistics.read');
    const canWarehouse = can('warehouse.read');
    const canProcurement = can('procurement.read');
    const canSales = can('sales.read');
    const canFinance = can('finance.read');

    if (!canLogistics && !canWarehouse && !canProcurement && !canSales && !canFinance) {
      return ok(res,{ links:[],purchases:[],receipts:[],sales:[],invoices:[],supplier_bills:[] });
    }

    const needLoads = canLogistics || canWarehouse || canSales;
    const [baseLinks,purchaseData,financeData] = await Promise.all([
      needLoads ? loadLoadLinks() : Promise.resolve([]),
      (canProcurement || canWarehouse) ? loadPurchaseLinks() : Promise.resolve({purchases:[],receipts:[]}),
      canFinance ? loadFinanceLinks() : Promise.resolve({invoices:[],supplier_bills:[]})
    ]);
    const salesData = canSales
      ? await loadSalesLinks(baseLinks)
      : { sales:[],links:baseLinks.map(link=>({...link,sales_orders:[]})) };

    return ok(res,{
      links:salesData.links,
      purchases:purchaseData.purchases,
      receipts:purchaseData.receipts,
      sales:salesData.sales,
      invoices:financeData.invoices,
      supplier_bills:financeData.supplier_bills
    });
  } catch (error) {
    console.error('[operational-links]',error);
    return fail(res,400,error.message || 'No se pudieron resolver los enlaces operativos');
  }
}
