import { authorizeAdmin, fail, ok, readJson, supabase } from './_lib.js';

const INPUT_CATEGORIES = new Set(['plaza_merchandise','plaza_containers','upcoming_shipments','us_warehouse','merchandise_plaza','containers_plaza','usa_warehouse']);
const CATEGORY_STORAGE = { plaza_merchandise:'merchandise_plaza', plaza_containers:'containers_plaza', upcoming_shipments:'upcoming_shipments', us_warehouse:'usa_warehouse', merchandise_plaza:'merchandise_plaza', containers_plaza:'containers_plaza', usa_warehouse:'usa_warehouse' };
const PUBLICATION_STATUSES = new Set(['draft','published','hidden','archived']);
const AVAILABILITY_STATUSES = new Set(['available','upcoming','reserved','sold','unavailable']);

function clean(body, current = {}) {
  const row = { updated_at: new Date().toISOString() };
  if (body.category !== undefined) { const value = String(body.category || '').trim(); if (!INPUT_CATEGORIES.has(value)) throw new Error('Categoría inválida'); row.category = CATEGORY_STORAGE[value]; }
  if (body.title !== undefined) { const value = String(body.title || '').trim(); if (!value) throw new Error('El título es obligatorio'); row.title = value; }
  if (body.description !== undefined) row.description = String(body.description || '').trim() || null;
  if (body.price !== undefined) row.price = body.price === '' || body.price === null ? null : Number(body.price);
  if (body.currency !== undefined) row.currency = String(body.currency || 'USD').trim().toUpperCase();
  if (body.quantity !== undefined) row.quantity = body.quantity === '' || body.quantity === null ? null : Number(body.quantity);
  if (body.unit !== undefined) row.unit = String(body.unit || '').trim() || null;
  if (body.location_public !== undefined) row.location_public = String(body.location_public || '').trim() || null;
  if (body.location_internal !== undefined) row.location_internal = String(body.location_internal || '').trim() || null;
  if (body.departure_date !== undefined) row.departure_date = body.departure_date || null;
  if (body.arrival_date !== undefined) row.arrival_date = body.arrival_date || null;
  if (body.assigned_worker_id !== undefined) row.assigned_worker_id = String(body.assigned_worker_id || '').trim() || null;
  if (body.availability_status !== undefined) { const value = String(body.availability_status || '').trim(); if (!AVAILABILITY_STATUSES.has(value)) throw new Error('Disponibilidad inválida'); row.availability_status = value; }
  if (body.publication_status !== undefined) { const value = String(body.publication_status || '').trim(); if (!PUBLICATION_STATUSES.has(value)) throw new Error('Estado de publicación inválido'); row.publication_status = value; if (value === 'published' && current.publication_status !== 'published') row.published_at = new Date().toISOString(); }
  if (body.image_urls !== undefined) {
    const urls = Array.isArray(body.image_urls) ? body.image_urls : String(body.image_urls || '').split(/\r?\n|,/);
    row.image_urls = urls.map(x => String(x).trim()).filter(Boolean).slice(0, 2);
  }
  if (row.price !== undefined && row.price !== null && (!Number.isFinite(row.price) || row.price < 0)) throw new Error('Precio inválido');
  if (row.quantity !== undefined && row.quantity !== null && (!Number.isFinite(row.quantity) || row.quantity < 0)) throw new Error('Cantidad inválida');
  return row;
}
function validateUpcomingShipment(row, current = {}) { const category = row.category ?? current.category; const departureDate = row.departure_date !== undefined ? row.departure_date : current.departure_date; const arrivalDate = row.arrival_date !== undefined ? row.arrival_date : current.arrival_date; if (category === 'upcoming_shipments' && !departureDate && !arrivalDate) throw new Error('Para Próximos envíos debes indicar al menos la fecha de salida o la fecha de llegada'); }
async function validateWorker(workerId) { if (!workerId) return; const workers = await supabase('workers', { query: `?select=id,is_active&id=eq.${encodeURIComponent(workerId)}&limit=1` }); if (!workers?.[0]) throw new Error('El trabajador seleccionado no existe'); if (workers[0].is_active === false) throw new Error('El trabajador seleccionado está desactivado'); }
async function audit(action, id, details = {}) { try { await supabase('audit_log', { method:'POST', body:[{ action, entity_type:'commercial_publication', entity_id:id, details }] }); } catch {} }
const SELECT_WITH_WORKER = '*,assigned_worker:workers!commercial_publications_assigned_worker_id_fkey(id,full_name,phone,position,is_active)';

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, req.method === 'GET' ? 'publications.read' : 'publications.write');
  if (!admin) return;
  try {
    if (req.method === 'GET') { const rows = await supabase('commercial_publications', { query:`?select=${encodeURIComponent(SELECT_WITH_WORKER)}&order=created_at.desc` }); const workers = await supabase('workers', { query:'?select=id,full_name,phone,position,is_active&is_active=eq.true&order=full_name.asc' }); return ok(res, { publications:rows || [], workers:workers || [] }); }
    if (req.method === 'POST') { const body = await readJson(req); const row = clean(body); if (!row.category) throw new Error('La categoría es obligatoria'); if (!row.title) throw new Error('El título es obligatorio'); row.publication_status ||= 'draft'; row.availability_status ||= 'available'; validateUpcomingShipment(row); await validateWorker(row.assigned_worker_id); row.created_by = admin.admin_id || null; row.updated_by = admin.admin_id || null; if (row.publication_status === 'published') row.published_at = new Date().toISOString(); const created = await supabase('commercial_publications', { method:'POST', query:`?select=${encodeURIComponent(SELECT_WITH_WORKER)}`, body:[row] }); await audit('publication_created', created?.[0]?.id, { title:row.title, status:row.publication_status, assigned_worker_id:row.assigned_worker_id }); return ok(res, { publication:created?.[0] }); }
    if (req.method === 'PATCH') { const body = await readJson(req); const id = String(body.id || '').trim(); if (!id) return fail(res, 400, 'Falta el identificador'); const currentRows = await supabase('commercial_publications', { query:`?select=*&id=eq.${encodeURIComponent(id)}&limit=1` }); const current = currentRows?.[0]; if (!current) return fail(res, 404, 'Publicación no encontrada'); const row = clean(body, current); validateUpcomingShipment(row, current); if (row.assigned_worker_id !== undefined) await validateWorker(row.assigned_worker_id); row.updated_by = admin.admin_id || null; const updated = await supabase('commercial_publications', { method:'PATCH', query:`?id=eq.${encodeURIComponent(id)}&select=${encodeURIComponent(SELECT_WITH_WORKER)}`, body:row }); await audit('publication_updated', id, { title:updated?.[0]?.title || current.title, status:updated?.[0]?.publication_status || current.publication_status, assigned_worker_id:updated?.[0]?.assigned_worker_id || null }); return ok(res, { publication:updated?.[0] }); }
    if (req.method === 'DELETE') { const id = String(req.query?.id || '').trim(); if (!id) return fail(res, 400, 'Falta el identificador'); const deleted = await supabase('commercial_publications', { method:'DELETE', query:`?id=eq.${encodeURIComponent(id)}&select=id,title` }); if (!deleted?.length) return fail(res, 404, 'Publicación no encontrada'); await audit('publication_deleted', id, { title:deleted[0].title }); return ok(res, { deleted:true }); }
    return fail(res, 405, 'Método no permitido');
  } catch (error) { return fail(res, 400, error.message || 'No se pudo procesar la publicación'); }
}
