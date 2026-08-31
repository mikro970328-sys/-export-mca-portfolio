import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const failures=[];
const requireText=(file,text,label=text)=>{ if(!read(file).includes(text)) failures.push(`${file}: falta ${label}`); };
const forbid=(file,re,label)=>{ if(re.test(read(file))) failures.push(`${file}: ${label}`); };

const foundation='supabase/migrations/20260831005000_p17_session_audit_foundation.sql';
const adminAtomic='supabase/migrations/20260831005100_p17_admin_worker_atomic_audit.sql';
const accessAtomic='supabase/migrations/20260831005200_p17_access_control_atomic_audit.sql';
for(const file of [foundation,adminAtomic,accessAtomic]) if(!fs.existsSync(path.join(root,file))) failures.push(`${file}: falta migración P17`);

for(const text of [
  'add column if not exists session_version integer not null default 1',
  'audit_log_append_only_guard',
  'revoke all privileges on table public.audit_log from service_role',
  'grant select, insert on table public.audit_log to service_role',
  'register_admin_login_failure',
  'register_admin_login_success',
  'change_own_admin_password',
  'revoke_admin_sessions',
  "'administration.users.manage'"
]) requireText(foundation,text);

for(const text of [
  'create_admin_account_with_audit',
  'update_admin_account_with_audit',
  'create_worker_with_audit',
  'update_worker_with_audit'
]) requireText(adminAtomic,text);

for(const text of [
  'create_access_role_with_audit',
  'update_access_role_with_audit',
  'create_team_with_audit',
  'update_team_with_audit'
]) requireText(accessAtomic,text);

const lib=read('api/_lib.js');
for(const text of [
  'session_version: sessionVersion',
  'iat: issuedAt',
  'select=id,full_name,username,role,is_active,access_role_id,session_version',
  'Number(payload.session_version) !== Number(account.session_version)',
  'La sesión expiró o fue revocada'
]) if(!lib.includes(text)) failures.push(`api/_lib.js: falta contrato de sesión: ${text}`);
if(/export async function writeAudit[\s\S]*?catch\s*\(/.test(lib)) failures.push('api/_lib.js: writeAudit no puede ocultar errores');

const login=read('api/login.js');
for(const rpc of ['register_admin_login_failure','register_admin_login_success']) if(!login.includes(`rpc/${rpc}`)) failures.push(`api/login.js: falta ${rpc}`);
forbid('api/login.js',/writeAudit\s*\(/,'login no debe duplicar auditoría fuera del RPC');
forbid('api/login.js',/method:\s*['"]PATCH['"][\s\S]{0,180}admin_users/,'login no debe actualizar admin_users directamente');

const account=read('api/account.js');
requireText('api/account.js','rpc/change_own_admin_password');
requireText('api/account.js','token: createToken');
forbid('api/account.js',/method:\s*['"]PATCH['"][\s\S]{0,220}admin_users/,'password change no debe mutar admin_users directamente');

const admins=read('api/admins.js');
for(const rpc of ['create_admin_account_with_audit','update_admin_account_with_audit','create_worker_with_audit','update_worker_with_audit','revoke_admin_sessions']) {
  if(!admins.includes(`'${rpc}'`)) failures.push(`api/admins.js: falta RPC ${rpc}`);
}
forbid('api/admins.js',/writeAudit\s*\(/,'administración no debe duplicar audit fuera de RPC');
forbid('api/admins.js',/supabase\(['"](?:admin_users|workers|worker_status_history|team_memberships)['"]\s*,\s*\{\s*method:\s*['"](?:POST|PATCH|DELETE)/,'administración sensible no debe escribir tablas directamente');

const access=read('api/access-control.js');
for(const rpc of ['create_access_role_with_audit','update_access_role_with_audit','create_team_with_audit','update_team_with_audit']) {
  if(!access.includes(`'${rpc}'`)) failures.push(`api/access-control.js: falta RPC ${rpc}`);
}
forbid('api/access-control.js',/writeAudit\s*\(/,'roles/equipos no deben duplicar audit fuera de RPC');
forbid('api/access-control.js',/supabase\(['"](?:access_roles|access_role_permissions|teams|team_memberships)['"]\s*,\s*\{\s*method:\s*['"](?:POST|PATCH|DELETE)/,'roles/equipos no deben escribir tablas directamente');

requireText('admin/account-administration.js',"localStorage.setItem('export_mca_token', result.token)",'reemplazo de token tras cambio de contraseña');
for(const file of ['admin/account-administration.js']) {
  forbid(file,/\bMutationObserver\b/,'no usar MutationObserver');
  forbid(file,/\b(?:alert|prompt|confirm)\s*\(/,'no usar diálogos nativos');
}

const p15Migration='supabase/migrations/20260831002000_p15_database_privilege_hardening.sql';
if(!fs.existsSync(path.join(root,p15Migration))) failures.push('P17 debe conservar hardening P15');

if(failures.length){
  console.error('P17 session/audit gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('P17 session/audit ownership gate passed.');
