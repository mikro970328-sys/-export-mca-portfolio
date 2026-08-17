import fs from 'node:fs';

function replaceRegex(text, regex, replacement, label) {
  const matches = [...text.matchAll(new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`))];
  if (matches.length !== 1) throw new Error(`${label}: se esperó 1 coincidencia y se encontraron ${matches.length}`);
  return text.replace(regex, replacement);
}

function replaceExact(text, from, to, label) {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${label}: se esperó 1 coincidencia y se encontraron ${count}`);
  return text.replace(from, to);
}

const containersPath = 'admin/containers-module.js';
let containers = fs.readFileSync(containersPath, 'utf8');

containers = replaceRegex(
  containers,
  /  function importerIdsForClient\(clientId\) \{[\s\S]*?\n  \}\n\n  function ensureRegistrationImporterField/,
  `  function importerSuggestions() {\n    return importerState.importers\n      .filter(importer => importer.active !== false)\n      .map(importer => \`<option value="\${esc(importer.name)}"></option>\`)\n      .join('');\n  }\n\n  function ensureRegistrationImporterField`,
  'containers: catálogo libre'
);

containers = replaceExact(
  containers,
  `    wrapper.innerHTML = \`<label for="shipmentImporter">Importadora cubana</label><select id="shipmentImporter"><option value="">Sin importadora definida</option></select><div id="shipmentImporterHelp" class="container-importer-help">Selecciona por cuál importadora entrará este contenedor.</div>\`;`,
  `    wrapper.innerHTML = \`<label for="shipmentImporter">Importadora cubana</label><input id="shipmentImporter" list="shipmentImporterOptions" placeholder="Ej. Quimimport, Servoven"><datalist id="shipmentImporterOptions"></datalist><div id="shipmentImporterHelp" class="container-importer-help">Escribe la importadora concreta por la que entrará este contenedor. No depende de las importadoras registradas para el cliente.</div>\`;`,
  'containers: campo libre'
);

containers = replaceExact(
  containers,
  `    if ([...select.options].some(option => option.value === selected)) select.value = selected;\n    syncImporterSelect();`,
  `    if ([...select.options].some(option => option.value === selected)) select.value = selected;`,
  'containers: cliente no controla importadora'
);

containers = replaceRegex(
  containers,
  /  function syncImporterSelect\(\) \{[\s\S]*?\n  \}\n\n  async function assignImporterToShipment\(shipmentId, importerId\) \{[\s\S]*?\n  \}/,
  `  function syncImporterInput() {\n    const list = byId('shipmentImporterOptions');\n    if (list) list.innerHTML = importerSuggestions();\n    const help = byId('shipmentImporterHelp');\n    if (help) help.textContent = 'Escribe la importadora concreta por la que entrará este contenedor. Puedes usar una existente o escribir una nueva.';\n  }\n\n  async function assignImporterToShipment(shipmentId, importerName) {\n    const result = await request('/api/importers', {\n      method: 'PATCH',\n      body: JSON.stringify({ action: 'assign_shipment', shipment_id: shipmentId, importer_name: String(importerName || '').trim() })\n    });\n    if (result.state) {\n      importerState = result.state;\n      window.importerState = importerState;\n    } else {\n      await loadImporterState();\n    }\n    return result;\n  }`,
  'containers: sincronización libre'
);

containers = replaceExact(
  containers,
  `    const clientId = byId('shipmentClient')?.value || null;\n    const importerId = byId('shipmentImporter')?.value || null;\n    if (clientId && importerId && !importerIdsForClient(clientId).has(String(importerId))) {\n      return note('La importadora seleccionada no está registrada para este cliente.');\n    }`,
  `    const clientId = byId('shipmentClient')?.value || null;\n    const importerName = String(byId('shipmentImporter')?.value || '').trim();`,
  'containers: validación independiente'
);

containers = replaceExact(
  containers,
  `      if (rollbackShipmentId && importerId) {\n        try {\n          await assignImporterToShipment(rollbackShipmentId, importerId);`,
  `      if (rollbackShipmentId && importerName) {\n        try {\n          await assignImporterToShipment(rollbackShipmentId, importerName);`,
  'containers: guardar importadora por nombre'
);

containers = containers.replaceAll('syncImporterSelect();', 'syncImporterInput();');
containers = replaceExact(
  containers,
  `    byId('shipmentClient')?.addEventListener('change', syncImporterInput);\n`,
  '',
  'containers: eliminar dependencia change cliente'
);

fs.writeFileSync(containersPath, containers);

const expedientesPath = 'admin/expedientes-module.js';
let expedientes = fs.readFileSync(expedientesPath, 'utf8');

expedientes = replaceExact(
  expedientes,
  `  function clientForShipment(shipment) { return shipment?.clients || allClients().find(client => String(client.id) === String(shipment?.client_id)) || null; }`,
  `  function clientForShipment(shipment) { return shipment?.clients || allClients().find(client => String(client.id) === String(shipment?.client_id)) || null; }\n  function importerForShipment(shipment) {\n    const importerState = window.importerState || { importers: [], shipment_importers: [] };\n    const importerId = importerState.shipment_importers?.find(item => String(item.shipment_id) === String(shipment?.id || ''))?.importer_id || shipment?.importer_id || null;\n    return importerState.importers?.find(item => String(item.id) === String(importerId || '')) || null;\n  }`,
  'expedientes: resolver importadora por contenedor'
);

expedientes = replaceExact(
  expedientes,
  `    const values = [operation.operation_code, client?.name, client?.company, client?.mipyme_name, client?.phone, ...allOperationShipments(operation).flatMap(shipment => [shipment.container_number, shipment.bol_number, shipment.booking_number, shipment.product])];`,
  `    const values = [operation.operation_code, client?.name, client?.company, client?.mipyme_name, client?.phone, ...allOperationShipments(operation).flatMap(shipment => [shipment.container_number, shipment.bol_number, shipment.booking_number, shipment.product, importerForShipment(shipment)?.name])];`,
  'expedientes: buscar por importadora'
);

expedientes = replaceExact(
  expedientes,
  `      const [operationsResult, documentsResult] = await Promise.all([api('/api/operations'), api('/api/documents')]);\n      state.operations = operationsResult.operations || [];\n      state.documents = documentsResult.documents || [];`,
  `      const [operationsResult, documentsResult, importerResult] = await Promise.all([api('/api/operations'), api('/api/documents'), api('/api/importers')]);\n      state.operations = operationsResult.operations || [];\n      state.documents = documentsResult.documents || [];\n      window.importerState = {\n        importers: importerResult.importers || [],\n        client_importers: importerResult.client_importers || [],\n        shipment_importers: importerResult.shipment_importers || []\n      };`,
  'expedientes: cargar catálogo de importadoras'
);

expedientes = replaceExact(
  expedientes,
  `      return \`<div class="exp-container-card"><div class="exp-container-belongs">\${esc(groupLabel)}</div><div class="exp-container-line"><div><b>\${esc(shipment.container_number || '—')}</b><div class="muted">\${esc(shipment.product || 'Sin producto')}\${shipment.operational_status ? \` · \${esc(shipment.operational_status)}\` : ''}</div></div><div class="exp-container-actions">`,
  `      const importer = importerForShipment(shipment);\n      return \`<div class="exp-container-card"><div class="exp-container-belongs">\${esc(groupLabel)}</div><div class="exp-container-line"><div><b>\${esc(shipment.container_number || '—')}</b><div class="muted">\${esc(shipment.product || 'Sin producto')}\${shipment.operational_status ? \` · \${esc(shipment.operational_status)}\` : ''} · Importadora: \${esc(importer?.name || 'Sin definir')}</div></div><div class="exp-container-actions">`,
  'expedientes: importadora en tarjeta de contenedor'
);

expedientes = replaceExact(
  expedientes,
  `    const containerChips = shipments.length ? \`<div class="exp-summary-label">Contenedores del expediente</div><div class="exp-container-chips">\${shipments.map(shipment => \`<span class="pill">\${esc(shipment.container_number || '—')} · \${shipment.bol_number ? \`B/L \${esc(shipment.bol_number)}\` : 'B/L pendiente'}</span>\`).join('')}</div>\` : '<div class="muted" style="margin-top:10px">No quedan contenedores activos en este expediente.</div>';`,
  `    const containerChips = shipments.length ? \`<div class="exp-summary-label">Contenedores del expediente</div><div class="exp-container-chips">\${shipments.map(shipment => \`<span class="pill">\${esc(shipment.container_number || '—')} · \${shipment.bol_number ? \`B/L \${esc(shipment.bol_number)}\` : 'B/L pendiente'} · \${esc(importerForShipment(shipment)?.name || 'Importadora sin definir')}</span>\`).join('')}</div>\` : '<div class="muted" style="margin-top:10px">No quedan contenedores activos en este expediente.</div>';`,
  'expedientes: importadora en resumen'
);

expedientes = replaceExact(
  expedientes,
  `<th>Contenedor</th><th>Producto</th><th>B/L</th><th></th>`,
  `<th>Contenedor</th><th>Producto</th><th>Importadora</th><th>B/L</th><th></th>`,
  'expedientes: columna importadora'
);

expedientes = replaceExact(
  expedientes,
  `<td>\${esc(shipment.product || '—')}</td><td>\${esc(shipment.bol_number || 'Pendiente')}`,
  `<td>\${esc(shipment.product || '—')}</td><td>\${esc(importerForShipment(shipment)?.name || 'Sin definir')}</td><td>\${esc(shipment.bol_number || 'Pendiente')}`,
  'expedientes: valor importadora en gestión'
);

expedientes = replaceExact(
  expedientes,
  `\${esc(shipment.product || 'Sin producto')} · B/L \${esc(shipment.bol_number || 'pendiente')}`,
  `\${esc(shipment.product || 'Sin producto')} · Importadora: \${esc(importerForShipment(shipment)?.name || 'Sin definir')} · B/L \${esc(shipment.bol_number || 'pendiente')}`,
  'expedientes: importadora en disponibles'
);

fs.writeFileSync(expedientesPath, expedientes);
console.log('UX-E5 aplicada a registro y expedientes.');
