import { fail, ok, requireAdmin, supabase } from './_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const unique = values => [...new Set((values || []).filter(Boolean).map(value => String(value)))];
const inFilter = values => unique(values).join(',');

function requiredUuid(value) {
  const id = text(value, 80);
  if (!UUID_RE.test(id)) throw new Error('SALES_WORKSPACE_ID_INVALID');
  return id;
}

async function rows(path, query) {
  const result = await supabase(path, { query });
  return Array.isArray(result) ? result : [];
}

function mergeItems(items, fulfillmentProgress, invoiceProgress) {
  const fulfillmentById = new Map(fulfillmentProgress.map(row => [String(row.sales_order_item_id), row]));
  const invoiceById = new Map(invoiceProgress.map(row => [String(row.sales_order_item_id), row]));
  return items.map(item => ({
    ...item,
    fulfillment:fulfillmentById.get(String(item.id)) || null,
    invoicing:invoiceById.get(String(item.id)) || null
  }));
}

function mergeInvoices(invoices, financialProgress, invoiceItems) {
  const financialById = new Map(financialProgress.map(row => [String(row.invoice_id), row]));
  const itemsByInvoice = new Map();
  for (const item of invoiceItems) {
    const key = String(item.invoice_id);
    if (!itemsByInvoice.has(key)) itemsByInvoice.set(key, []);
    itemsByInvoice.get(key).push(item);
  }
  return invoices.map(invoice => ({
    ...invoice,
    financial:financialById.get(String(invoice.id)) || null,
    items:itemsByInvoice.get(String(invoice.id)) || []
  }));
}

