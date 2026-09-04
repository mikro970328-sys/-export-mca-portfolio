import fs from 'node:fs';

const files={
  owner:'admin/tasks-workspace.js',
  styles:'admin/tasks-workspace.css',
  loader:'admin/erp.js',
  index:'admin/index.html',
  api:'api/tasks.js'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const owner=read(files.owner);
const css=read(files.styles);
const loader=read(files.loader);
const index=read(files.index);
const api=read(files.api);

for(const text of [
  'function safeTaskMessage(',
  'taskErrorMessages',
  'safeTaskErrors',
  'TASK_WORKSPACE_OPERATION_FAILED',
  "TASK_DEPENDENCY_CYCLE:'Esa dependencia crearía un ciclo entre tareas.'",
  "TASK_OPEN_DEPENDENCIES:'Completa primero las dependencias pendientes de esta tarea.'",
  "error?.status===401",
  "error?.status===403",
  "error?.status===404",
  "task.capabilities?.write&&can('tasks.write')",
  "task.capabilities?.manage&&can('tasks.manage')",
  'tasks-history-section',
  'tasks-dependency-intro'
])requireText(owner,text,`contrato de feedback de Tareas ${text}`);

if((owner.match(/error\?\.message/g)||[]).length!==1)failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b/,'Tareas vuelve a renderizar error.message directamente');
forbid(owner,/\sstyle\s*=/i,'Tareas conserva estilos inline');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Tareas vuelve a inyectar CSS desde JavaScript');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Tareas vuelve a usar diálogos nativos');

for(const text of [
  '.tasks-history-section{margin-top:0}',
  '.tasks-dependency-intro{margin-bottom:8px}',
  '@media(max-width:720px)',
  '@media(max-width:480px)'
])requireText(css,text,`presentación de Tareas ${text}`);

requireText(loader,"/admin/tasks-workspace.css?v=20260903-ux7tasks1",'revisión del CSS de Tareas');
requireText(loader,"/admin/tasks-workspace.js?v=20260904-notification-entry1",'revisión del JS de Tareas');
requireText(index,'/admin/erp.js?v=20260904-simple-nav1','revisión del loader ERP');

for(const text of [
  "authorizeAdmin(req,res,'tasks.read')",
  "authorizeAdmin(req,res,'tasks.write')",
  "authorizeAdmin(req,res,'tasks.manage')",
  "TASK_OPEN_DEPENDENCIES",
  "return fail(res,500,'No se pudo completar la operación de tareas')"
])requireText(api,text,`boundary canónico de Tareas ${text}`);

if(failures.length){
  console.error('UX-6 Tasks feedback gate failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-6 Tasks feedback gate passed.');
console.log('- Mensajes técnicos se conservan solo en diagnóstico y la UI usa lenguaje operativo.');
console.log('- Estados, permisos, capabilities, routing y autoridad backend permanecen intactos.');
console.log('- Historial y dependencias ya no dependen de estilos inline.');
