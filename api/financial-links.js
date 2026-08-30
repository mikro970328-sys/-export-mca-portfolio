import { authorizeAdmin, fail, ok, supabase } from './_lib.js';

async function loadInvoices() {
  const [invoices, financial, payments] = await Promise.all([
    supabase('invoices', { query:'?select=id,invoice_number,sales_order_id,client_id,issue_date,due_date,currency,status,created_at,updated_at,sales_order:sales_orders(id,so_number,status,client_id,customer_reference),client:clients(id,name,company,mipyme_name)&order=created_at.desc&limit=2000' }),
    supabase('invoice_financial_progress', { query:'?select=invoice_id,total,paid_amount,balance_due,payment_status,issue_date,due_date&order=issue_date.desc&limit=2000' }),
    supabase('payments', { query:'?select=id,invoice_id,amount,currency,payment_date,method,reference_number,status,created_at&order=payment_date.desc,created_at.desc&limit=10000' })
  ]);

  const financialByInvoice = new Map((financial || []).map(row => [String(row.invoice_id), row]));
  const paymentsByInvoice = new Map();
  for (const payment of payments || []) {
    const key = String(payment.invoice_id || '');
    if (!key) continue;
    if (!paymentsByInvoice.has(key)) paymentsByInvoice.set(key, []);
    paymentsByInvoice.get(key).push(payment);
  }

  return (invoices || []).map(invoice => ({
    invoice_id:invoice.id,
    invoice_number:invoice.invoice_number,
    sales_order_id:invoice.sales_order_id,
    so_number:invoice.sales_order?.so_number || null,
    so_status:invoice.sales_order?.status || null,
    client_id:invoice.client_id,
    client_name:invoice.client?.company || invoice.client?.mipyme_name || invoice.client?.name || null,
    issue_date:invoice.issue_date || null,
    due_date:invoice.due_date || null,
    currency:invoice.currency,
    invoice_status:invoice.status,
    customer_reference:invoice.sales_order?.customer_reference || null,
    financial:financialByInvoice.get(String(invoice.id)) || null,
    payments:paymentsByInvoice.get(String(invoice.id)) || [],
    updated_at:invoice.updated_at || null
  }));
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, 'finance.read');
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const invoices = await loadInvoices();
    return ok(res, { invoices });
  } catch (error) {
    console.error('[financial-links]', error);
    return fail(res, 400, error.message || 'No se pudo cargar la trazabilidad financiera');
  }
}
