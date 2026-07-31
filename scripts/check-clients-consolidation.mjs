import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = {
  clients: 'admin/clients-module.js',
  loader: 'admin/erp.js',
  operations: 'admin/erp-core.js',
  extraFieldsLegacy: 'admin/client-extra-fields.js',
  actionsMenuLegacy: 'admin/client-actions-menu.js'
};

const errors = [];

for (const file of [files.clients, files.loader, files.operations]) {
  if (!fs.existsSync(file)) {
    errors.push(`Falta el archivo requerido: ${file}`);
    continue;
  }

  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    errors.push(`Error de sintaxis en ${file}:\n${result.stderr || result.stdout}`);
  }
}

for (const legacyFile of [files.extraFieldsLegacy, files.actionsMenuLegacy]) {
  if (!fs.existsSync(legacyFile)) {
    errors.push(`El archivo legacy debe conservarse para rollback durante esta fase: ${legacyFile}`);
  }
}

const clientsModule = fs.existsSync(files.clients)
  ? fs.readFileSync(files.clients, 'utf8')
  : '';
const loader = fs.existsSync(files.loader)
  ? fs.readFileSync(files.loader, 'utf8')
  : '';
const operations = fs.existsSync(files.operations)
  ? fs.readFileSync(files.operations, 'utf8')
  : '';

const requiredClientFragments = [
  'clientName',
  'clientCompany',
  'clientMipyme',
  'clientImporter',
  'clientPhone',
  'clientEmail',
  'data-client-menu-trigger',
  'client-actions-popover',
  "['edit', 'Editar'",
  "['welcome', welcomeLabel",
  "['history', 'Historial'",
  "['delete', 'Eliminar'",
  'mipyme_name',
  'importer_name',
  'export-mca:clients-changed'
];

for (const fragment of requiredClientFragments) {
  if (!clientsModule.includes(fragment)) {
    errors.push(`Falta en ${files.clients}: ${fragment}`);
  }
}

const forbiddenClientFragments = [
  'MutationObserver',
  'cloneNode(',
  'replaceWith(',
  'window.clients',
  "fetch('/api/clients'",
  'fetch("/api/clients"'
];

for (const fragment of forbiddenClientFragments) {
  if (clientsModule.includes(fragment)) {
    errors.push(`Patrón prohibido en ${files.clients}: ${fragment}`);
  }
}

if (!loader.includes('/admin/clients-module.js')) {
  errors.push('El loader no carga admin/clients-module.js');
}

if (loader.includes("loadScript('/admin/client-extra-fields.js'")) {
  errors.push('El loader todavía activa client-extra-fields.js');
}

if (loader.includes("loadScript('/admin/client-actions-menu.js'")) {
  errors.push('El loader todavía activa client-actions-menu.js');
}

if (!operations.includes("typeof fillClientSelects === 'function'")) {
  errors.push('erp-core.js no utiliza fillClientSelects() como fuente compartida');
}

if (!operations.includes("window.addEventListener('export-mca:clients-changed', loadOperations)")) {
  errors.push('erp-core.js no actualiza Expedientes mediante el evento explícito de Clientes');
}

const forbiddenOperationsFragments = [
  'const fillClients =',
  "clients.map(c => `<option",
  'window.loadAll = async function'
];

for (const fragment of forbiddenOperationsFragments) {
  if (operations.includes(fragment)) {
    errors.push(`Patrón de selector o wrapper legacy en ${files.operations}: ${fragment}`);
  }
}

if (errors.length) {
  console.error('Validación de Clientes fallida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validación de Clientes superada.');
console.log('- Sintaxis válida en Clientes, loader y Expedientes.');
console.log('- Seis campos integrados.');
console.log('- Menú y acciones integrados con claves estables.');
console.log('- Sin MutationObserver ni reemplazo de botones en el módulo nuevo.');
console.log('- Expedientes usa fillClientSelects() y no envuelve loadAll.');
console.log('- client-extra-fields.js permanece guardado, pero inactivo.');
console.log('- client-actions-menu.js permanece guardado, pero inactivo.');
