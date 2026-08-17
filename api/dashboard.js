import { fail, ok, requireAdmin, supabase } from './_lib.js';

function normalize(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function classifyShipment(shipment) {
  const status = normalize(shipment.operational_status || shipment.last_status || 'registrado');

  if (shipment.active === false || shipment.delivered_at || /entreg|delivered|cerrad|closed/.test(status)) {
    return 'delivered';
  }
  if (shipment.released_at || /liberad|released|disponible para entrega|available for delivery/.test(status)) {
    return 'released';
  }
  if (/esperando liberacion|awaiting release|pendiente de liberacion/.test(status)) {
    return 'awaiting_release';
  }
  if (/destino|destination|arribo|arrived|descargad|discharged/.test(status)) {
    return 'at_destination';
  }
  if (/transit|transito|salio del puerto|salida del puerto|cargado en el buque|loaded on vessel|en navegacion|navegando|transbordo|transshipment|zarpo|zarpado|booking confirmado|cargado/.test(status)) {
    return 'in_transit';
  }
  return 'active_other';
}

function buildShipmentStats(shipments) {
  const stats = {
    total: shipments.length,
    active: 0,
    in_transit: 0,
    at_destination: 0,
    awaiting_release: 0,
    released: 0,
    delivered: 0,
    active_other: 0
  };

  for (const shipment of shipments) {
    const group = classifyShipment(shipment);
    if (group !== 'delivered' && shipment.active !== false) stats.active += 1;
    stats[group] += 1;
  }

  return stats;
}

function buildOperationStats(operations, shipments) {
  const byOperation = new Map();
  shipments.forEach(shipment => {
    if (!shipment.operation_id) return;
    const key = String(shipment.operation_id);
    if (!byOperation.has(key)) byOperation.set(key, []);
    byOperation.get(key).push(shipment);
  });
  const isFinalized = operation => {
    const linked = byOperation.get(String(operation.id)) || [];
    return linked.length > 0 && linked.every(shipment => classifyShipment(shipment) === 'delivered');
  };
  const activeOperations = operations.filter(operation => !isFinalized(operation) && normalize(operation.status) !== 'cancelled');

  return {
    total: operations.length,
    active: activeOperations.length,
    incomplete: activeOperations.filter(operation => !(byOperation.get(String(operation.id)) || []).length).length,
    closed: operations.filter(operation => isFinalized(operation)).length
  };
}

function recentActivity(shipments) {
  return [...shipments]
    .sort((a, b) => new Date(b.updated_at || b.last_event_at || b.created_at || 0) - new Date(a.updated_at || a.last_event_at || a.created_at || 0))
    .slice(0, 6)
    .map(shipment => ({
      id: shipment.id,
      container_number: shipment.container_number,
      client_name: shipment.clients?.name || null,
      operational_status: shipment.operational_status || shipment.last_status || 'Registrado',
      updated_at: shipment.updated_at || shipment.last_event_at || shipment.created_at || null
    }));
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const [clients, shipments, operations] = await Promise.all([
      supabase('clients', { query: '?select=id,active' }),
      supabase('shipments', {
        query: '?select=id,client_id,operation_id,container_number,active,operational_status,last_status,last_event_at,updated_at,created_at,released_at,delivered_at,clients(id,name)'
      }),
      supabase('operations', { query: '?select=id,status,updated_at,closed_at' })
    ]);

    const shipmentRows = shipments || [];
    const shipmentStats = buildShipmentStats(shipmentRows);
    const operationStats = buildOperationStats(operations || [], shipmentRows);

    return ok(res, {
      owner: 'api/dashboard.js',
      generated_at: new Date().toISOString(),
      stats: {
        clients: (clients || []).filter(client => client.active !== false).length,
        ...shipmentStats
      },
      operations: operationStats,
      recent_activity: recentActivity(shipmentRows)
    });
  } catch (error) {
    console.error('[dashboard]', error);
    return fail(res, 400, error.message || 'No se pudo cargar el dashboard');
  }
}
