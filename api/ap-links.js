import { fail, ok, requireAdmin, supabase } from './_lib.js';

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

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const [orders, bills, billProgress, payments, paymentProgress, applications, receipts, receiptAllocations] = await Promise.all([
      paged('purchase_orders', '?select=id,po_number,supplier_id,status,currency,updated_at&order=updated_at.desc'),
      paged('supplier_bills', '?select=id,bill_number,purchase_order_id,supplier_id,supplier_invoice_number,bill_date,due_date,currency,status,created_at,updated_at&order=created_at.desc'),
      paged('supplier_bill_financial_progress', '?select=*'),
      paged('supplier_payments', '?select=id,payment_number,purchase_order_id,supplier_id,amount,currency,payment_date,method,reference,status,created_at&order=payment_date.desc,created_at.desc'),
      paged('supplier_payment_progress', '?select=*'),
      paged('supplier_payment_applications', '?select=supplier_payment_id,supplier_bill_id,amount,created_at'),
      paged('warehouse_receipts', '?select=id,receipt_number,status,received_at'),
      paged('purchase_receipt_allocations', '?select=purchase_order_item:purchase_order_items(purchase_order_id),receipt_item:warehouse_receipt_items(receipt_id)')
    ]);

    const orderById = new Map(orders.map(row => [String(row.id), row]));
    const receiptById = new Map(receipts.map(row => [String(row.id), row]));
    const receiptsByOrder = new Map();
    receiptAllocations.forEach(allocation => {
      const orderId = allocation.purchase_order_item?.purchase_order_id;
      const receiptId = allocation.receipt_item?.receipt_id;
      const receipt = receiptById.get(String(receiptId || ''));
      if (!orderId || !receipt) return;
      const key = String(orderId);
      if (!receiptsByOrder.has(key)) receiptsByOrder.set(key, new Map());
      receiptsByOrder.get(key).set(String(receipt.id), receipt);
    });

    const receiptSnapshots = orderId => [...(receiptsByOrder.get(String(orderId))?.values() || [])]
      .sort((a,b) => String(b.received_at || '').localeCompare(String(a.received_at || '')))
      .map(row => ({ receipt_id:row.id, receipt_number:row.receipt_number, receipt_status:row.status, received_at:row.received_at || null }));

    const billProgressById = new Map(billProgress.map(row => [String(row.supplier_bill_id), row]));
    const paymentProgressById = new Map(paymentProgress.map(row => [String(row.supplier_payment_id), row]));
    const appsByBill = new Map();
    const appsByPayment = new Map();
    applications.forEach(app => {
      const billKey = String(app.supplier_bill_id);
      const paymentKey = String(app.supplier_payment_id);
      if (!appsByBill.has(billKey)) appsByBill.set(billKey, []);
      if (!appsByPayment.has(paymentKey)) appsByPayment.set(paymentKey, []);
      appsByBill.get(billKey).push(app);
      appsByPayment.get(paymentKey).push(app);
    });

    const paymentById = new Map(payments.map(row => [String(row.id), row]));
    const billById = new Map(bills.map(row => [String(row.id), row]));

    const billRows = bills.map(bill => {
      const order = orderById.get(String(bill.purchase_order_id)) || null;
      return {
        supplier_bill_id:bill.id,
        bill_number:bill.bill_number,
        supplier_invoice_number:bill.supplier_invoice_number || null,
        bill_status:bill.status,
        bill_date:bill.bill_date || null,
        due_date:bill.due_date || null,
        currency:bill.currency,
        supplier_id:bill.supplier_id,
        purchase_order_id:bill.purchase_order_id,
        po_number:order?.po_number || null,
        financial:billProgressById.get(String(bill.id)) || null,
        receipts:receiptSnapshots(bill.purchase_order_id),
        payments:(appsByBill.get(String(bill.id)) || []).map(app => {
          const payment = paymentById.get(String(app.supplier_payment_id));
          return payment ? { supplier_payment_id:payment.id, payment_number:payment.payment_number, payment_status:payment.status, amount:app.amount } : null;
        }).filter(Boolean)
      };
    });

    const paymentRows = payments.map(payment => {
      const order = orderById.get(String(payment.purchase_order_id)) || null;
      return {
        supplier_payment_id:payment.id,
        payment_number:payment.payment_number,
        payment_status:payment.status,
        amount:payment.amount,
        currency:payment.currency,
        payment_date:payment.payment_date || null,
        method:payment.method || null,
        reference:payment.reference || null,
        supplier_id:payment.supplier_id,
        purchase_order_id:payment.purchase_order_id,
        po_number:order?.po_number || null,
        progress:paymentProgressById.get(String(payment.id)) || null,
        receipts:receiptSnapshots(payment.purchase_order_id),
        bills:(appsByPayment.get(String(payment.id)) || []).map(app => {
          const bill = billById.get(String(app.supplier_bill_id));
          return bill ? { supplier_bill_id:bill.id, bill_number:bill.bill_number, bill_status:bill.status, amount:app.amount } : null;
        }).filter(Boolean)
      };
    });

    const purchaseRows = orders.map(order => ({
      purchase_order_id:order.id,
      po_number:order.po_number,
      po_status:order.status,
      supplier_id:order.supplier_id,
      currency:order.currency,
      receipts:receiptSnapshots(order.id)
    }));

    return ok(res, { owner:'api/ap-links.js', bills:billRows, payments:paymentRows, purchases:purchaseRows });
  } catch (error) {
    console.error('[ap-links]', error);
    return fail(res, 400, error.message || 'No se pudo resolver la trazabilidad de Cuentas por pagar');
  }
}
