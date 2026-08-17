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
  'No depende de las importadoras registradas para el cliente'
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

if (errors.length) {
  console.error('Validación de independencia de importadora fallida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validación de importadora por contenedor superada.');
console.log('- La importadora del contenedor se captura manualmente y puede reutilizar catálogo existente.');
console.log('- El cliente conserva por separado las importadoras donde está registrado.');
console.log('- El backend no exige relación client_importers para asignar la importadora de un contenedor.');
