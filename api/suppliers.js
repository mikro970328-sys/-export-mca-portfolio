import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';

const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const normalizedName = value => text(value, 200).toLocaleLowerCase('en-US').replace(/\s+/g, ' ');

async function listSuppliers() {
  return await supabase('suppliers', { query:'?select=*&order=active.desc,name.asc' }) || [];
}

async function loadSupplierWriteAccess(admin) {
  if (admin?.role === 'master_admin') return true;
  const rows = await supabase('admin_effective_permissions', {
    query:`?select=permission_key&admin_user_id=eq.${encodeURIComponent(admin?.admin_id || '')}&permission_key=eq.procurement.write&limit=1`
  });
  return Boolean(rows?.length);
}

async function assertUniqueName(name, excludeId = null) {
  const key = normalizedName(name);
  const suppliers = await supabase('suppliers', { query:'?select=id,name' }) || [];
  const duplicate = suppliers.find(item => String(item.id) !== String(excludeId || '') && normalizedName(item.name) === key);
  if (duplicate) throw new Error('Ya existe un proveedor con ese nombre');
}

function supplierPayload(body) {
  const name = text(body.name, 200);
  if (!name) throw new Error('El nombre del proveedor es obligatorio');
  return {
    name,
    legal_name:text(body.legal_name, 250) || null,
    email:text(body.email, 250) || null,
    phone:text(body.phone, 80) || null,
    address:text(body.address, 500) || null,
    country:text(body.country, 120) || null,
    tax_id:text(body.tax_id, 120) || null,
    notes:text(body.notes, 2000) || null
  };
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, req.method === 'GET' ? 'procurement.read' : 'procurement.write');
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const [suppliers, writeAccess] = await Promise.all([listSuppliers(), loadSupplierWriteAccess(admin)]);
      return ok(res, { suppliers, write_access:writeAccess });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const payload = supplierPayload(body);
      await assertUniqueName(payload.name);
      const rows = await supabase('suppliers', {
        method:'POST',
        prefer:'return=representation',
        body:[payload]
      });
      const supplier = rows?.[0];
      if (!supplier?.id) throw new Error('No se pudo crear el proveedor');
      await writeAudit(admin, 'supplier_created', 'supplier', supplier.id, { name:supplier.name });
      return ok(res, { supplier });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = text(body.id, 80);
      if (!id) throw new Error('Falta el proveedor');
      const action = text(body.action, 60) || 'update';

      const existing = await supabase('suppliers', { query:`?select=*&id=eq.${encodeURIComponent(id)}&limit=1` });
      if (!existing?.[0]) throw new Error('Proveedor no encontrado');

      if (action === 'set_active') {
        const active = Boolean(body.active);
        const rows = await supabase('suppliers', {
          method:'PATCH',
          prefer:'return=representation',
          query:`?id=eq.${encodeURIComponent(id)}`,
          body:{ active, updated_at:new Date().toISOString() }
        });
        await writeAudit(admin, active ? 'supplier_reactivated' : 'supplier_deactivated', 'supplier', id, { name:existing[0].name });
        return ok(res, { supplier:rows?.[0] });
      }

      if (action !== 'update') return fail(res, 400, 'Acción de proveedor inválida');

      const payload = supplierPayload(body);
      await assertUniqueName(payload.name, id);
      const rows = await supabase('suppliers', {
        method:'PATCH',
        prefer:'return=representation',
        query:`?id=eq.${encodeURIComponent(id)}`,
        body:{ ...payload, updated_at:new Date().toISOString() }
      });
      await writeAudit(admin, 'supplier_updated', 'supplier', id, { from:existing[0].name, to:payload.name });
      return ok(res, { supplier:rows?.[0] });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('[suppliers]', error);
    return fail(res, 400, error.message || 'No se pudo procesar el proveedor');
  }
}
