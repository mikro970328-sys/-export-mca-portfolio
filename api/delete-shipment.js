import { fail, ok, requireAdmin, supabase } from './_lib.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'DELETE') return fail(res, 405, 'Método no permitido');

  try {
    const id = String(req.query?.id || '').trim();
    if (!id) return fail(res, 400, 'Falta el identificador del contenedor');

    const rows = await supabase('shipments', {
      query: `?select=id,client_id,container_number,shipsgo_tracking_id&id=eq.${encodeURIComponent(id)}&limit=1`
    });
    const shipment = rows?.[0];
    if (!shipment) return fail(res, 404, 'Contenedor no encontrado');

    try {
      await supabase('audit_log', {
        method: 'POST',
        body: [{
          actor_admin_id: admin.admin_id || null,
          actor_username: admin.username || null,
          action: 'shipment_deleted',
          entity_type: 'shipment',
          entity_id: shipment.id,
          details: {
            container_number: shipment.container_number,
            shipsgo_tracking_id: shipment.shipsgo_tracking_id || null,
            deletion_scope: 'erp_only'
          }
        }]
      });
    } catch {}

    await supabase('notifications', {
      method: 'DELETE',
      query: `?shipment_id=eq.${encodeURIComponent(id)}`
    });
    await supabase('shipment_history', {
      method: 'DELETE',
      query: `?shipment_id=eq.${encodeURIComponent(id)}`
    });

    const deleted = await supabase('shipments', {
      method: 'DELETE',
      query: `?id=eq.${encodeURIComponent(id)}&select=id,container_number`
    });
    if (!deleted?.length) return fail(res, 404, 'Contenedor no encontrado');

    return ok(res, {
      deleted: true,
      shipment: deleted[0],
      shipsgo_deleted: false
    });
  } catch (error) {
    return fail(res, 400, 'No se pudo eliminar el contenedor', error.message);
  }
}
