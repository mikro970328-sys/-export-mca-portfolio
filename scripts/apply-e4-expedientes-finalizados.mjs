import fs from 'node:fs';

function edit(path, transform) {
  const before = fs.readFileSync(path, 'utf8');
  const after = transform(before);
  if (after === before) throw new Error(`Sin cambios esperados en ${path}`);
  fs.writeFileSync(path, after);
}

function replaceOnce(source, from, to, label) {
  const count = source.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: se esperaba 1 coincidencia y hubo ${count}`);
  return source.replace(from, to);
}

const lifecycle = `import { supabase, writeAudit } from './_lib.js';

export function shipmentIsDelivered(shipment) {
  const status = \`${'${shipment?.operational_status || \'\'} ${shipment?.last_status || \'\'}'}\`.trim().toLowerCase();
  return shipment?.active === false || Boolean(shipment?.delivered_at) || status.includes('entregado') || status.includes('delivered');
}

export function operationIsFinalized(operation) {
  const shipments = Array.isArray(operation?.shipments) ? operation.shipments : [];
  return shipments.length > 0 && shipments.every(shipmentIsDelivered);
}

export async function reconcileOperationLifecycle(operationId, actor = null, context = {}) {
  if (!operationId) return null;
  const operations = await supabase('operations', {
    query: \`?select=id,status,operation_code,closed_at&id=eq.\${encodeURIComponent(operationId)}&limit=1\`
  });
  const operation = operations?.[0];
  if (!operation) return null;

  const shipments = await supabase('shipments', {
    query: \`?select=id,active,operational_status,last_status,delivered_at&operation_id=eq.\${encodeURIComponent(operation.id)}\`
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
    query: \`?id=eq.\${encodeURIComponent(operation.id)}\`,
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
`;
fs.writeFileSync('api/_operation-lifecycle.js', lifecycle);

edit('api/shipments.js', source => {
  source = replaceOnce(source,
    "import { fail, normalizeContainer, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';",
    "import { fail, normalizeContainer, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';\nimport { reconcileOperationLifecycle } from './_operation-lifecycle.js';",
    'shipments import');
  source = replaceOnce(source,
    "        await audit(active ? 'shipment_reactivated' : 'shipment_delivered', shipment, { actor: admin.username });\n        return ok(res, { active, status });",
    "        await audit(active ? 'shipment_reactivated' : 'shipment_delivered', shipment, { actor: admin.username });\n        await reconcileOperationLifecycle(shipment.operation_id, admin, { source: active ? 'shipment_reactivated' : 'shipment_delivered', shipment_id: shipment.id });\n        return ok(res, { active, status });",
    'shipments lifecycle');
  return source;
});

edit('api/manual-tracking-event.js', source => {
  source = replaceOnce(source,
    "import { fail, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';",
    "import { fail, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';\nimport { reconcileOperationLifecycle } from './_operation-lifecycle.js';",
    'manual import');
  source = replaceOnce(source,
    "    await supabase('shipments', {\n      method: 'PATCH',\n      query: `?id=eq.${encodeURIComponent(id)}`,\n      body: patch\n    });\n\n    const correctionDetail",
    "    await supabase('shipments', {\n      method: 'PATCH',\n      query: `?id=eq.${encodeURIComponent(id)}`,\n      body: patch\n    });\n    await reconcileOperationLifecycle(shipment.operation_id, admin, { source: `manual_tracking_${eventKey}`, shipment_id: shipment.id });\n\n    const correctionDetail",
    'manual lifecycle');
  return source;
});

edit('api/operations.js', source => {
  source = replaceOnce(source,
    "import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';",
    "import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';\nimport { operationIsFinalized, reconcileOperationLifecycle } from './_operation-lifecycle.js';",
    'operations import');
  source = replaceOnce(source,
    "  await writeAudit(admin, 'shipment_assigned_to_expediente', 'operation', operation.id, {\n    shipment_id: shipment.id,\n    container_number: shipment.container_number,\n    client_id: operation.client_id\n  });\n\n  return getOperation(operation.id);",
    "  await writeAudit(admin, 'shipment_assigned_to_expediente', 'operation', operation.id, {\n    shipment_id: shipment.id,\n    container_number: shipment.container_number,\n    client_id: operation.client_id\n  });\n  await reconcileOperationLifecycle(operation.id, admin, { source: 'shipment_assigned', shipment_id: shipment.id });\n\n  return getOperation(operation.id);",
    'assign reconcile');
  source = replaceOnce(source,
    "  await writeAudit(admin, 'shipment_unassigned_from_expediente', 'operation', operation.id, {\n    shipment_id: shipment.id,\n    container_number: shipment.container_number,\n    client_id: operation.client_id\n  });\n\n  return getOperation(operation.id);",
    "  await writeAudit(admin, 'shipment_unassigned_from_expediente', 'operation', operation.id, {\n    shipment_id: shipment.id,\n    container_number: shipment.container_number,\n    client_id: operation.client_id\n  });\n  await reconcileOperationLifecycle(operation.id, admin, { source: 'shipment_unassigned', shipment_id: shipment.id });\n\n  return getOperation(operation.id);",
    'unassign reconcile');
  source = replaceOnce(source,
    "  const closed = next === 'delivered' || next === 'closed';\n  const rows = await supabase('operations', {",
    "  const currentlyFinalized = operationIsFinalized(operation);\n  const requestedFinalized = next === 'delivered' || next === 'closed';\n  if (requestedFinalized && !currentlyFinalized) throw new Error('El expediente solo puede finalizar cuando todos sus contenedores estén entregados');\n  if (!requestedFinalized && currentlyFinalized) throw new Error('Reactiva primero al menos un contenedor antes de reabrir este expediente');\n  const closed = requestedFinalized;\n  const rows = await supabase('operations', {",
    'status guard');
  return source;
});

edit('api/dashboard.js', source => {
  source = replaceOnce(source,
    "function buildOperationStats(operations, shipments) {\n  const activeOperations = operations.filter(operation => !CLOSED_OPERATION_STATUSES.has(normalize(operation.status)));\n  const linkedOperationIds = new Set(\n    shipments\n      .filter(shipment => shipment.operation_id)\n      .map(shipment => String(shipment.operation_id))\n  );\n\n  return {\n    total: operations.length,\n    active: activeOperations.length,\n    incomplete: activeOperations.filter(operation => !linkedOperationIds.has(String(operation.id))).length,\n    closed: operations.length - activeOperations.length\n  };\n}",
    "function buildOperationStats(operations, shipments) {\n  const byOperation = new Map();\n  shipments.forEach(shipment => {\n    if (!shipment.operation_id) return;\n    const key = String(shipment.operation_id);\n    if (!byOperation.has(key)) byOperation.set(key, []);\n    byOperation.get(key).push(shipment);\n  });\n  const isFinalized = operation => {\n    const linked = byOperation.get(String(operation.id)) || [];\n    return linked.length > 0 && linked.every(shipment => classifyShipment(shipment) === 'delivered');\n  };\n  const activeOperations = operations.filter(operation => !isFinalized(operation) && normalize(operation.status) !== 'cancelled');\n\n  return {\n    total: operations.length,\n    active: activeOperations.length,\n    incomplete: activeOperations.filter(operation => !(byOperation.get(String(operation.id)) || []).length).length,\n    closed: operations.filter(operation => isFinalized(operation)).length\n  };\n}",
    'dashboard lifecycle projection');
  source = source.replace("const CLOSED_OPERATION_STATUSES = new Set(['delivered', 'closed', 'cancelled']);\n\n", '');
  return source;
});

edit('admin/expedientes-module.js', source => {
  source = replaceOnce(source,
    "  function isDelivered(operation) { return operation?.status === 'delivered' || operation?.status === 'closed'; }",
    "  function isFinalized(operation) { const shipments = allOperationShipments(operation); return shipments.length > 0 && shipments.every(isShipmentDelivered); }",
    'frontend lifecycle predicate');
  source = source.replaceAll('isDelivered(operation)', 'isFinalized(operation)');
  source = source.replaceAll('>Entregados</button>', '>Finalizados</button>');
  source = source.replaceAll('No hay expedientes entregados.', 'No hay expedientes finalizados.');
  source = source.replaceAll('operaciones actuales o históricas', 'operaciones activas o finalizadas');
  source = source.replaceAll("if (shipments.every(isShipmentDelivered)) return 'Listo para archivar';", "if (shipments.every(isShipmentDelivered)) return 'Finalizado';");
  return source;
});

edit('admin/dashboard-operational-state.js', source => {
  source = source.replace("['Expedientes cerrados', operations.closed, 'Histórico completado']", "['Expedientes finalizados', operations.closed, 'Operaciones completadas']");
  return source;
});

console.log('UX-E4 aplicada correctamente');
