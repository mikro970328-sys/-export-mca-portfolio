import { supabase } from './_lib.js';

function shipsGoConfig() {
  const token = process.env.SHIPSGO_API_KEY || process.env.SHIPSGO_TOKEN;
  const base = process.env.SHIPSGO_API_BASE_URL || 'https://api.shipsgo.com/v2';
  if (!token) throw new Error('SHIPSGO_CONFIG_MISSING: falta SHIPSGO_API_KEY en Vercel');
  return { token, base: base.replace(/\/$/, '') };
}

async function shipsGoRequest(path, options = {}) {
  const { token, base } = shipsGoConfig();
  const response = await fetch(`${base}/${String(path).replace(/^\//, '')}`, {
    method: options.method || 'GET',
    headers: {
      'X-Shipsgo-User-Token': token,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const message = data?.message || data?.detail || data?.error || text || 'Error de ShipsGo';
    const error = new Error(`SHIPSGO_${response.status}:${message}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function firstShipsGoItem(response) {
  if (Array.isArray(response)) return response[0] || null;
  if (Array.isArray(response?.data)) return response.data[0] || null;
  if (Array.isArray(response?.items)) return response.items[0] || null;
  if (Array.isArray(response?.results)) return response.results[0] || null;
  return null;
}

function trackingIdentity(item) {
  return item?.id || item?.shipment_id || item?.tracking_id || null;
}

export async function findShipsGoTracking(containerNumber) {
  const paths = [
    process.env.SHIPSGO_SEARCH_PATH || `ocean/shipments?filters[container_number]=eq:${encodeURIComponent(containerNumber)}&take=1`,
    `ocean/shipments?container_number=${encodeURIComponent(containerNumber)}&take=1`
  ];
  for (const path of [...new Set(paths)]) {
    try {
      const found = await shipsGoRequest(path);
      const existing = firstShipsGoItem(found);
      if (existing) return existing;
    } catch (error) {
      const message = String(error.message || '');
      if (!message.includes('SHIPSGO_404')) console.warn('SHIPSGO_LOOKUP_FAILED', message);
    }
  }
  return null;
}

async function requireTrackingIdentity(containerNumber, candidate, mode) {
  const candidateId = trackingIdentity(candidate);
  if (candidateId) return { mode, id: candidateId, raw: candidate };
  const linked = await findShipsGoTracking(containerNumber);
  const linkedId = trackingIdentity(linked);
  if (linkedId) return { mode: mode === 'created' ? 'created_linked' : 'linked', id: linkedId, raw: linked };
  throw new Error('SHIPSGO_TRACKING_ID_MISSING: ShipsGo no confirmó una identidad de tracking utilizable');
}

export async function registerShipsGo(containerNumber, knownTrackingId = null) {
  if (knownTrackingId) return { mode: 'reused', id: knownTrackingId, raw: null };
  const existing = await findShipsGoTracking(containerNumber);
  if (existing) return requireTrackingIdentity(containerNumber, existing, 'linked');

  const createPath = process.env.SHIPSGO_CREATE_PATH || 'ocean/shipments';
  const payload = { container_number: containerNumber, reference: `EXPORT-MCA-${containerNumber}` };
  try {
    const created = await shipsGoRequest(createPath, { method: 'POST', body: payload });
    const item = created?.data || created;
    return requireTrackingIdentity(containerNumber, item, 'created');
  } catch (error) {
    if (error.status === 409 || String(error.message).includes('SHIPSGO_409')) {
      const linked = await findShipsGoTracking(containerNumber);
      if (linked) return requireTrackingIdentity(containerNumber, linked, 'linked');
      throw new Error('SHIPSGO_TRACKING_ID_MISSING: ShipsGo indicó que el tracking existe, pero no pudo confirmarse su identidad');
    }
    throw error;
  }
}

async function assertShipmentTrackingCanBeDeleted(shipmentId) {
  if (!shipmentId) return;
  const linked = await supabase('loads', {
    query: `?select=id,load_number,status&shipment_id=eq.${encodeURIComponent(shipmentId)}&limit=1`
  });
  if (linked?.length) {
    const error = new Error(`LOAD_SHIPMENT_DELETE_BLOCKED:${linked[0].load_number || linked[0].id}`);
    error.status = 409;
    error.domain_block = true;
    throw error;
  }
}

export async function deleteShipsGoTracking(shipment) {
  // ERP domain guard is authoritative and runs before any provider side effect.
  await assertShipmentTrackingCanBeDeleted(shipment?.id);

  let trackingId = shipment.shipsgo_tracking_id || null;
  if (!trackingId) {
    try {
      const found = await findShipsGoTracking(shipment.container_number);
      trackingId = trackingIdentity(found);
    } catch (error) {
      return { deleted: false, reason: 'provider_lookup_failed', tracking_id: null, error: error.message };
    }
  }
  if (!trackingId) return { deleted: false, reason: 'not_found', tracking_id: null };

  const template = process.env.SHIPSGO_DELETE_PATH || 'ocean/shipments/{id}';
  const path = template.includes('{id}')
    ? template.replace('{id}', encodeURIComponent(trackingId))
    : `${template.replace(/\/$/, '')}/${encodeURIComponent(trackingId)}`;
  try {
    const response = await shipsGoRequest(path, { method: 'DELETE' });
    return { deleted: true, tracking_id: trackingId, response };
  } catch (error) {
    if (error.status === 404) return { deleted: true, tracking_id: trackingId, already_missing: true };
    return { deleted: false, reason: 'provider_delete_failed', tracking_id: trackingId, error: error.message };
  }
}
