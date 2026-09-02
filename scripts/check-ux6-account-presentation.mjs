import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const js=read('admin/account-administration.js');
const css=read('admin/account-administration.css');
const erp=read('admin/erp.js');
const index=read('admin/index.html');
const failures=[];
const requireText=(src,text,label=text)=>{if(!src.includes(text))failures.push(`falta ${label}`);};
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

forbid(js,/document\.createElement\(['"]style['"]\)|style\.textContent|function\s+installStyles\s*\(|accountAdministrationStyles/,'account-administration.js no puede inyectar estilos');
forbid(js,/\b(?:prompt|alert|confirm)\s*\(/,'Mi cuenta no puede usar diálogos nativos');
forbid(js,/set(?:Session)?Status\([^\n;]*error\.message|catch\s*\(error\)\s*=>\s*setStatus\(error\.message/,'Mi cuenta no puede renderizar error.message crudo');
requireText(js,'SAFE_ACCOUNT_ERRORS','allowlist de errores funcionales seguros');
requireText(js,'safeAccountMessage(error, fallback)','normalizador de errores de cuenta');
for(const marker of ['ACCOUNT_LOAD_FAILED','ACCOUNT_PASSWORD_UPDATE_FAILED','ACCOUNT_SESSION_REVOCATION_FAILED','ACCOUNT_SECTION_REFRESH_FAILED']) requireText(js,marker,`diagnóstico ${marker}`);

for(const selector of ['.account-layout','.account-security-form','.account-security-status','.account-session-grid','.account-role-pill']) requireText(css,selector,`selector CSS ${selector}`);
requireText(css,'@media(max-width:760px)','responsive móvil');
requireText(css,':focus-visible','foco accesible');

const styleLoad="loadStylesheet('/admin/account-administration.css?v=20260901-ux6style1', 'data-account-administration-style')";
const scriptLoad="loadScript('/admin/account-administration.js?v=20260901-ux6style1', 'data-account-administration')";
requireText(erp,styleLoad,'carga stylesheet de cuenta');
requireText(erp,scriptLoad,'carga JavaScript de cuenta');
const styleIndex=erp.indexOf(styleLoad),scriptIndex=erp.indexOf(scriptLoad);
if(styleIndex<0||scriptIndex<0||styleIndex>scriptIndex) failures.push('erp.js debe cargar account-administration.css antes del JavaScript');

for(const text of [
  "body: JSON.stringify({ current_password: currentPassword, new_password: newPassword })",
  "localStorage.setItem('export_mca_token', result.token)",
  "if (newPassword.length < 10)",
  "if (newPassword !== confirmPassword)",
  "body: JSON.stringify({ id: userId, revoke_sessions: true, revoke_reason: reason })",
  "return access.can('administration.users.manage')"
]) requireText(js,text);

forbid(index,/id=["']changeOwnPassword["']/,'index.html no puede conservar el acceso legacy de cambio de contraseña');
forbid(index,/\b(?:prompt|alert|confirm)\s*\(/,'index.html no puede conservar diálogos nativos de cuenta');
forbid(js,/cleanSidebarFooter|changeOwnPassword/,'Mi cuenta no debe compensar controles legacy retirados del shell');

forbid(js,/\bexpediente\b/i,'Mi cuenta no puede reintroducir Expedientes');

if(failures.length){
  console.error('UX6 account presentation gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 account presentation gate passed.');
