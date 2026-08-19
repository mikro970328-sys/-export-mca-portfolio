import { fail, normalizeContainer, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';
import { registerShipsGo } from './_shipsgo.js';

const text = value => String(value ?? '').trim() || null;

function rpcRow(value) {
  if (Array.isArray(value)) return value[0] || null;
  return value || null;
}

async function shipmentHistory(shipment, eventType, title, details = null, source = 'admin') {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{
        shipment_id: shipment.id,
        client_id: shipment.client_id || null,
        event_type: eventType,
        title,
        details,
        source
      }]
    });
  } catch (error) {
    console.error('LOAD_SHIPMENT_HISTORY_FAILED', error.message);
  }
}

async function activateShipsGo(shipment, admin) {
  try {
    const tracking = await registerShipsGo(shipment.container_number, shipment.shipsgo_tracking_id || null);
    const trackingId = tracking.id || shipment.shipsgo_tracking_id || null;
    const now = new Date().toISOString();
    await supabase('shipments', {
      method: 'PATCH',
      query: `?id=eq.${encodeURIComponent(shipment.id)}`,
      body: {
        shipsgo_status: 'active',
        shipsgo_tracking_id: trackingId,
        shipsgo_link_mode: tracking.mode,
        shipsgo_error: null,
        updated_at: now
      }
    });
    await shipmentHistory(
      shipment,
      tracking.mode === 'created' ? 'shipsgo_created' : 'shipsgo_linked',
      tracking.mode === 'created' ? 'Tracking creado en ShipsGo' : 'Tracking existente vinculado en ShipsGo',
      trackingId || shipment.container_number,
      'shipsgo'
    );
    await writeAudit(admin, 'shipsgo_tracking_ready', 'shipment', shipment.id, {
      tracking_id: trackingId,
      mode: tracking.mode,
      source: 'load'
    });
    return { ...shipment, shipsgo_status: 'active', shipsgo_tracking_id: trackingId, shipsgo_link_mode: tracking.mode, shipsgo_error: null };
  } catch (error) {
    await supabase('shipments', {
      method: 'PATCH',
      query: `?id=eq.${encodeURIComponent(shipment.id)}`,
      body: { shipsgo_status: 'failed', shipsgo_error: error.message, updated_at: new Date().toISOString() }
    });
    await shipmentHistory(shipment, 'shipsgo_failed', 'No se pudo activar el tracking en ShipsGo', error.message, 'shipsgo');
    await writeAudit(admin, 'shipsgo_tracking_failed', 'shipment', shipment.id, { error: error.message, source: 'load' });
    return { ...shipment, shipsgo_status: 'failed', shipsgo_error: error.message };
  }
}

async function getLoad(id) {
  const rows = await supabase('loads', {
    query: `?select=id,load_number,warehouse_id,shipment_id,status,scheduled_at,loading_started_at,loaded_at,dispatched_at,cancelled_at,notes,created_at,updated_at,warehouse:warehouses(id,code,name),shipment:shipments(id,container_number,client_id,importer_id,booking_number,bol_number,carrier,operational_status,last_status,shipsgo_status,shipsgo_tracking_id,shipsgo_link_mode,shipsgo_error)&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  return rows?.[0] || null;
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const id = text(req.query?.id);
      if (id) {
        const load = await getLoad(id);
        if (!load) return fail(res, 404, 'Cargue no encontrado');
        return ok(res, { load });
      }
      const loads = await supabase('loads', {
        query: '?select=id,load_number,warehouse_id,shipment_id,status,scheduled_at,loading_started_at,loaded_at,dispatched_at,cancelled_at,notes,created_at,updated_at,warehouse:warehouses(id,code,name),shipment:shipments(id,container_number,client_id,importer_id,booking_number,bol_number,carrier,operational_status,last_status,shipsgo_status,shipsgo_tracking_id)&order=created_at.desc'
      });
      return ok(res, { loads: loads || [] });
    }

    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const body = await readJson(req);
    const action = text(body.action);
    const loadId = text(body.load_id);
    if (!loadId) return fail(res, 400, 'Falta el cargue');

    if (action === 'create_container') {
      const containerNumber = normalizeContainer(body.container_number);
      const result = await supabase('rpc/create_load_shipment', {
        method: 'POST',
        body: {
          p_load_id: loadId,
          p_container_number: containerNumber,
          p_client_id: text(body.client_id),
          p_importer_id: text(body.importer_id),
          p_booking_number: text(body.booking_number),
          p_bol_number: text(body.bol_number),
          p_carrier: text(body.carrier),
          p_departure_date: text(body.departure_date)
        }
      });
      let shipment = rpcRow(result);
      if (!shipment?.id) throw new Error('No se pudo crear el contenedor desde el cargue');

      await shipmentHistory(shipment, 'created_from_load', 'Contenedor creado desde Cargue', `Cargue: ${loadId}`);
      await writeAudit(admin, 'shipment_created_from_load', 'shipment', shipment.id, {
        load_id: loadId,
        container_number: shipment.container_number
      });
      await writeAudit(admin, 'load_shipment_created', 'load', loadId, {
        shipment_id: shipment.id,
        container_number: shipment.container_number
      });

      shipment = await activateShipsGo(shipment, admin);
      return ok(res, { shipment, load: await getLoad(loadId) });
    }

    if (action === 'assign_existing_container') {
      const shipmentId = text(body.shipment_id);
      if (!shipmentId) return fail(res, 400, 'Falta el contenedor');
      const result = await supabase('rpc/assign_load_shipment', {
        method: 'POST',
        body: { p_load_id: loadId, p_shipment_id: shipmentId }
      });
      const load = rpcRow(result) || await getLoad(loadId);
      await writeAudit(admin, 'load_shipment_assigned', 'load', loadId, { shipment_id: shipmentId });
      return ok(res, { load });
    }

    return fail(res, 400, 'Acción de Cargue no válida');
  } catch (error) {
    const raw = String(error.message || 'Error de Cargue');
    const message = raw.includes('CONTAINER_INVALID')
      ? 'Número de contenedor inválido. Debe tener 4 letras y 7 números.'
      : raw.includes('LOAD_ALREADY_HAS_CONTAINER')
        ? 'Este cargue ya tiene un contenedor asignado.'
        : raw.includes('LOAD_SHIPMENT_LOCKED_BY_STATUS')
          ? 'El contenedor ya no puede cambiarse en el estado actual del cargue.'
          : raw.includes('duplicate key') || raw.includes('23505')
            ? 'Ese número de contenedor ya tiene una operación activa.'
            : raw;
    return fail(res, 400, message);
  }
}
