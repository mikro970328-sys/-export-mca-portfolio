import { fail, normalizeContainer, ok, readJson, requireAdmin, supabase } from './_lib.js';

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  try {
    if (req.method === 'GET') {
      const data = await supabase('shipments', {
        query: '?select=*,clients(id,name,company,phone)&order=created_at.desc'
      });
      return ok(res, { shipments: data || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const clientId = String(body.client_id || '').trim();
      if (!clientId) return fail(res, 400, 'Selecciona un cliente');
      const containerNumber = normalizeContainer(body.container_number);
      const created = await supabase('shipments', {
        method: 'POST',
        body: [{
          client_id: clientId,
          container_number: containerNumber,
          booking_number: String(body.booking_number || '').trim() || null,
          bol_number: String(body.bol_number || '').trim() || null,
          carrier: String(body.carrier || '').trim() || null,
          product: String(body.product || '').trim() || null,
          active: true,
          last_status: 'Registrado',
          last_location: null,
          last_event_at: null
        }]
      });
      return ok(res, { shipment: created?.[0] });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    const message = error.message === 'CONTAINER_INVALID'
      ? 'Número de contenedor inválido. Debe tener 4 letras y 7 números.'
      : error.message;
    return fail(res, 400, message);
  }
}
