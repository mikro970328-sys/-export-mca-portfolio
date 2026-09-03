import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const js=read('admin/operational-alert-center.js');
const css=read('admin/operational-alert-center.css');
const erp=read('admin/erp.js');
const index=read('admin/index.html');
const failures=[];
const requireText=(src,text,label=text)=>{if(!src.includes(text))failures.push(`falta ${label}`);};
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

forbid(js,/document\.createElement\(['"]style['"]\)|style\.textContent|function\s+addStyles\s*\(/,'operational-alert-center.js no puede inyectar estilos');
forbid(js,/operationalAlertStyles/,'el JavaScript no puede conservar el antiguo style owner');
forbid(js,/\sstyle\s*=/i,'operational-alert-center.js no puede conservar estilos inline');
forbid(js,/\.style(?:\.|\[)/,'operational-alert-center.js no puede mutar presentación desde JavaScript');

for(const selector of [
  '.alert-bell-wrap',
  '.alert-popover',
  '.alert-item-meta',
  '.alert-summary-grid',
  '.operational-alert-card',
  '.alert-action-overlay',
  '.alert-action-panel',
  '.alert-center-feedback.bad'
]) requireText(css,selector,`selector CSS ${selector}`);
requireText(css,'@media(max-width:900px)','responsive tablet/móvil');
requireText(css,'@media(max-width:520px)','responsive móvil compacto');
requireText(css,':focus-visible','estado de foco accesible');

const styleLoad="loadStylesheet('/admin/operational-alert-center.css?v=20260903-ux7icons1', 'data-operational-alert-center-style')";
const scriptLoad="loadScript('/admin/operational-alert-center.js?v=20260903-ux7icons1', 'data-operational-alert-center')";
requireText(erp,styleLoad,'carga del stylesheet dedicado');
requireText(erp,scriptLoad,'carga del owner JavaScript');
const styleIndex=erp.indexOf(styleLoad);
const scriptIndex=erp.indexOf(scriptLoad);
if(styleIndex<0||scriptIndex<0||styleIndex>scriptIndex) failures.push('erp.js debe cargar el stylesheet antes del JavaScript del centro de alertas');
requireText(erp,'.then(() => loadScript','encadenamiento stylesheet → JavaScript');
requireText(erp,"accessCan('notifications.read')",'boundary notifications.read');
requireText(index,'/admin/erp.js?v=20260903-ux7icons1','revisión del loader ERP');

forbid(css,/\bexpediente\b/i,'CSS no puede reintroducir Expedientes');
forbid(js,/\b(?:prompt|alert|confirm)\s*\(/,'centro de alertas no puede reintroducir diálogos nativos');
requireText(js,'retryMessageDialog(row)','modal controlado de reintento');
requireText(js,"['pending','snoozed'].includes(alertStatus(row))",'lifecycle P9');
requireText(js,'Alertas = excepciones. Tareas = trabajo. Mensajes = entrega al cliente.','separación TASK/ALERT/NOTIFICATION');

if(failures.length){
  console.error('UX6 alert center style owner gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 alert center style owner gate passed.');
