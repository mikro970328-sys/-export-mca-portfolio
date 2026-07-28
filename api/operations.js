import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const select = [
  '*',
  'client:clients(id,name,company,phone,email)',
  'supplier:suppliers(id,name,email,phone)',
  'importer:importers(id,name,email,phone)',
  'shipment:shipments(id,container_number,booking_number,bol_number,carrier,operational_status)',
  'items:operation_items(id,product_id,description,quantity,unit,unit_cost,unit_price,total_cost,total_price,net_weight_kg,gross_weight_kg,volume_m3,product:products(id,name,sku,hs_code))',
  'invoices(id,invoice_number,issue_date,due_date,currency,total_amount,status,notes,payments(id,amount,payment_date,method,reference,notes))',
  'expenses(id,expense_date,category,description,amount,currency,vendor,reference,notes)',
  'documents(id,document_type,file_name,file_url,storage_path,notes,created_at)'
].join(',');

function required(value, name) {
  if (!String(value || '').trim()) throw new Error(`${name}_REQUIRED`);
  return String(value).trim();
}

function cleanNullable(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const id = cleanNullable(req.query?.id);
      const query = id
        ? `?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(id)}&limit=1`
        : `?select=${encodeURIComponent(select)}&order=created_at.desc`;
      const rows = await supabase('operations', { query });
      return ok(res, id ? { operation: rows?.[0] || null } : { operations: rows || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const operation = {
        client_id: required(body.client_id, 'CLIENT'),
        supplier_id: cleanNullable(body.supplier_id),
        importer_id: cleanNullable(body.importer_id),
        shipment_id: cleanNullable(body.shipment_id),
        title: required(body.title, 'TITLE'),
        status: cleanNullable(body.status) || 'draft',
        currency: cleanNullable(body.currency) || 'USD',
        incoterm: cleanNullable(body.incoterm),
        origin_port: cleanNullable(body.origin_port),
        destination_port: cleanNullable(body.destination_port),
        etd: cleanNullable(body.etd),
        eta: cleanNullable(body.eta),
        notes: cleanNullable(body.notes),
        created_by: admin.admin_id
      };
      const created = await supabase('operations', { method: 'POST', body: operation });
      const row = created?.[0];
      await writeAudit(admin, 'create', 'operation', row?.id, { title: row?.title });
      return ok(res, { operation: row });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = required(body.id, 'ID');
      const allowed = ['client_id','supplier_id','importer_id','shipment_id','title','status','currency','incoterm','origin_port','destination_port','etd','eta','notes'];
      const updates = Object.fromEntries(allowed.filter(k => body[k] !== undefined).map(k => [k, body[k] === '' ? null : body[k]]));
      const rows = await supabase('operations', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}`, body: updates, prefer: 'return=representation' });
      await writeAudit(admin, 'update', 'operation', id, updates);
      return ok(res, { operation: rows?.[0] || null });
    }

    if (req.method === 'DELETE') {
      const id = required(req.query?.id, 'ID');
      await supabase('operations', { method: 'DELETE', query: `?id=eq.${encodeURIComponent(id)}` });
      await writeAudit(admin, 'delete', 'operation', id);
      return ok(res, { deleted: true });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('OPERATIONS_API_ERROR', error);
    return fail(res, 400, 'No se pudo procesar la operación', error.message);
  }
}
