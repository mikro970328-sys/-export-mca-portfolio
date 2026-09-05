import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const js=read('admin/clients-module.js');
const css=read('admin/clients-module.css');
const api=read('api/clients.js');
const erp=read('admin/erp.js');
const index=read('admin/index.html');
const failures=[];
const requireText=(src,text,label=text)=>{if(!src.includes(text))failures.push(`falta ${label}`);};
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

forbid(js,/document\.createElement\(['"]style['"]\)|style\.textContent|function\s+installStyles\s*\(/,'clients-module.js no puede inyectar estilos');
forbid(js,/\b(?:prompt|alert|confirm)\s*\(/,'Clientes no puede usar diálogos nativos');
forbid(js,/set(?:Client|Edit)Message\([^\n;]*error\.message|\bnote\([^\n;]*error\.message/,'Clientes no puede mostrar error.message crudo');
forbid(js,/\b(?:welcome|clientHistory|delClient)\s*\(/,'ClientsModule no puede depender de handlers legacy');
forbid(js,/\bexpediente\b/i,'Clientes no puede reintroducir Expedientes');
forbid(js,/function\s+sectionHtml\s*\(|clientsSection['"]\)\.innerHTML|section\.innerHTML\s*=/,'ClientsModule no puede duplicar el markup canónico de index.html');
forbid(js,/\sstyle\s*=/i,'ClientsModule conserva estilos inline en HTML generado');
forbid(css,/!important/i,'clients-module.css no puede depender de !important');
forbid(css,/@import/i,'clients-module.css no puede depender de imports tardíos');
forbid(css,/\b(?:fetch|MutationObserver)\b|\b(?:prompt|alert|confirm)\s*\(/,'clients-module.css mezcla comportamiento');
const cssOpening=(css.match(/{/g)||[]).length;
const cssClosing=(css.match(/}/g)||[]).length;
if(cssOpening!==cssClosing) failures.push(`clients-module.css desbalanceado: ${cssOpening} aperturas y ${cssClosing} cierres`);

for(const text of [
  'SAFE_CLIENT_ERRORS',
  'safeClientMessage(error,fallback)',
  'function clientDecision(',
  "can?.('clients.write') === true",
  'function renderSummary(rows)',
  "role=\"alertdialog\"",
  "role=\"menuitem\"",
  "console.error('CLIENTS_MARKUP_MISSING')",
  'async function sendWelcome(',
  'async function openHistory(',
  'async function deleteClient(',
  "owner:'clients-module.js'"
]) requireText(js,text);
for(const marker of ['CLIENT_CREATE_FAILED','CLIENT_UPDATE_FAILED','CLIENT_WELCOME_FAILED','CLIENT_HISTORY_FAILED','CLIENT_DELETE_FAILED']) requireText(js,marker,`diagnóstico ${marker}`);

for(const selector of ['#clientsSection .clients-hero.native-workspace-hero','#clientsSection .clients-summary','.clients-table','.client-actions-popover','.client-information-grid','.client-decision-overlay','.client-list-footer']) requireText(css,selector,`selector CSS ${selector}`);
requireText(css,'@media(max-width:700px)','responsive móvil');
requireText(css,':focus-visible','foco accesible');

for(const text of [
  'class="clients-workspace native-workspace-shell"',
  'id="clientTotal"',
  'id="clientWelcomed"',
  'id="clientCompanies"',
  'id="clientsReadOnlyNote"',
  'id="clientCreateForm"',
  'id="clientSearch"'
]) requireText(index,text,`markup canónico ${text}`);
requireText(index,'/admin/erp.js?v=20260905-accessflow1','revisión del loader ERP para Clientes');
const clientsStart=index.indexOf('<section id="clientsSection"');
const clientsEnd=index.indexOf('<section id="registerContainerSection"',clientsStart);
const clientsMarkup=clientsStart>=0&&clientsEnd>clientsStart?index.slice(clientsStart,clientsEnd):'';
forbid(clientsMarkup,/\sstyle\s*=/i,'Clientes conserva estilos inline en index.html');

const styleLoad="loadStylesheet('/admin/clients-module.css?v=20260902-ux7clients1', 'data-clients-module-style')";
const scriptLoad="loadScript('/admin/clients-module.js?v=20260902-ux7clients1', 'data-clients-module')";
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
