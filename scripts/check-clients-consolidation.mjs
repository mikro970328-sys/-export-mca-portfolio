import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files = {
  clients: 'admin/clients-module.js',
  loader: 'admin/erp.js',
  extraFieldsLegacy: 'admin/client-extra-fields.js',
  actionsMenuLegacy: 'admin/client-actions-menu.js'
};

const errors = [];

for (const file of [files.clients, files.loader]) {
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
  'importer_name'
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

if (errors.length) {
  console.error('Validación de Clientes fallida:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log('Validación de Clientes superada.');
console.log('- Sintaxis válida.');
console.log('- Seis campos integrados.');
console.log('- Menú y acciones integrados con claves estables.');
console.log('- Sin MutationObserver ni reemplazo de botones en el módulo nuevo.');
console.log('- client-extra-fields.js permanece guardado, pero inactivo.');
console.log('- client-actions-menu.js permanece guardado, pero inactivo.');
