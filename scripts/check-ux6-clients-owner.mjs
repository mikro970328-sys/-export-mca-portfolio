import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const js=read('admin/clients-module.js');
const css=read('admin/clients-module.css');
const api=read('api/clients.js');
const erp=read('admin/erp.js');
const failures=[];
const requireText=(src,text,label=text)=>{if(!src.includes(text))failures.push(`falta ${label}`);};
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

forbid(js,/document\.createElement\(['"]style['"]\)|style\.textContent|function\s+installStyles\s*\(/,'clients-module.js no puede inyectar estilos');
forbid(js,/\b(?:prompt|alert|confirm)\s*\(/,'Clientes no puede usar diálogos nativos');
forbid(js,/set(?:Client|Edit)Message\([^\n;]*error\.message|\bnote\([^\n;]*error\.message/,'Clientes no puede mostrar error.message crudo');
forbid(js,/\b(?:welcome|clientHistory|delClient)\s*\(/,'ClientsModule no puede depender de handlers legacy');
forbid(js,/\bexpediente\b/i,'Clientes no puede reintroducir Expedientes');

for(const text of [
  'SAFE_CLIENT_ERRORS',
  'safeClientMessage(error,fallback)',
  'function clientDecision(',
  'async function sendWelcome(',
  'async function openHistory(',
  'async function deleteClient(',
  "owner:'clients-module.js'"
]) requireText(js,text);
for(const marker of ['CLIENT_CREATE_FAILED','CLIENT_UPDATE_FAILED','CLIENT_WELCOME_FAILED','CLIENT_HISTORY_FAILED','CLIENT_DELETE_FAILED']) requireText(js,marker,`diagnóstico ${marker}`);

for(const selector of ['.client-actions-popover','.client-information-grid','.client-decision-overlay','.client-list-footer']) requireText(css,selector,`selector CSS ${selector}`);
requireText(css,'@media(max-width:700px)','responsive móvil');
requireText(css,':focus-visible','foco accesible');

const styleLoad="loadStylesheet('/admin/clients-module.css?v=20260901-ux6owner1', 'data-clients-module-style')";
const scriptLoad="loadScript('/admin/clients-module.js?v=20260901-ux6owner1', 'data-clients-module')";
requireText(erp,styleLoad,'carga stylesheet de Clientes');
requireText(erp,scriptLoad,'carga JavaScript de Clientes');
const styleIndex=erp.indexOf(styleLoad),scriptIndex=erp.indexOf(scriptLoad);
if(styleIndex<0||scriptIndex<0||styleIndex>scriptIndex) failures.push('erp.js debe cargar clients-module.css antes del JavaScript');

requireText(api,"return { status: 'failed' }",'respuesta segura de fallo de bienvenida');
requireText(api,"console.error('CLIENTS_API_FAILED', error)",'diagnóstico seguro de API');
requireText(api,"return fail(res, 500, 'No se pudo completar la operación del cliente')",'boundary 500 estable');
forbid(api,/return\s+fail\([^\n]*error\.message/,'API de Clientes no puede devolver error.message crudo');

if(failures.length){
  console.error('UX6 Clients owner gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Clients owner gate passed.');
