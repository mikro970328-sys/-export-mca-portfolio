import { fail, ok, requireAdmin, supabase } from './_lib.js';

async function bootstrap() {
  const [salesOrders, invoices, loads, operations, operationDirect, salesTrace, invoiceTrace, chargeTrace, products, clients] = await Promise.all([
    supabase('sales_order_profitability', { query:'?select=*&order=so_number.desc&limit=3000' }),
    supabase('issued_invoice_profitability', { query:'?select=*&order=issue_date.desc,invoice_number.desc&limit=3000' }),
    supabase('load_profitability', { query:'?select=*&order=load_number.desc&limit=3000' }),
    supabase('operation_profitability', { query:'?select=*&order=operation_code.desc&limit=3000' }),
    supabase('operation_descendant_direct_costs', { query:'?select=*&order=operation_code.desc,currency.asc&limit=10000' }),
    supabase('sales_order_cost_traceability', { query:'?select=*&order=so_number.desc&limit=20000' }),
    supabase('issued_invoice_cost_traceability', { query:'?select=*&order=issue_date.desc,invoice_number.desc&limit=20000' }),
    supabase('posted_cost_charge_traceability', { query:'?select=*&order=incurred_date.desc,cost_number.desc&limit=20000' }),
    supabase('products', { query:'?select=id,sku,name,brand&order=name.asc&limit=5000' }),
    supabase('clients', { query:'?select=id,name,company,mipyme_name&order=name.asc&limit=3000' })
  ]);

  return {
    profitability: {
      sales_orders:salesOrders || [],
      invoices:invoices || [],
      loads:loads || [],
      operations:operations || [],
      operation_direct_costs:operationDirect || []
    },
    traceability: {
      sales_orders:salesTrace || [],
      invoices:invoiceTrace || [],
      cost_charges:chargeTrace || []
    },
    masters: { products:products || [], clients:clients || [] }
  };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');
  try {
    return ok(res, await bootstrap());
  } catch (error) {
    console.error('[profitability]', error);
    return fail(res, 500, 'No se pudo cargar la rentabilidad');
  }
}
