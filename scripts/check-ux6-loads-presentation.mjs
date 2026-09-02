import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const api=read('api/loads.js');
const ui=read('admin/loads.js');
const css=read('admin/loads.css');
const html=read('admin/loads.html');
const canonicalGate=read('scripts/check-ux5-load-actions.mjs');
const workflow=read('.github/workflows/ux6-loads-presentation.yml');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

for(const text of [
  '/admin/loads.css?v=20260902-ux6owner1',
  '/admin/loads.js?v=20260902-ux6owner1',
  'id="pageMsg"',
  'role="status"',
  'aria-live="polite"',
  'role="dialog"',
  'aria-modal="true"',
  'aria-labelledby="decisionTitle"'
])requireText(html,text,`HTML ${text}`);
forbid(html,/<style\b/i,'loads.html conserva la hoja de estilos embebida');
forbid(html,/\sstyle=/i,'loads.html conserva estilos inline');

for(const text of [
  '.load-form-notes',
  '.load-form-actions',
  '.load-section-actions',
  '.load-detail-actions',
  '.load-feedback.bad',
  '.load-action-feedback.bad',
  ':focus-visible',
  '@media(max-width:700px)'
])requireText(css,text,`CSS ${text}`);

for(const text of [
  'SAFE_LOAD_ERROR_PATTERNS',
  "function safeLoadMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.')",
  'function reportLoadError(context,error,fallback)',
  'function setFeedback(id,message=',
  "console.error('LOADS_UI_FAILED'",
  "reportLoadError(`action:${action}`,error)",
  "reportLoadError('save_plan',error)",
  "reportLoadError('create_container',error)",
  "reportLoadError('assign_container',error)",
  "showPageError('bootstrap',error)",
  "const statusLabel=value=>labels[value]||'Estado no disponible'",
  "can(l,'reserve')",
  "can(l,'release')",
  "can(l,'start_loading')",
  "can(l,'mark_loaded')",
  "can(l,'dispatch')",
  "can(l,'edit')",
  "can(l,'cancel')",
  "can(l,'assign_container')",
  "can(l,'unassign_container')",
  "can(l,'view_tracking')"
])requireText(ui,text,`owner de Cargues ${text}`);
forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Cargues no puede usar diálogos nativos');
forbid(ui,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?(?:error|e)(?:\?\.)?\.message/,'Cargues no puede mostrar error.message crudo');
forbid(ui,/\sstyle=/i,'Cargues no puede generar estilos inline');
forbid(ui,/labels\[[^\]]+\.status\]\|\|[^;\n]*\.status/,'Cargues no puede exponer códigos de estado desconocidos');
forbid(ui,/if\s*\(l\.status===['"](?:draft|reserved|loading|loaded)['"]\)/,'Cargues no puede inferir acciones desde status');
forbid(ui,/\bexpediente(?:s)?\b/i,'Cargues no puede reintroducir Expedientes');

for(const text of [
  'function translatedError(raw)',
  "['JSON_INVALID','La solicitud no tiene un formato válido.']",
  "['LOAD_QUANTITY_INVALID','La cantidad o los pallets seleccionados no son válidos.']",
  "if(translated)return fail(res,400,translated)",
  "return fail(res,500,'No se pudo procesar Cargues')",
  "supabase('rpc/execute_load_action'",
  "supabase('rpc/replace_load_plan_canonical'",
  "supabase('rpc/create_load_shipment_canonical'",
  "supabase('rpc/assign_load_shipment_canonical'"
])requireText(api,text,`backend seguro ${text}`);
forbid(api,/return matched\?\.[^;]+:\s*raw|\|\|\s*raw\s*;/,'Loads API no puede devolver errores internos crudos');
forbid(api,/return fail\(res,400,translatedError\(raw\)\)/,'Loads API no puede clasificar todo error inesperado como 400');

for(const text of [
  'DB canonical owner',
  'Loads UI',
  'src="/admin/loads.js?v=20260902-ux6owner1"',
  "can(l,'dispatch')",
  "can(l,'view_tracking')"
])requireText(canonicalGate,text,`gate UX-5 preservado ${text}`);

for(const text of [
  'node scripts/check-ux6-loads-presentation.mjs',
  'node scripts/check-ux5-load-actions.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,text,`workflow ${text}`);

if(failures.length){
  console.error('UX6 Loads presentation gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Loads presentation gate passed.');
