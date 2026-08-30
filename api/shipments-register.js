import { authorizeAdmin, fail, normalizeContainer, ok, readJson, supabase } from './_lib.js';

const CLOSED = ['liberado','released','descargado','discharged','entregado','delivered','cerrado','closed'];
const isClosed = row => row.active === false || CLOSED.includes(String(row.operational_status || row.last_status || '').trim().toLowerCase());

async function shipsGoRequest(containerNumber) {
  const token = process.env.SHIPSGO_API_KEY || process.env.SHIPSGO_TOKEN;
  const base = (process.env.SHIPSGO_API_BASE_URL || 'https://api.shipsgo.com/v2').replace(/\/$/, '');
  if (!token) throw new Error('SHIPSGO_CONFIG_MISSING');
  const headers = { 'X-Shipsgo-User-Token': token, Accept: 'application/json', 'Content-Type': 'application/json' };
  const lookup = await fetch(`${base}/ocean/shipments?container_number=${encodeURIComponent(containerNumber)}&take=1`, { headers });
  if (lookup.ok) {
    const data = await lookup.json().catch(() => ({}));
    const item = Array.isArray(data) ? data[0] : (data.data?.[0] || data.items?.[0] || data.results?.[0]);
    if (item) return { id: item.id || item.shipment_id || null, mode: 'linked' };
  }
  const created = await fetch(`${base}/${process.env.SHIPSGO_CREATE_PATH || 'ocean/shipments'}`, {
    method: 'POST', headers,
    body: JSON.stringify({ container_number: containerNumber, reference: `EXPORT-MCA-${containerNumber}-${Date.now()}` })
  });
  const payload = await created.json().catch(() => ({}));
  if (!created.ok && created.status !== 409) throw new Error(payload.message || payload.detail || `SHIPSGO_${created.status}`);
  return { id: payload.data?.id || payload.id || payload.shipment_id || null, mode: created.status === 409 ? 'already_exists' : 'created' };
}

export default async function handler(req, res) {
  const admin = await authorizeAdmin(req, res, 'logistics.write');
  if (!admin) return;
  if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');

  try {
    const body = await readJson(req);
    const clientId = String(body.client_id || '').trim();
    if (!clientId) return fail(res, 400, 'Selecciona un cliente');
    const containerNumber = normalizeContainer(body.container_number);

    const existing = await supabase('shipments', {
      query: `?select=id,active,operational_status,last_status&container_number=eq.${encodeURIComponent(containerNumber)}&order=created_at.desc`
    });
    const blocking = (existing || []).find(row => !isClosed(row));
    if (blocking) return fail(res, 409, 'Ese número de contenedor ya tiene una operación activa');

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
        operational_status: 'Registrado',
        last_location: null,
        last_event_at: null,
        shipsgo_status: 'pending'
      }]
    });
    let shipment = created?.[0];
    if (!shipment) return fail(res, 400, 'No se pudo registrar el contenedor');

    await supabase('shipment_history', { method: 'POST', body: [{ shipment_id: shipment.id, client_id: clientId, event_type: 'created', title: 'Contenedor registrado', details: existing?.length ? 'Número reutilizado después de operación cerrada' : containerNumber, source: 'admin' }] });

    try {
      const tracking = await shipsGoRequest(containerNumber);
      await supabase('shipments', { method: 'PATCH', query: `?id=eq.${shipment.id}`, body: { shipsgo_status: 'active', shipsgo_tracking_id: tracking.id, shipsgo_link_mode: tracking.mode, shipsgo_error: null, updated_at: new Date().toISOString() } });
      shipment = { ...shipment, shipsgo_status: 'active', shipsgo_tracking_id: tracking.id, shipsgo_link_mode: tracking.mode };
    } catch (error) {
      await supabase('shipments', { method: 'PATCH', query: `?id=eq.${shipment.id}`, body: { shipsgo_status: 'failed', shipsgo_error: error.message, updated_at: new Date().toISOString() } });
      shipment = { ...shipment, shipsgo_status: 'failed', shipsgo_error: error.message };
    }

    return ok(res, { shipment, reused_number: Boolean(existing?.length) });
  } catch (error) {
    const message = error.message === 'CONTAINER_INVALID' ? 'Número de contenedor inválido. Debe tener 4 letras y 7 números.' : error.message;
    return fail(res, 400, message);
  }
}
