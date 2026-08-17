import { supabase, writeAudit } from './_lib.js';

export function shipmentIsDelivered(shipment) {
  const status = `${shipment?.operational_status || ''} ${shipment?.last_status || ''}`.trim().toLowerCase();
  return shipment?.active === false || Boolean(shipment?.delivered_at) || status.includes('entregado') || status.includes('delivered');
}

export function operationIsFinalized(operation) {
  const shipments = Array.isArray(operation?.shipments) ? operation.shipments : [];
  return shipments.length > 0 && shipments.every(shipmentIsDelivered);
}

export async function reconcileOperationLifecycle(operationId, actor = null, context = {}) {
  if (!operationId) return null;
  const operations = await supabase('operations', {
    query: `?select=id,status,operation_code,closed_at&id=eq.${encodeURIComponent(operationId)}&limit=1`
  });
  const operation = operations?.[0];
  if (!operation) return null;

  const shipments = await supabase('shipments', {
    query: `?select=id,active,operational_status,last_status,delivered_at&operation_id=eq.${encodeURIComponent(operation.id)}`
  });
  const rows = shipments || [];
  if (!rows.length) return { operation_id: operation.id, finalized: false, changed: false };

  const finalized = rows.every(shipmentIsDelivered);
  const storedFinalized = operation.status === 'delivered' || operation.status === 'closed';
  if (finalized === storedFinalized) return { operation_id: operation.id, finalized, changed: false };

  const now = new Date().toISOString();
  const nextStatus = finalized ? 'closed' : 'confirmed';
  await supabase('operations', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(operation.id)}`,
    body: { status: nextStatus, closed_at: finalized ? now : null, updated_at: now }
  });

  await writeAudit(
    actor,
    finalized ? 'expediente_auto_finalized' : 'expediente_auto_reopened',
    'operation',
    operation.id,
    {
      operation_code: operation.operation_code || null,
      from: operation.status,
      to: nextStatus,
      shipment_count: rows.length,
      source: context.source || 'shipment_lifecycle',
      shipment_id: context.shipment_id || null
    }
  );

  return { operation_id: operation.id, finalized, changed: true, status: nextStatus };
}
