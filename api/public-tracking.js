import { fail, ok, readJson, supabase } from './_lib.js';

const cleanCode = (value = '') => String(value).trim().toUpperCase().replace(/\s+/g, '');

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const body = await readJson(req);
    const code = cleanCode(body.code);
    if (!code || code.length < 6 || code.length > 40) return fail(res, 400, 'Número de envío inválido');

    const rows = await supabase('operations', {
      query: `?select=id,operation_code,title,public_summary,operational_status,origin_port,destination_port,carrier,vessel_name,booking_number,bol_number,estimated_departure_at,actual_departure_at,estimated_arrival_at,actual_arrival_at,operation_shipments(shipments(container_number,last_status,last_location,last_event_at))&public_tracking_enabled=eq.true&or=(public_tracking_code.eq.${encodeURIComponent(code)},operation_code.eq.${encodeURIComponent(code)})&limit=1`
    });
    const operation = rows?.[0];
    if (!operation) return fail(res, 404, 'No encontramos un envío con ese número');

    const events = await supabase('operation_events', {
      query: `?select=status_code,title,public_description,location,event_at,sort_order&operation_id=eq.${encodeURIComponent(operation.id)}&is_public=eq.true&order=event_at.asc,sort_order.asc`
    });

    return ok(res, {
      operation: {
        code: operation.operation_code,
        title: operation.title,
        summary: operation.public_summary,
        status: operation.operational_status,
        origin_port: operation.origin_port,
        destination_port: operation.destination_port,
        carrier: operation.carrier,
        vessel_name: operation.vessel_name,
        booking_number: operation.booking_number,
        bol_number: operation.bol_number,
        estimated_departure_at: operation.estimated_departure_at,
        actual_departure_at: operation.actual_departure_at,
        estimated_arrival_at: operation.estimated_arrival_at,
        actual_arrival_at: operation.actual_arrival_at,
        containers: (operation.operation_shipments || []).map((item) => item.shipments).filter(Boolean)
      },
      events: events || []
    });
  } catch (error) {
    console.error('PUBLIC_TRACKING_ERROR', error);
    return fail(res, 500, 'No se pudo consultar el envío');
  }
}
