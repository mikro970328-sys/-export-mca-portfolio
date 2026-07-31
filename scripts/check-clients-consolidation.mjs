import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = {
  clients: 'admin/clients-module.js',
  loader: 'admin/erp.js',
  operations: 'admin/erp-core.js',
  shipmentDetails: 'admin/shipment-row-details.js',
  informationPatch: 'admin/client-information.js',
  extraFieldsLegacy: 'admin/client-extra-fields.js',
  actionsMenuLegacy: 'admin/client-actions-menu.js'
};

const errors = [];

for (const file of [files.clients, files.loader, files.operations, files.shipmentDetails]) {
  if (!fs.existsSync(file)) {
    errors.push(`Falta el archivo requerido: ${file}`);
    continue;
  }
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(`Error de sintaxis en ${file}:\n${result.stderr || result.stdout}`);
}

for (const legacyFile of [files.extraFieldsLegacy, files.actionsMenuLegacy]) {
  if (!fs.existsSync(legacyFile)) errors.push(`El archivo legacy debe conservarse para rollback durante esta fase: ${legacyFile}`);
}

if (fs.existsSync(files.informationPatch)) {
  errors.push(`${files.informationPatch} no debe existir: Información pertenece al módulo consolidado.`);
}

const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
const clientsModule = read(files.clients);
const loader = read(files.loader);
const operations = read(files.operations);
const shipmentDetails = read(files.shipmentDetails);

const requiredClientFragments = [
  'clientName', 'clientCompany', 'clientMipyme', 'clientImporter', 'clientPhone', 'clientEmail',
  'data-client-menu-trigger', 'client-actions-popover',
  "['information', 'Información'", 'openClientInformation', 'informationHtml',
  "['edit', 'Editar'", "['welcome', welcomeLabel", "['history', 'Historial'", "['delete', 'Eliminar'",
  'mipyme_name', 'importer_name', 'export-mca:clients-changed'
];

for (const fragment of requiredClientFragments) {
  if (!clientsModule.includes(fragment)) errors.push(`Falta en ${files.clients}: ${fragment}`);
}

const forbiddenClientFragments = [
  'MutationObserver', 'cloneNode(', 'replaceWith(', 'window.clients',
  "fetch('/api/clients'", 'fetch("/api/clients"',
  'data-client-information', 'queueMicrotask(() => insertInformationAction'
];

for (const fragment of forbiddenClientFragments) {
  if (clientsModule.includes(fragment)) errors.push(`Patrón prohibido en ${files.clients}: ${fragment}`);
}

if (!loader.includes('/admin/clients-module.js')) errors.push('El loader no carga admin/clients-module.js');
for (const forbiddenLoader of [
  "loadScript('/admin/client-extra-fields.js'",
  "loadScript('/admin/client-actions-menu.js'",
  "loadScript('/admin/client-information.js'"
]) {
  if (loader.includes(forbiddenLoader)) errors.push(`El loader activa un parche prohibido: ${forbiddenLoader}`);
}

if (!loader.includes('decodeURIComponent(')) errors.push('El loader no contiene decodeURIComponent() válido.');
if (/\bdeURIComponent\s*\(/.test(loader)) errors.push('El loader contiene el error tipográfico deURIComponent().');

if (!operations.includes("typeof fillClientSelects === 'function'")) errors.push('erp-core.js no utiliza fillClientSelects() como fuente compartida');
if (!operations.includes("window.addEventListener('export-mca:clients-changed', loadOperations)")) errors.push('erp-core.js no actualiza Expedientes mediante el evento explícito de Clientes');

for (const fragment of ['const fillClients =', "clients.map(c => `<option", 'window.loadAll = async function']) {
  if (operations.includes(fragment)) errors.push(`Patrón de selector o wrapper legacy en ${files.operations}: ${fragment}`);
}

for (const fragment of ['Array.isArray(shipments)', 'Array.isArray(clients)', 'clientsById', 'byNumber']) {
  if (!shipmentDetails.includes(fragment)) errors.push(`Falta reutilización de datos en ${files.shipmentDetails}: ${fragment}`);
}

for (const fragment of [
  "request('/api/clients')", 'request("/api/clients")',
  "request('/api/shipments')", 'request("/api/shipments")',
  "fetch('/api/clients'", "fetch('/api/shipments'"
]) {
  if (shipmentDetails.includes(fragment)) errors.push(`Consulta duplicada en ${files.shipmentDetails}: ${fragment}`);
}

if (errors.length) {
  console.error('Validación de Clientes fallida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validación de Clientes superada.');
console.log('- Información está integrada directamente en clients-module.js.');
console.log('- No existe ni se carga client-information.js.');
console.log('- Sintaxis válida en Clientes, loader, Expedientes y detalles de tracking.');
console.log('- Seis campos y menú integrado con claves estables.');
console.log('- Sin MutationObserver ni reemplazo de botones en el módulo nuevo.');
console.log('- Expedientes usa fillClientSelects() y no envuelve loadAll.');
console.log('- Los detalles del tracking reutilizan clients y shipments ya cargados.');
