import { fail, ok, readJson, requireMasterAdmin, supabase, writeAudit } from './_lib.js';

const fields = 'id,full_name,phone,is_active,created_at,updated_at';
const cleanPhone = value => String(value || '').trim().replace(/[^+\d]/g, '');

export default async function handler(req, res) {
  const master = requireMasterAdmin(req, res);
  if (!master) return;

  try {
    if (req.method === 'GET') {
      const workers = await supabase('workers', { query: `?select=${fields}&order=full_name.asc` });
      return ok(res, { workers: workers || [] });
    }

    const body = await readJson(req);

    if (req.method === 'POST') {
      const fullName = String(body.full_name || '').trim();
      const phone = cleanPhone(body.phone);
      if (fullName.length < 3) return fail(res, 400, 'El nombre completo es obligatorio');
      if (phone.length < 8) return fail(res, 400, 'El número de teléfono no es válido');

      const rows = await supabase('workers', {
        method: 'POST',
        body: { full_name: fullName, phone, is_active: true, created_by: master.admin_id }
      });
      const worker = rows?.[0] || null;
      await writeAudit(master, 'create_worker', 'worker', worker?.id, { full_name: fullName, phone });
      return ok(res, { worker });
    }

    if (req.method === 'PATCH') {
      const id = String(body.id || '');
      if (!id) return fail(res, 400, 'Trabajador inválido');
      const patch = { updated_at: new Date().toISOString() };
      if (body.full_name !== undefined) {
        const fullName = String(body.full_name || '').trim();
        if (fullName.length < 3) return fail(res, 400, 'Nombre inválido');
        patch.full_name = fullName;
      }
      if (body.phone !== undefined) {
        const phone = cleanPhone(body.phone);
        if (phone.length < 8) return fail(res, 400, 'Teléfono inválido');
        patch.phone = phone;
      }
      if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);
      await supabase('workers', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}`, body: patch });
      await writeAudit(master, 'update_worker', 'worker', id, { fields: Object.keys(patch) });
      return ok(res, { updated: true });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '');
      if (!id) return fail(res, 400, 'Trabajador inválido');
      await supabase('workers', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}`, body: { is_active: false, updated_at: new Date().toISOString() } });
      await writeAudit(master, 'deactivate_worker', 'worker', id, {});
      return ok(res, { deactivated: true });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    if (error.message.includes('workers_phone_unique')) return fail(res, 409, 'Ese teléfono ya está registrado');
    return fail(res, 500, 'No se pudo completar la operación', error.message);
  }
}
