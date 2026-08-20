import { fail, ok, requireAdmin, supabase } from './_lib.js';

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const loads = await supabase('loads', {
      query: '?select=id,load_number,status,shipment_id,updated_at&shipment_id=not.is.null&order=updated_at.desc'
    });

    const shipmentIds = [...new Set((loads || []).map(item => item.shipment_id).filter(Boolean))];
    if (!shipmentIds.length) return ok(res, { links: [] });

    const filter = shipmentIds.map(id => `"${String(id).replace(/"/g, '')}"`).join(',');
    const shipments = await supabase('shipments', {
      query: `?select=id,operation_id,container_number&id=in.(${encodeURIComponent(filter)})`
    });
    const byShipment = new Map((shipments || []).map(item => [String(item.id), item]));

    const links = (loads || []).map(load => {
      const shipment = byShipment.get(String(load.shipment_id)) || null;
      return {
        load_id: load.id,
        load_number: load.load_number,
        load_status: load.status,
        shipment_id: load.shipment_id,
        container_number: shipment?.container_number || null,
        operation_id: shipment?.operation_id || null,
        updated_at: load.updated_at || null
      };
    });

    return ok(res, { links });
  } catch (error) {
    console.error('[operational-links]', error);
    return fail(res, 400, error.message || 'No se pudieron resolver los enlaces operativos');
  }
}
