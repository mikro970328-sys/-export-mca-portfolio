import { fail, ok, requireAdmin, supabase } from './_lib.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function handler(req,res) {
  const admin = requireAdmin(req,res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res,405,'Método no permitido');
  try {
    const shipmentId = String(req.query?.shipment_id || req.query?.id || '').trim();
    if (shipmentId && !UUID_RE.test(shipmentId)) return fail(res,400,'Contenedor inválido');
    const query = shipmentId
      ? `?select=*&shipment_id=eq.${encodeURIComponent(shipmentId)}&limit=1`
      : '?select=*&order=container_number.asc&limit=5000';
    const rows = await supabase('shipment_customs_document_readiness',{query}) || [];
    if (shipmentId && !rows[0]) return fail(res,404,'Contenedor no encontrado');
    return ok(res,{readiness:shipmentId ? rows[0] : rows});
  } catch (error) {
    console.error('[shipment-document-readiness]',error);
    return fail(res,400,error.message || 'No se pudo cargar el estado documental');
  }
}
