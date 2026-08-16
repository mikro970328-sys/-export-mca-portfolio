import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const OPERATION_SELECT = [
  'id',
  'operation_code',
  'client_id',
  'status',
  'notes',
  'created_at',
  'updated_at',
  'closed_at',
  'client:clients!operations_client_id_fkey(id,name,company,mipyme_name,importer_name,phone,email)',
  'shipments:shipments!shipments_operation_id_fkey(id,client_id,operation_id,container_number,booking_number,bol_number,carrier,product,quantity,quantity_unit,departure_date,operational_status,last_status,last_location,last_event_at,active)'
].join(',');

const ALLOWED_STATUS = new Set([
  'draft', 'quoted', 'confirmed', 'purchased', 'booked', 'in_transit',
  'at_destination', 'released', 'delivered', 'closed', 'cancelled'
]);

function required(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label}_REQUIRED`);
  return text;
}

function nullable(value, max = 2000) {
  const text = String(value ?? '').trim();
  return text ? text.slice(0, max) : null;
}

async function getClient(id) {
  const rows = await supabase('clients', {
    query: `?select=id,name,company&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Cliente no encontrado');
  return rows[0];
}

async function getOperation(id) {
  const rows = await supabase('operations', {
    query: `?select=${encodeURIComponent(OPERATION_SELECT)}&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Expediente no encontrado');
  return rows[0];
}

async function getShipment(id) {
  const rows = await supabase('shipments', {
    query: `?select=id,client_id,operation_id,container_number,bol_number,product,operational_status,last_status&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Contenedor no encontrado');
  return rows[0];
}

async function assignShipment(admin, operationId, shipmentId) {
  const operation = await getOperation(operationId);
  const shipment = await getShipment(shipmentId);

  if (String(shipment.client_id || '') !== String(operation.client_id || '')) {
    throw new Error('El contenedor pertenece a otro cliente');
  }
  if (shipment.operation_id && String(shipment.operation_id) !== String(operation.id)) {
    throw new Error('El contenedor ya pertenece a otro expediente');
  }

  await supabase('shipments', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(shipment.id)}`,
    body: { operation_id: operation.id, updated_at: new Date().toISOString() }
  });

  await writeAudit(admin, 'shipment_assigned_to_expediente', 'operation', operation.id, {
    shipment_id: shipment.id,
    container_number: shipment.container_number,
    client_id: operation.client_id
  });

  return getOperation(operation.id);
}

async function unassignShipment(admin, operationId, shipmentId) {
  const operation = await getOperation(operationId);
  const shipment = await getShipment(shipmentId);

  if (String(shipment.operation_id || '') !== String(operation.id)) {
    throw new Error('Ese contenedor no pertenece a este expediente');
  }

  await supabase('shipments', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(shipment.id)}`,
    body: { operation_id: null, updated_at: new Date().toISOString() }
  });

  await writeAudit(admin, 'shipment_unassigned_from_expediente', 'operation', operation.id, {
    shipment_id: shipment.id,
    container_number: shipment.container_number,
    client_id: operation.client_id
  });

  return getOperation(operation.id);
}

async function setStatus(admin, operationId, status) {
  const operation = await getOperation(operationId);
  const next = required(status, 'STATUS').toLowerCase();
  if (!ALLOWED_STATUS.has(next)) throw new Error('Estado de expediente inválido');

  const closed = next === 'delivered' || next === 'closed';
  const rows = await supabase('operations', {
    method: 'PATCH',
    prefer: 'return=representation',
    query: `?id=eq.${encodeURIComponent(operation.id)}`,
    body: {
      status: next,
      closed_at: closed ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    }
  });

  await writeAudit(admin, 'expediente_status_changed', 'operation', operation.id, {
    from: operation.status,
    to: next,
    operation_code: operation.operation_code
  });

  return rows?.[0] ? getOperation(operation.id) : null;
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const id = String(req.query?.id || '').trim();
      if (id) return ok(res, { operation: await getOperation(id) });

      const rows = await supabase('operations', {
        query: `?select=${encodeURIComponent(OPERATION_SELECT)}&order=created_at.desc`
      });
      return ok(res, { operations: rows || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const clientId = required(body.client_id, 'CLIENT');
      await getClient(clientId);

      const created = await supabase('operations', {
        method: 'POST',
        prefer: 'return=representation',
        body: {
          client_id: clientId,
          status: 'draft',
          notes: nullable(body.notes),
          created_by: null
        }
      });
      const operation = created?.[0];
      if (!operation?.id) throw new Error('No se pudo crear el expediente');

      await writeAudit(admin, 'expediente_created', 'operation', operation.id, {
        operation_code: operation.operation_code,
        client_id: clientId
      });

      return ok(res, { operation: await getOperation(operation.id) });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const action = required(body.action, 'ACTION');
      const operationId = required(body.operation_id, 'OPERATION');

      if (action === 'assign_shipment') {
        return ok(res, { operation: await assignShipment(admin, operationId, required(body.shipment_id, 'SHIPMENT')) });
      }
      if (action === 'unassign_shipment') {
        return ok(res, { operation: await unassignShipment(admin, operationId, required(body.shipment_id, 'SHIPMENT')) });
      }
      if (action === 'set_status') {
        return ok(res, { operation: await setStatus(admin, operationId, body.status) });
      }
      if (action === 'update_notes') {
        const rows = await supabase('operations', {
          method: 'PATCH',
          prefer: 'return=representation',
          query: `?id=eq.${encodeURIComponent(operationId)}`,
          body: { notes: nullable(body.notes), updated_at: new Date().toISOString() }
        });
        if (!rows?.[0]) throw new Error('Expediente no encontrado');
        await writeAudit(admin, 'expediente_notes_updated', 'operation', operationId);
        return ok(res, { operation: await getOperation(operationId) });
      }

      return fail(res, 400, 'Acción de expediente inválida');
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('[operations]', error);
    return fail(res, 400, error.message || 'No se pudo procesar el expediente');
  }
}
