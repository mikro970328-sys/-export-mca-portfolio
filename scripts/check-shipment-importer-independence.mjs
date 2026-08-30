import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = {
  containers: 'admin/containers-module.js',
  editor: 'admin/shipment-editor.js',
  api: 'api/importers.js'
};

const errors = [];
const read = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) errors.push(`Falta archivo requerido: ${file}`);
}

for (const file of Object.values(files)) {
  if (!fs.existsSync(file)) continue;
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) errors.push(`Error de sintaxis en ${file}:\n${result.stderr || result.stdout}`);
}

const containers = read(files.containers);
const editor = read(files.editor);
const api = read(files.api);

for (const fragment of [
  '<input id="shipmentImporter"',
  'shipmentImporterOptions',
  'importer_name:',
  'Escribe la importadora concreta de este contenedor'
]) {
  if (!containers.includes(fragment)) errors.push(`Registro de contenedor no refleja importadora independiente: ${fragment}`);
}

for (const forbidden of [
  'function importerIdsForClient',
  'La importadora seleccionada no está registrada para este cliente',
  "shipmentClient')?.addEventListener('change', syncImporter"
]) {
  if (containers.includes(forbidden)) errors.push(`Registro de contenedor sigue acoplado al cliente: ${forbidden}`);
}

for (const fragment of [
  '<input id="editorImporter"',
  'editorImporterOptions',
  'importer_name:',
  'No depende de las importadoras donde esté registrado el cliente'
]) {
  if (!editor.includes(fragment)) errors.push(`Editor de contenedor no refleja importadora independiente: ${fragment}`);
}

for (const forbidden of [
  'function importerIdsForClient',
  'La importadora seleccionada no está registrada para ese cliente',
  "editorClient')?.addEventListener('change', syncImporter"
]) {
  if (editor.includes(forbidden)) errors.push(`Editor de contenedor sigue acoplado al cliente: ${forbidden}`);
}

for (const fragment of [
  'importerNameValue',
  'ensureImporter(importerName)',
  'independent_from_client_registration: true'
]) {
  if (!api.includes(fragment)) errors.push(`Backend de importadoras no refleja independencia por contenedor: ${fragment}`);
}

const assignmentStart = api.indexOf('async function assignShipmentImporter');
const assignmentEnd = api.indexOf('\nexport default async function handler', assignmentStart);
const assignmentBlock = assignmentStart >= 0 && assignmentEnd > assignmentStart ? api.slice(assignmentStart, assignmentEnd) : '';
if (!assignmentBlock) errors.push('No se encontró assignShipmentImporter.');
if (assignmentBlock.includes('client_importers')) errors.push('assignShipmentImporter no puede validar contra client_importers.');
if (assignmentBlock.includes('no está registrada para este cliente')) errors.push('assignShipmentImporter conserva la restricción incorrecta por cliente.');

for (const fragment of [
  'function importerForShipment(shipment)',
  '/api/importers',
  "export-mca:importers-changed"
]) {
  if (!containers.includes(fragment)) errors.push(`Tracking no resuelve la importadora desde el contenedor: ${fragment}`);
}

if (/Expediente/i.test(files.containers)) errors.push('El contrato UX-E5 no debe depender de Expedientes.');

if (errors.length) {
  console.error('Validación UX-E5 fallida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validación UX-E5 superada.');
console.log('- Cliente e importadoras registradas permanecen como relación de referencia.');
console.log('- Cada contenedor acepta una sola importadora operativa independiente.');
console.log('- Tracking y editor resuelven la importadora desde el contenedor.');
console.log('- UX-E5 ya no depende del módulo Expedientes.');
