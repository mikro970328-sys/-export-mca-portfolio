import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const js=read('admin/containers-module.js');
const css=read('admin/containers-module.css');
const erp=read('admin/erp.js');
const failures=[];
const requireText=(src,text,label=text)=>{if(!src.includes(text))failures.push(`falta ${label}`);};
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

forbid(js,/document\.createElement\(['"]style['"]\)|style\.textContent|function\s+installStyles\s*\(|containersModuleStyles/,'containers-module.js no puede inyectar estilos');
forbid(js,/\b(?:prompt|alert|confirm)\s*\(/,'Contenedores no puede usar diálogos nativos');
forbid(js,/note\s*\(\s*error(?:\?\.)?\.message|showToast\s*\(\s*error(?:\?\.)?\.message|setCustomsFeedback\s*\(\s*error(?:\?\.)?\.message|notice\.textContent\s*=\s*error(?:\?\.)?\.message/,'Contenedores no puede mostrar error.message crudo');
forbid(js,/result\.notification_error\s*\|\||JSON\.stringify\s*\(\s*item\.details/,'el historial no puede mostrar errores o JSON técnico crudo');
forbid(js,/\bexpediente\b/i,'Contenedores no puede reintroducir Expedientes');

for(const text of [
  'SAFE_CONTAINER_ERROR_PATTERNS',
  'safeContainerMessage(error,fallback',
  'CONTAINER_CREATE_FAILED',
  'CONTAINER_ACTION_FAILED',
  'CONTAINER_DOCUMENT_UPLOAD_FAILED',
  'CONTAINER_DOCUMENT_DELETE_FAILED',
  'CONTAINER_MANUAL_TRACKING_FAILED',
  'CONTAINER_TRACKING_NOTIFICATION_FAILED',
  'function emptyListMessage()',
  'function notificationHistoryDetail(item)',
  'function notificationHistoryTitle(item)',
  'function auditHistoryDetail(item)',
  'function auditHistoryTitle(item)'
]) requireText(js,text);

for(const text of [
  '.container-actions-popover',
  '.container-customs-grid',
  '.container-overlay',
  '.manual-track-list',
  '@media(max-width:900px)',
  ':focus-visible'
]) requireText(css,text,`selector CSS ${text}`);

const styleLoad="loadStylesheet('/admin/containers-module.css?v=20260902-ux7tracking1', 'data-containers-module-style')";
const scriptLoad="loadScript('/admin/containers-module.js?v=20260902-ux7tracking1', 'data-containers-module')";
requireText(erp,styleLoad,'carga stylesheet de Contenedores');
requireText(erp,scriptLoad,'carga JavaScript de Contenedores');
const styleIndex=erp.indexOf(styleLoad),scriptIndex=erp.indexOf(scriptLoad);
if(styleIndex<0||scriptIndex<0||styleIndex>scriptIndex)failures.push('erp.js debe cargar containers-module.css antes del JavaScript');

for(const contract of [
  'function capability(shipment,key)',
  'function actionAllowed(shipment,key)',
  'const CUSTOMS_TYPES=',
  "request('/api/shipment-document-readiness')",
  "request('/api/manual-tracking-event'",
  "owner:'containers-module.js'",
  "trackingOwner:'containers-module.js'",
  "registrationOwner:'containers-module.js'"
]) requireText(js,contract);

if(failures.length){
  console.error('UX6 Containers presentation gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Containers presentation gate passed.');
