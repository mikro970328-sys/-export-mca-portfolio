import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const exists = file => fs.existsSync(path.join(root, file));
const failures = [];
const requireText = (source, text, label) => { if (!source.includes(text)) failures.push(`falta ${label || text}`); };
const forbid = (source, pattern, label) => { if (pattern.test(source)) failures.push(label); };

for (const file of ['admin/workers-module.css','admin/workers-module.js','admin/index.html','admin/erp.js','api/admins.js','.github/workflows/ux6-workers-presentation.yml']) {
  if (!exists(file)) failures.push(`falta ${file}`);
}

if (!failures.length) {
  const css = read('admin/workers-module.css');
  const module = read('admin/workers-module.js');
  const index = read('admin/index.html');
  const loader = read('admin/erp.js');
  const api = read('api/admins.js');
  const workflow = read('.github/workflows/ux6-workers-presentation.yml');
  const workersStart = index.indexOf('<section id="workersSection"');
  const workersEnd = index.indexOf('<section id="adminsSection"', workersStart);
  const workersMarkup = workersStart >= 0 && workersEnd > workersStart ? index.slice(workersStart, workersEnd) : '';

  for (const [text,label] of [
    ['workers-hero','hero operativo'],
    ['workers-summary','resumen de activos e inactivos'],
    ['workerCreateForm','formulario accesible'],
    ['workersReadOnlyNote','estado de solo lectura'],
    ['aria-live="polite"','feedback accesible']
  ]) requireText(workersMarkup, text, `admin/index.html: ${label}`);
  forbid(workersMarkup, /\sstyle\s*=/i, 'admin/index.html: el owner de Trabajadores conserva estilos inline');
  forbid(index, /<script[^>]+src=["']\/admin\/workers-module\.js/i, 'admin/index.html: carga estática legacy de workers-module.js');

  const cssIndex = loader.indexOf("/admin/workers-module.css?v=20260902-ux6owner1");
  const jsIndex = loader.indexOf("/admin/workers-module.js?v=20260902-ux6owner1");
  if (cssIndex < 0 || jsIndex < 0 || cssIndex > jsIndex) failures.push('admin/erp.js: debe cargar CSS antes del JS de Trabajadores');
  requireText(loader, "accessCan('administration.workers.read')", 'admin/erp.js: carga por permiso efectivo de lectura');

  for (const [text,label] of [
    ["can('administration.workers.read')", 'permiso efectivo de lectura'],
    ["can('administration.workers.write')", 'permiso efectivo de escritura'],
    ['result.write_access === true', 'overlay de escritura devuelto por backend'],
    ['actionAllowed(worker, \'edit\')', 'capability Editar'],
    ['actionAllowed(worker, \'deactivate\')', 'capability Desactivar'],
    ['actionAllowed(worker, \'reactivate\')', 'capability Reactivar'],
    ['safeWorkerMessage', 'traductor de errores seguros'],
    ['console.error(`[workers ${area}]`', 'diagnóstico técnico en consola'],
    ['No hay trabajadores activos', 'empty state activo útil'],
    ['No hay trabajadores desactivados', 'empty state inactivo útil']
  ]) requireText(module, text, `admin/workers-module.js: ${label}`);
  forbid(module, /\b(?:alert|confirm|prompt)\s*\(/, 'admin/workers-module.js: usa diálogos nativos');
  forbid(module, /currentUser\?*\.role|role\s*===\s*['"]master_admin['"]/, 'admin/workers-module.js: infiere acceso por rol legacy');
  forbid(module, /\.style\.[a-zA-Z]+\s*=/, 'admin/workers-module.js: inyecta presentación inline');
  forbid(module, /(?:textContent|innerHTML)\s*=\s*error\??\.message/, 'admin/workers-module.js: expone error técnico directamente');
  forbid(module, /setMessage\([^\n;]*error\??\.message/, 'admin/workers-module.js: envía error crudo al feedback');

  for (const [text,label] of [
    ['loadAdminAccessContext', 'permisos efectivos DB-backed'],
    ['workerWriteAccess', 'overlay backend de escritura'],
    ['workerCapabilities', 'capabilities de acciones'],
    ["'WORKER_WRITE_PERMISSION_REQUIRED'", 'reason de permiso'],
    ["'WORKER_ALREADY_INACTIVE'", 'reason de estado inactivo'],
    ["'WORKER_ALREADY_ACTIVE'", 'reason de estado activo'],
    ['write_access:writeAccess', 'contrato write_access'],
    ['capabilities:workerCapabilities(worker, writeAccess)', 'capabilities por trabajador'],
    ["console.error('[api/admins]'", 'diagnóstico backend'],
    ["return fail(res, 500, 'No se pudo completar la operación');", 'boundary 500 estable']
  ]) requireText(api, text, `api/admins.js: ${label}`);
  forbid(api, /return fail\(res,\s*500,\s*['"]No se pudo completar la operación['"],\s*error\.message\)/, 'api/admins.js: filtra detalles inesperados al cliente');

  for (const selector of ['.workers-hero','.workers-layout','.workers-empty','.workers-message','.workers-modal-form','@media(max-width:760px)']) {
    requireText(css, selector, `admin/workers-module.css: ${selector}`);
  }
  requireText(workflow, 'npm install --ignore-scripts --no-audit --no-fund', '.github/workflows/ux6-workers-presentation.yml: instalación reproducible de dependencias');
  requireText(workflow, 'node scripts/check-ux6-workers-presentation.mjs', '.github/workflows/ux6-workers-presentation.yml: gate de owner');
}

if (exists('.github/workflows/integrate-workers.yml')) {
  failures.push('.github/workflows/integrate-workers.yml: workflow instalador legacy sigue activo');
}

if (failures.length) {
  console.error(`UX6 Workers presentation check failed:\n${failures.map(failure => `- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX6 Workers presentation check passed.');
