import { authorizeAdmin, fail, ok, supabase } from './_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cleanId = (value, label) => {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw new Error(`${label} inválido`);
  return id;
};

async function one(table, query, message) {
  const rows = await supabase(table, { query });
  if (!rows?.[0]) throw new Error(message);
  return rows[0];
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, 'finance.read');
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const invoiceId = String(req.query?.invoice_id || '').trim();
    const salesOrderId = String(req.query?.sales_order_id || '').trim();
    if (!invoiceId && !salesOrderId) return fail(res, 400, 'Indica la factura o la Sales Order');

    let invoice = null;
    let order = null;
    if (invoiceId) {
      invoice = await one(
        'invoices',
        `?select=id,sales_order_id,operation_id,client_id,status&id=eq.${encodeURIComponent(cleanId(invoiceId, 'Factura'))}&limit=1`,
        'Factura no encontrada'
      );
      order = await one(
        'sales_orders',
        `?select=id,so_number,client_id,status&id=eq.${encodeURIComponent(invoice.sales_order_id)}&limit=1`,
        'Sales Order de la factura no encontrada'
      );
    } else {
      order = await one(
        'sales_orders',
        `?select=id,so_number,client_id,status&id=eq.${encodeURIComponent(cleanId(salesOrderId, 'Sales Order'))}&limit=1`,
        'Sales Order no encontrada'
      );
    }

    const operations = await supabase('operations', {
      query:`?select=id,operation_code,status,origin_port,destination_port,booking_number,bol_number,container_number,notes,created_at&client_id=eq.${encodeURIComponent(order.client_id)}&order=created_at.desc&limit=500`
    }) || [];

    return ok(res, {
      sales_order:{ id:order.id, so_number:order.so_number, client_id:order.client_id, status:order.status },
      invoice:invoice ? { id:invoice.id, status:invoice.status, operation_id:invoice.operation_id || null } : null,
      selected_operation_id:invoice?.operation_id || null,
      operations
    });
  } catch (error) {
    console.error('[invoice-expediente-context]', error);
    return fail(res, 400, error.message || 'No se pudo cargar los Expedientes de la factura');
  }
}
