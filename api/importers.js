import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const cleanName = value => String(value || '').trim().replace(/\s+/g, ' ').slice(0, 160);
const normalizedName = value => cleanName(value).toUpperCase();

async function getState() {
  const [importers, clientImporters, shipmentRows] = await Promise.all([
    supabase('importers', { query: '?select=id,name,normalized_name,active,created_at,updated_at&order=name.asc' }),
    supabase('client_importers', { query: '?select=client_id,importer_id,created_at' }),
    supabase('shipments', { query: '?select=id,client_id,importer_id&importer_id=not.is.null' })
  ]);
  return {
    importers: importers || [],
    client_importers: clientImporters || [],
    shipment_importers: (shipmentRows || []).map(row => ({ shipment_id: row.id, client_id: row.client_id || null, importer_id: row.importer_id }))
  };
}

async function getImporter(id) {
  const rows = await supabase('importers', {
    query: `?select=id,name,normalized_name,active&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  return rows?.[0] || null;
}

async function ensureImporter(name) {
  const clean = cleanName(name);
  const normalized = normalizedName(clean);
  if (!clean) return null;
  const existing = await supabase('importers', {
    query: `?select=id,name,normalized_name,active&normalized_name=eq.${encodeURIComponent(normalized)}&limit=1`
  });
  if (existing?.[0]) {
    if (existing[0].active === false) {
      const reactivated = await supabase('importers', {
        method: 'PATCH',
        prefer: 'return=representation',
        query: `?id=eq.${encodeURIComponent(existing[0].id)}`,
        body: { active: true, updated_at: new Date().toISOString() }
      });
      return reactivated?.[0] || { ...existing[0], active: true };
    }
    return existing[0];
  }

  try {
    const created = await supabase('importers', {
      method: 'POST',
      prefer: 'return=representation',
      body: { name: clean, normalized_name: normalized, active: true }
    });
    return created?.[0] || null;
  } catch (error) {
    const raced = await supabase('importers', {
      query: `?select=id,name,normalized_name,active&normalized_name=eq.${encodeURIComponent(normalized)}&limit=1`
    });
    if (raced?.[0]) return raced[0];
    throw error;
  }
}

function uniqueImporterNames(value) {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const map = new Map();
  raw.forEach(item => {
    const clean = cleanName(item);
    if (clean) map.set(normalizedName(clean), clean);
  });
  return [...map.values()].slice(0, 30);
}

async function syncClientImporters(admin, clientId, names) {
  const clients = await supabase('clients', {
    query: `?select=id,name&id=eq.${encodeURIComponent(clientId)}&limit=1`
  });
  const client = clients?.[0];
  if (!client) throw new Error('Cliente no encontrado');

  const importerNames = uniqueImporterNames(names);
  const importers = [];
  for (const name of importerNames) {
    const importer = await ensureImporter(name);
    if (importer) importers.push(importer);
  }

  await supabase('client_importers', {
    method: 'DELETE',
    query: `?client_id=eq.${encodeURIComponent(clientId)}`
  });
  if (importers.length) {
    await supabase('client_importers', {
      method: 'POST',
      body: importers.map(importer => ({ client_id: clientId, importer_id: importer.id }))
    });
  }

  await supabase('clients', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(clientId)}`,
    body: {
      importer_name: importers.length ? importers.map(item => item.name).join(', ') : null,
      updated_at: new Date().toISOString()
    }
  });

  await writeAudit(admin, 'client_importers_updated', 'client', clientId, {
    client_name: client.name,
    importer_ids: importers.map(item => item.id),
    importer_names: importers.map(item => item.name)
  });

  return importers;
}

async function assignShipmentImporter(admin, shipmentId, { importerIdValue, importerNameValue }) {
  const shipments = await supabase('shipments', {
    query: `?select=id,client_id,importer_id,container_number&id=eq.${encodeURIComponent(shipmentId)}&limit=1`
  });
  const shipment = shipments?.[0];
  if (!shipment) throw new Error('Contenedor no encontrado');

  const importerId = String(importerIdValue || '').trim();
  const importerName = cleanName(importerNameValue);
  let importer = null;

  if (importerName) {
    importer = await ensureImporter(importerName);
  } else if (importerId) {
    importer = await getImporter(importerId);
    if (!importer || importer.active === false) throw new Error('Importadora no disponible');
  }

  await supabase('shipments', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(shipment.id)}`,
    body: { importer_id: importer?.id || null, updated_at: new Date().toISOString() }
  });

  await writeAudit(admin, 'shipment_importer_changed', 'shipment', shipment.id, {
    container_number: shipment.container_number,
    previous_importer_id: shipment.importer_id || null,
    importer_id: importer?.id || null,
    importer_name: importer?.name || null,
    independent_from_client_registration: true
  });

  return { shipment_id: shipment.id, importer_id: importer?.id || null, importer };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') return ok(res, await getState());

    const body = await readJson(req);
    if (req.method === 'POST' && body.action === 'sync_client') {
      const clientId = String(body.client_id || '').trim();
      if (!clientId) return fail(res, 400, 'Falta el cliente');
      const importers = await syncClientImporters(admin, clientId, body.importer_names || []);
      return ok(res, { client_id: clientId, importers, state: await getState() });
    }

    if (req.method === 'PATCH' && body.action === 'assign_shipment') {
      const shipmentId = String(body.shipment_id || '').trim();
      if (!shipmentId) return fail(res, 400, 'Falta el contenedor');
      const assignment = await assignShipmentImporter(admin, shipmentId, {
        importerIdValue: body.importer_id,
        importerNameValue: body.importer_name
      });
      return ok(res, { assignment, state: await getState() });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('[importers]', error);
    return fail(res, 400, error.message || 'No se pudo procesar la importadora');
  }
}
