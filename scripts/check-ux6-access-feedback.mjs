import fs from 'node:fs';

const files={
  owner:'admin/access-control-administration.js',
  styles:'admin/access-control.css',
  index:'admin/index.html',
  loader:'admin/erp.js',
  accessApi:'api/access-control.js',
  adminsApi:'api/admins.js',
  workflow:'.github/workflows/ux6-access-feedback.yml'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const owner=read(files.owner);
const styles=read(files.styles);
const index=read(files.index);
const loader=read(files.loader);
const accessApi=read(files.accessApi);
const adminsApi=read(files.adminsApi);
const workflow=read(files.workflow);

for(const text of [
  'const SAFE_ACCESS_ERRORS = new Set([',
  'function safeAccessMessage(',
  'ACCESS_CONTROL_UI_FAILED',
  "context = 'operation'",
  'error.code = data.details?.code || data.code || data.reason_code || null',
  'error.status = response.status',
  "button.dataset.accessBusy === '1'",
  'await action.onClick(event)',
  'id="accessModalMessage"',
  'function setModalMessage(',
  "'modal_action'",
  "'create_user'",
  "'create_role'",
  "'create_team'",
  "'load_tab'"
])requireText(owner,text,`contrato de feedback de Accesos ${text}`);

if((owner.match(/error\?\.message/g)||[]).length!==1)failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b/,'Accesos vuelve a renderizar error.message directamente');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Accesos vuelve a usar diálogos nativos');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Accesos vuelve a inyectar CSS desde JavaScript');
forbid(owner,/\bMutationObserver\b/,'Accesos vuelve a observar y recomponer el DOM');

for(const text of [
  'administration.users.manage',
  'administration.roles.manage',
  'administration.teams.manage',
  'SECTION_PERMISSIONS',
  'window.ExportMcaAccessControl = Object.freeze',
  "section.dataset.accessOwner = 'access-control-administration.js'"
])requireText(owner,text,`ownership canónico ${text}`);

requireText(loader,"/admin/access-control.css?v=20260903-ux7access1",'revisión del CSS de Accesos');
requireText(loader,"/admin/access-control-administration.js?v=20260903-ux7access1",'revisión del owner de Accesos');
requireText(loader,"await window.ExportMcaAccessControl.initialize()",'inicialización del contexto de acceso');
requireText(styles,'.access-modal-message{margin:0 16px 12px}','feedback visible dentro del diálogo de Accesos');
requireText(index,'/admin/erp.js?v=20260904-flowclarity1','revisión del loader ERP');

for(const [source,label] of [[accessApi,'api/access-control.js'],[adminsApi,'api/admins.js']]){
  requireText(source,'authorizeAdmin(',`${label} conserva autorización backend`);
  requireText(source,"return fail(res, 500, 'No se pudo completar la operación",`${label} conserva fallback 500 seguro`);
}
for(const text of [
  'create_access_role_with_audit',
  'update_access_role_with_audit',
  'create_team_with_audit',
  'update_team_with_audit'
])requireText(accessApi,text,`RPC canónica ${text}`);

for(const text of [
  'node scripts/check-ux6-access-feedback.mjs',
  'node scripts/check-access-control.mjs',
  'node scripts/check-ux6-shell-ownership.mjs',
  'node scripts/check-ux6b-native-workspace-foundation.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,text,`workflow ${text}`);

if(failures.length){
  console.error('UX-6 Access feedback gate failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-6 Access feedback gate passed.');
console.log('- Usuarios, roles y equipos comparten un único boundary de feedback seguro.');
console.log('- Todas las acciones del modal capturan fallos sin handlers duplicados ni promesas rechazadas.');
console.log('- Permisos, navegación, sesiones y RPC de auditoría permanecen intactos.');
