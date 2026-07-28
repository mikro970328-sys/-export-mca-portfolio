import { fail, ok, readJson, supabase } from './_lib.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const listings = await supabase('inventory_listings', {
        query: '?select=id,slug,product_name,category,brand,specification,unit,total_quantity,available_quantity,reserved_quantity,price_text,image_url,origin_port,destination_port,estimated_departure_at,estimated_arrival_at,availability_status,public_notes&public_visible=eq.true&order=estimated_departure_at.asc.nullslast,created_at.desc'
      });
      return ok(res, { listings: listings || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const customerName = String(body.customer_name || '').trim();
      const phone = String(body.phone || '').trim();
      if (!customerName || !phone) return fail(res, 400, 'Nombre y teléfono son obligatorios');
      const listingId = body.listing_id ? String(body.listing_id).trim() : null;
      const created = await supabase('marketplace_leads', {
        method: 'POST',
        body: [{
          listing_id: listingId || null,
          customer_name: customerName,
          company: String(body.company || '').trim() || null,
          phone,
          email: String(body.email || '').trim() || null,
          requested_quantity: body.requested_quantity === '' || body.requested_quantity == null ? null : Number(body.requested_quantity),
          message: String(body.message || '').trim() || null,
          status: 'new'
        }]
      });
      return ok(res, { lead: created?.[0] || null });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('PUBLIC_MARKETPLACE_ERROR', error);
    return fail(res, 500, 'No se pudo procesar la solicitud');
  }
}