async function workspace(salesOrderId) {
  const summaryRows = await rows('sales_order_workspace_summary', `?select=*&sales_order_id=eq.${salesOrderId}&limit=1`);
  const summary = summaryRows[0] || null;
  if (!summary) return null;

  const [items, itemProgress, itemInvoiceProgress, logistics, documents, invoices, invoiceFinancial] = await Promise.all([
    rows('sales_order_items', { toString:null }),
    rows('sales_order_item_progress', `?select=*&sales_order_id=eq.${salesOrderId}&order=sales_order_item_id.asc&limit=5000`),
    rows('sales_order_item_invoice_progress', `?select=*&sales_order_id=eq.${salesOrderId}&order=sales_order_item_id.asc&limit=5000`),
    rows('sales_order_workspace_logistics', `?select=*&sales_order_id=eq.${salesOrderId}&order=load_number.asc&limit=5000`),
    rows('sales_order_workspace_documents', `?select=*&sales_order_id=eq.${salesOrderId}&order=created_at.desc&limit=5000`),
    rows('invoices', `?select=id,invoice_number,invoice_serial,sales_order_id,operation_id,client_id,issue_date,due_date,currency,status,notes,created_at,updated_at&sales_order_id=eq.${salesOrderId}&order=created_at.asc&limit=1000`),
    rows('invoice_financial_progress', `?select=*&sales_order_id=eq.${salesOrderId}&order=issue_date.asc&limit=1000`)
  ]);

  const itemRows = await rows('sales_order_items', `?select=id,sales_order_id,product_id,ordered_quantity,ordered_pallets,unit,units_per_pallet,unit_price,entered_line_total,notes,created_at,updated_at,product:products(id,sku,name,brand,category,unit,package_format,default_units_per_pallet)&sales_order_id=eq.${salesOrderId}&order=created_at.asc&limit=5000`);
  const itemIds = unique(itemRows.map(row => row.id));
  const invoiceIds = unique(invoices.map(row => row.id));
  const operationIds = unique([
    ...logistics.map(row => row.operation_id),
    ...invoices.map(row => row.operation_id)
  ]);

  const invoiceItemsPromise = invoiceIds.length
    ? rows('invoice_items', `?select=id,invoice_id,sales_order_item_id,product_id,description,quantity,unit,unit_price,line_total,notes,created_at&invoice_id=in.(${inFilter(invoiceIds)})&order=created_at.asc&limit=5000`)
    : Promise.resolve([]);

  const invoicePaymentsPromise = invoiceIds.length
    ? rows('payments', `?select=id,operation_id,invoice_id,client_id,amount,currency,payment_date,method,reference_number,status,notes,created_at&invoice_id=in.(${inFilter(invoiceIds)})&order=payment_date.desc,created_at.desc&limit=5000`)
    : Promise.resolve([]);

  const contextualOperationPaymentsPromise = operationIds.length
    ? rows('payments', `?select=id,operation_id,invoice_id,client_id,amount,currency,payment_date,method,reference_number,status,notes,created_at&invoice_id=is.null&operation_id=in.(${inFilter(operationIds)})&order=payment_date.desc,created_at.desc&limit=5000`)
    : Promise.resolve([]);

  let directCostsPromise = Promise.resolve([]);
  if (itemIds.length) {
    directCostsPromise = rows(
      'cost_charge_allocations',
      `?select=id,cost_charge_id,amount,basis,sales_order_id,sales_order_item_id,notes,created_at,cost_charge:cost_charges(id,cost_number,category,stage,amount,currency,incurred_date,supplier_id,reference,status,notes,posted_at,voided_at)&or=(sales_order_id.eq.${salesOrderId},sales_order_item_id.in.(${inFilter(itemIds)}))&order=created_at.asc&limit=5000`
    );
  } else {
    directCostsPromise = rows(
      'cost_charge_allocations',
      `?select=id,cost_charge_id,amount,basis,sales_order_id,sales_order_item_id,notes,created_at,cost_charge:cost_charges(id,cost_number,category,stage,amount,currency,incurred_date,supplier_id,reference,status,notes,posted_at,voided_at)&sales_order_id=eq.${salesOrderId}&order=created_at.asc&limit=5000`
    );
  }

  const operationDetailsPromise = operationIds.length
    ? rows('operations', `?select=id,operation_code,client_id,importer_id,operation_type,status,incoterm,currency,origin_port,destination_port,vessel_name,voyage_number,booking_number,bol_number,container_number,seal_number,etd,eta,notes,created_at,updated_at&delete=never&limit=1`)
    : Promise.resolve([]);

  const [invoiceItems, invoicePayments, contextualOperationPayments, directCosts] = await Promise.all([
    invoiceItemsPromise,
    invoicePaymentsPromise,
    contextualOperationPaymentsPromise,
    directCostsPromise
  ]);

  const operationDetails = operationIds.length
    ? await rows('operations', `?select=id,operation_code,client_id,importer_id,operation_type,status,incoterm,currency,origin_port,destination_port,vessel_name,voyage_number,booking_number,bol_number,container_number,seal_number,etd,eta,notes,created_at,updated_at&id=in.(${inFilter(operationIds)})&order=created_at.asc&limit=1000`)
    : [];

  const auditEntityIds = unique([
    salesOrderId,
    ...itemIds,
    ...logistics.flatMap(row => [row.load_id, row.shipment_id, row.operation_id]),
    ...invoiceIds,
    ...directCosts.flatMap(row => [row.cost_charge_id])
  ]);
  const history = auditEntityIds.length
    ? await rows('audit_log', `?select=id,action,entity_type,entity_id,details,created_at,actor_admin_id,actor_username&entity_id=in.(${inFilter(auditEntityIds)})&order=created_at.desc&limit=1000`)
    : [];

  return {
    summary,
    items:mergeItems(itemRows, itemProgress, itemInvoiceProgress),
    logistics,
    operations:operationDetails,
    billing:{
      invoices:mergeInvoices(invoices, invoiceFinancial, invoiceItems),
      invoice_payments:invoicePayments,
      contextual_operation_payments:contextualOperationPayments
    },
    costs:{
      allocations:directCosts
    },
    documents,
    history
  };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const salesOrderId = requiredUuid(req.query?.sales_order_id || req.query?.id);
    const data = await workspace(salesOrderId);
    if (!data) return fail(res, 404, 'Sales Order no encontrada');
    return ok(res, { workspace:data });
  } catch (error) {
    const raw = String(error.message || 'No se pudo cargar el workspace de la venta');
    console.error('[sales-workspace]', error);
    if (raw.includes('SALES_WORKSPACE_ID_INVALID')) return fail(res, 400, 'Sales Order inválida');
    return fail(res, 400, raw);
  }
}
