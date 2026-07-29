import { fail, ok, readJson, requireAdmin, supabase } from './_lib.js';

const CATEGORIES = new Set(['plaza_merchandise','plaza_containers','upcoming_shipments','us_warehouse']);
const PUBLICATION_STATUSES = new Set(['draft','published','hidden','archived']);
const AVAILABILITY_STATUSES = new Set(['available','reserved','sold','unavailable']);

function clean(body, current = {}) {
  const row = { updated_at: new Date().toISOString() };
  if (body.category !== undefined) {
    const value = String(body.category || '').trim();
    if (!CATEGORIES.has(value)) throw new Error('Categoría inválida');
    row.category = value;
  }
  if (body.title !== undefined) {
    const value = String(body.title || '').trim();
    if (!value) throw new Error('El título es obligatorio');
    row.title = value;
  }
  if (body.description !== undefined) row.description = String(body.description || '').trim() || null;
  if (body.price !== undefined) row.price = body.price === '' || body.price === null ? null : Number(body.price);
  if (body.currency !== undefined) row.currency = String(body.currency || 'USD').trim().toUpperCase();
  if (body.quantity !== undefined) row.quantity = body.quantity === '' || body.quantity === null ? null : Number(body.quantity);
  if (body.unit !== undefined) row.unit = String(body.unit || '').trim() || null;
  if (body.location_public !== undefined) row.location_public = String(body.location_public || '').trim() || null;
  if (body.location_internal !== undefined) row.location_internal = String(body.location_internal || '').trim() || null;
  if (body.departure_date !== undefined) row.departure_date = body.departure_date || null;
  if (body.arrival_date !== undefined) row.arrival_date = body.arrival_date || null;
  if (body.availability_status !== undefined) {
    const value = String(body.availability_status || '').trim();
    if (!AVAILABILITY_STATUSES.has(value)) throw new Error('Disponibilidad inválida');
    row.availability_status = value;
  }
  if (body.publication_status !== undefined) {
    const value = String(body.publication_status || '').trim();
    if (!PUBLICATION_STATUSES.has(value)) throw new Error('Estado de publicación inválido');
    row.publication_status = value;
    if (value === 'published' && current.publication_status !== 'published') row.published_at = new Date().toISOString();
  }
  if (body.image_urls !== undefined) {
    const urls = Array.isArray(body.image_urls) ? body.image_urls : String(body.image_urls || '').split(/\r?\n|,/);
    row.image_urls = urls.map(x => String(x).trim()).filter(Boolean).slice(0, 12);
  }
  if (row.price !== undefined && row.price !== null && (!Number.isFinite(row.price) || row.price < 0)) throw new Error('Precio inválido');
  if (row.quantity !== undefined && row.quantity !== null && (!Number.isFinite(row.quantity) || row.quantity < 0)) throw new Error('Cantidad inválida');
  return row;
}

async function audit(action, id, details = {}) {
  try { await supabase('audit_log', { method: 'POST', body: [{ action, entity_type: 'commercial_publication', entity_id: id, details }] }); } catch {}
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  try {
    if (req.method === 'GET') {
      const rows = await supabase('commercial_publications', { query: '?select=*&order=created_at.desc' });
      return ok(res, { publications: rows || [] });
    }
    if (req.method === 'POST') {
      const body = await readJson(req);
      const row = clean(body);
      if (!row.category) throw new Error('La categoría es obligatoria');
      if (!row.title) throw new Error('El título es obligatorio');
      row.publication_status ||= 'draft';
      row.availability_status ||= 'available';
      row.created_by = admin.id || null;
      row.updated_by = admin.id || null;
      if (row.publication_status === 'published') row.published_at = new Date().toISOString();
      const created = await supabase('commercial_publications', { method: 'POST', query: '?select=*', body: [row] });
      await audit('publication_created', created?.[0]?.id, { title: row.title, status: row.publication_status });
      return ok(res, { publication: created?.[0] });
    }
    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = String(body.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador');
      const currentRows = await supabase('commercial_publications', { query: `?select=*&id=eq.${encodeURIComponent(id)}&limit=1` });
      const current = currentRows?.[0];
      if (!current) return fail(res, 404, 'Publicación no encontrada');
      const row = clean(body, current);
      row.updated_by = admin.id || null;
      const updated = await supabase('commercial_publications', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}&select=*`, body: row });
      await audit('publication_updated', id, { title: updated?.[0]?.title || current.title, status: updated?.[0]?.publication_status || current.publication_status });
      return ok(res, { publication: updated?.[0] });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '').trim();
      if (!id) return fail(res, 400, 'Falta el identificador');
      const deleted = await supabase('commercial_publications', { method: 'DELETE', query: `?id=eq.${encodeURIComponent(id)}&select=id,title` });
      if (!deleted?.length) return fail(res, 404, 'Publicación no encontrada');
      await audit('publication_deleted', id, { title: deleted[0].title });
      return ok(res, { deleted: true });
    }
    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    return fail(res, 400, error.message || 'No se pudo procesar la publicación');
  }
}
