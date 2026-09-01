import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';
import { loadSupplierApCapabilityMaps, loadSupplierBillCapabilities } from './_supplier-ap-actions.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);

function translatedError(raw) {
  const messages = [
    ['PERMISSION_REQUIRED','No tienes permiso para ejecutar esta acción financiera.'],
    ['SUPPLIER_BILL_PO_NOT_FOUND','Purchase Order no encontrada.'],
    ['SUPPLIER_BILL_PO_NOT_BILLABLE','La Purchase Order debe estar emitida, confirmada o cerrada.'],
    ['SUPPLIER_BILL_HAS_NO_ITEMS','Agrega al menos una línea a la factura del proveedor.'],
    ['SUPPLIER_BILL_PO_ITEM_REQUIRED','Falta una línea de Purchase Order.'],
    ['SUPPLIER_BILL_QUANTITY_INVALID','La cantidad facturada debe ser mayor que cero.'],
    ['SUPPLIER_BILL_UNIT_COST_INVALID','El costo unitario no es válido.'],
    ['SUPPLIER_BILL_LINE_TOTAL_INVALID','El total facturado no es válido.'],
    ['SUPPLIER_BILL_COST_REQUIRED','Indica el costo unitario o el total facturado de la línea.'],
    ['SUPPLIER_BILL_EXCEEDS_PO_QUANTITY','La cantidad supera lo disponible por facturar en la Purchase Order.'],
    ['SUPPLIER_BILL_NOT_FOUND','Factura de proveedor no encontrada.'],
    ['SUPPLIER_BILL_NOT_DRAFT','Solo una factura en borrador puede editarse o contabilizarse.'],
    ['SUPPLIER_BILL_ITEMS_LOCKED','Las líneas de una factura contabilizada no pueden modificarse.'],
    ['SUPPLIER_BILL_HEADER_LOCKED','La factura contabilizada ya no puede modificarse.'],
    ['SUPPLIER_BILL_INVOICE_NUMBER_REQUIRED','Indica el número de factura del proveedor antes de contabilizar.'],
    ['SUPPLIER_BILL_HAS_ACTIVE_PAYMENTS','Revierte o desasigna primero los pagos aplicados antes de anular.'],
    ['SUPPLIER_BILL_ALREADY_PAID','Esta factura ya está completamente pagada.'],
    ['SUPPLIER_BILL_NOT_POSTED','Solo se puede pagar una factura contabilizada.'],
    ['SUPPLIER_BILL_CANNOT_VOID','La factura no puede anularse en su estado actual.'],
    ['SUPPLIER_BILL_ACTION_INVALID','Acción de factura de proveedor inválida.'],
    ['SUPPLIER_BILL_ACTION_NOT_ALLOWED','La acción ya no está disponible para esta factura.']
  ];
  return messages.find(([key]) => raw.includes(key))?.[1] || raw;
}

function cleanLines(lines) {
  if (!Array.isArray(lines) || !lines.length) throw new Error('Agrega al menos una línea a la factura del proveedor');
  return lines.map((line, index) => {
    const purchaseOrderItemId = text(line.purchase_order_item_id, 80);
    const billedQuantity = text(line.billed_quantity, 80);
    const unitCost = text(line.unit_cost, 80);
    const lineTotal = text(line.line_total, 80);
    if (!purchaseOrderItemId) throw new Error(`Falta la línea ${index + 1} de la Purchase Order`);
    if (!billedQuantity || Number(billedQuantity) <= 0) throw new Error(`Indica una cantidad válida en la línea ${index + 1}`);
    if (lineTotal !== '' && Number(lineTotal) < 0) throw new Error(`Indica un total facturado válido en la línea ${index + 1}`);
    if (lineTotal === '' && (unitCost === '' || Number(unitCost) < 0)) throw new Error(`Indica costo unitario o total facturado en la línea ${index + 1}`);
    return {
      purchase_order_item_id:purchaseOrderItemId,
      billed_quantity:billedQuantity,
      unit_cost:lineTotal === '' ? unitCost : null,
      line_total:lineTotal === '' ? null : lineTotal,
      notes:text(line.notes,1000) || null
    };
  });
}

async function loadBills(capabilityMap = new Map()) {
  const [bills, items, financial] = await Promise.all([
    supabase('supplier_bills', { query:'?select=id,bill_number,purchase_order_id,supplier_id,supplier_invoice_number,bill_date,due_date,currency,status,notes,posted_at,voided_at,created_at,updated_at,supplier:suppliers(id,name,legal_name),purchase_order:purchase_orders(id,po_number,status,supplier_reference)&order=created_at.desc&limit=1000' }),
    supabase('supplier_bill_items', { query:'?select=id,supplier_bill_id,purchase_order_item_id,product_id,unit,billed_quantity,po_unit_cost_snapshot,unit_cost,entered_line_total,currency,line_total,notes,product:products(id,sku,name,brand)&order=created_at.asc&limit=5000' }),
    supabase('supplier_bill_financial_progress', { query:'?select=*&order=bill_date.desc&limit=1000' })
  ]);
  const itemsByBill = new Map();
  for (const item of items || []) {
    if (!itemsByBill.has(item.supplier_bill_id)) itemsByBill.set(item.supplier_bill_id, []);
    itemsByBill.get(item.supplier_bill_id).push({ ...item, line_total:item.entered_line_total ?? item.line_total, pricing_mode:item.entered_line_total == null ? 'unit' : 'total' });
  }
  const financialByBill = new Map((financial || []).map(row => [row.supplier_bill_id,row]));
  return (bills || []).map(bill => ({
    ...bill,
    items:itemsByBill.get(bill.id) || [],
    financial:financialByBill.get(bill.id) || null,
    capabilities:capabilityMap.get(String(bill.id)) || { actions:{} }
  }));
}

async function loadPurchaseOrders() {
  const [orders, items, progress] = await Promise.all([
    supabase('purchase_orders', { query:'?select=id,po_number,supplier_id,status,currency,supplier_reference,order_date,supplier:suppliers(id,name,legal_name)&status=in.(issued,confirmed,closed)&order=created_at.desc&limit=1000' }),
    supabase('purchase_order_items', { query:'?select=id,purchase_order_id,product_id,ordered_quantity,unit,unit_cost,currency,product:products(id,sku,name,brand)&order=created_at.asc&limit=5000' }),
    supabase('purchase_order_ap_item_progress', { query:'?select=*&limit=5000' })
  ]);
  const progressByItem = new Map((progress || []).map(row => [row.purchase_order_item_id,row]));
  const itemsByOrder = new Map();
  for (const item of items || []) {
    if (!itemsByOrder.has(item.purchase_order_id)) itemsByOrder.set(item.purchase_order_id, []);
    itemsByOrder.get(item.purchase_order_id).push({ ...item, ap_progress:progressByItem.get(item.id) || null });
  }
  return (orders || []).map(order => ({ ...order, items:itemsByOrder.get(order.id) || [] }));
}

async function bootstrap(admin) {
  const capabilities = await loadSupplierApCapabilityMaps(admin);
  const [bills, purchase_orders] = await Promise.all([loadBills(capabilities.bill_capabilities), loadPurchaseOrders()]);
  return { bills, purchase_orders, write_access:capabilities.write_access };
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, req.method === 'GET' ? 'finance.read' : 'finance.write');
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const data = await bootstrap(admin);
      const id = text(req.query?.id,80);
      if (!id) return ok(res,data);
      const bill = data.bills.find(row => String(row.id) === id);
      if (!bill) return fail(res,404,'Factura de proveedor no encontrada');
      return ok(res,{ bill, purchase_orders:data.purchase_orders, write_access:data.write_access });
    }
    if (req.method !== 'POST') return fail(res,405,'Método no permitido');

    const body = await readJson(req);
    const action = text(body.action,60).toLowerCase();

    if (action === 'create_plan') {
      const poId = text(body.purchase_order_id,80);
      if (!poId) throw new Error('Selecciona una Purchase Order');
      const result = await supabase('rpc/create_supplier_bill_plan', { method:'POST', body:{
        p_purchase_order_id:poId,
        p_lines:cleanLines(body.lines),
        p_supplier_invoice_number:text(body.supplier_invoice_number,200) || null,
        p_bill_date:text(body.bill_date,40) || null,
        p_due_date:text(body.due_date,40) || null,
        p_notes:text(body.notes,2000) || null,
        p_actor:admin.admin_id || null
      }});
      const bill = rpcRow(result);
      if (!bill?.id) throw new Error('No se pudo crear la factura del proveedor');
      await writeAudit(admin,'supplier_bill_created','supplier_bill',bill.id,{ bill_number:bill.bill_number, purchase_order_id:poId });
      const loaded=(await loadBills(new Map([[String(bill.id),await loadSupplierBillCapabilities(admin,bill.id)]]))).find(row => row.id === bill.id) || bill;
      return ok(res,{ bill:loaded });
    }

    if (action === 'replace_plan') {
      const billId = text(body.supplier_bill_id,80);
      const poId = text(body.purchase_order_id,80);
      if (!billId || !poId) throw new Error('Falta la factura o la Purchase Order');
      const result = await supabase('rpc/replace_supplier_bill_plan_canonical', { method:'POST', body:{
        p_supplier_bill_id:billId,
        p_purchase_order_id:poId,
        p_lines:cleanLines(body.lines),
        p_supplier_invoice_number:text(body.supplier_invoice_number,200) || null,
        p_bill_date:text(body.bill_date,40) || null,
        p_due_date:text(body.due_date,40) || null,
        p_notes:text(body.notes,2000) || null
      }});
      const bill = rpcRow(result);
      await writeAudit(admin,'supplier_bill_updated','supplier_bill',billId,{ bill_number:bill?.bill_number || null });
      const loaded=(await loadBills(new Map([[String(billId),await loadSupplierBillCapabilities(admin,billId)]]))).find(row => row.id === billId) || bill;
      return ok(res,{ bill:loaded });
    }

    if (action === 'post' || action === 'void') {
      const billId = text(body.supplier_bill_id,80);
      if (!billId) throw new Error('Falta la factura del proveedor');
      const result = await supabase('rpc/transition_supplier_bill_canonical', { method:'POST', body:{ p_supplier_bill_id:billId, p_action:action, p_actor:admin.admin_id || null } });
      const bill = rpcRow(result);
      await writeAudit(admin,`supplier_bill_${action}`,'supplier_bill',billId,{ bill_number:bill?.bill_number || null });
      const loaded=(await loadBills(new Map([[String(billId),await loadSupplierBillCapabilities(admin,billId)]]))).find(row => row.id === billId) || bill;
      return ok(res,{ bill:loaded });
    }

    return fail(res,400,'Acción de Cuentas por pagar no válida');
  } catch (error) {
    const raw = String(error.message || 'No se pudo procesar Cuentas por pagar');
    console.error('[payables]',error);
    return fail(res,400,translatedError(raw));
  }
}