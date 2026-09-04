import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  owner:'admin/tasks-workspace.js',
  styles:'admin/tasks-workspace.css',
  loader:'admin/erp.js',
  api:'api/tasks.js',
  browserstack:'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux7-tasks-visual-owner.yml'
};

const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,value,label=value)=>{if(!source.includes(value))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files)) {
  if(!fs.existsSync(file))failures.push(`falta ${file}`);
}

const owner=read(files.owner);
const styles=read(files.styles);
const loader=read(files.loader);
const api=read(files.api);
const browserstack=read(files.browserstack);
const browserstackGate=read(files.browserstackGate);
const workflow=read(files.workflow);

[
  "section.dataset.tasksOwner = 'tasks-workspace.js'",
  'class="tasks-shell native-workspace-shell"',
  'class="tasks-head native-workspace-hero"',
  'class="tasks-hero-state"',
  'id="tasksOperationalState"',
  'id="tasksLastUpdated"',
  'class="tasks-summary native-workspace-summary"',
  "'taskMetricPending'",
  "'taskMetricInProgress'",
  "'taskMetricBlocked'",
  "'taskMetricOverdue'",
  "'taskMetricCompleted'",
  'class="tasks-command"',
  'id="tasksSearch" class="tasks-search" type="search"',
  'id="tasksStatusFilter"',
  'id="tasksPriorityFilter"',
  'id="tasksTeamFilter"',
  'id="tasksResultCount"',
  'id="tasksTableWrap" class="tasks-table-wrap" role="list"',
  'class="tasks-card ',
  'function visibleTasks(',
  'function taskCounts(',
  'function renderResultRegion(',
  'function handleDocumentKeydown(',
  "event.key==='Escape'",
  "event.key!=='Tab'",
  'owner:OWNER',
  'window.TasksWorkspace=Object.freeze',
  'getState,',
  'state'
].forEach(value=>requireText(owner,value,`owner visual ${value}`));

[
  "can('tasks.read')",
  "can('tasks.write')",
  "can('tasks.manage')",
  "task.capabilities?.write&&can('tasks.write')",
  "task.capabilities?.manage&&can('tasks.manage')",
  'data-task-transition=',
  'id="tasksCommentForm"',
  "action:'set_dependencies'",
  "action:'comment'",
  "action:'create'",
  "method:'PATCH'",
  'TASK_WORKSPACE_OPERATION_FAILED',
  'TASK_DEPENDENCY_CYCLE',
  'TASK_OPEN_DEPENDENCIES',
  'No se pudo cambiar el estado. Intenta nuevamente.',
  'No se pudieron cargar las tareas. Intenta nuevamente.'
].forEach(value=>requireText(owner,value,`límite operativo ${value}`));

if((owner.match(/error\?\.message/g)||[]).length!==1)failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b|\be\.message\b/,'Mis tareas renderiza errores técnicos directamente');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Mis tareas usa diálogos nativos');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Mis tareas inyecta CSS desde JavaScript');
forbid(owner,/\.style(?:\.|\[)/,'Mis tareas muta estilos inline');
forbid(owner,/\bMutationObserver\b|\bResizeObserver\b/,'Mis tareas observa y recompone el DOM');
forbid(owner,/\sstyle\s*=/i,'Mis tareas conserva atributos style');
forbid(owner,/<table\b/,'Mis tareas conserva una tabla ancha no responsiva');

[
  '#tasksSection',
  '.tasks-shell',
  '.tasks-head.native-workspace-hero',
  '.tasks-hero-state',
  '.tasks-summary.native-workspace-summary',
  '.tasks-summary-card.native-workspace-summary-card',
  '.tasks-command',
  '.tasks-search-field',
  '.tasks-filter-grid',
  '.tasks-panel',
  '.tasks-panel-head',
  '.tasks-result-count',
  '.tasks-table-wrap',
  '.tasks-list',
  '.tasks-card',
  '.tasks-card-meta',
  '.tasks-card-foot',
  '.tasks-empty',
  '.tasks-loading',
  '.tasks-modal',
  '.tasks-detail-grid',
  '.tasks-history-section{margin-top:0}',
  '.tasks-dependency-intro{margin-bottom:8px}',
  ':focus-visible',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:720px)',
  '@media(max-width:560px)',
  '@media(max-width:480px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value=>requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del owner');
forbid(styles,/@import|font-family\s*:\s*Arial|(?:linear|radial)-gradient/i,'tasks-workspace.css conserva importación tardía o estética legacy');

[
  "/admin/tasks-workspace.css?v=20260903-ux7tasks1",
  "/admin/tasks-workspace.js?v=20260904-notification-entry1"
].forEach(value=>requireText(loader,value,`loader canónico ${value}`));

[
  "authorizeAdmin(req,res,'tasks.read')",
  "authorizeAdmin(req,res,'tasks.write')",
  "authorizeAdmin(req,res,'tasks.manage')",
  'visibilityQuery(admin,manage)',
  "bodyAction === 'transition'",
  "bodyAction === 'set_dependencies'",
  "console.error('TASK_API_ERROR',message)",
  "return fail(res,500,'No se pudo completar la operación de tareas')"
].forEach(value=>requireText(api,value,`API de tareas ${value}`));
forbid(api,/return fail\(res,\s*(?:400|500),[^\n]*error\.message|String\(error\.message\)/,'api/tasks.js filtra detalles inesperados al cliente');

[
  "openSection(page, 'tasksSection')",
  'Tasks has one visual owner and responsive work cards',
  'tasks-workspace-iphone-safari',
  "tasksState.owner !== 'tasks-workspace.js'",
  'tasksState.metricCount !== 5',
  "item.path === '/api/tasks'",
  "checkpoint('tasks-workspace-readonly'",
  'submitted:false',
  'TASK_WORKSPACE_OPERATION_FAILED'
].forEach(value=>requireText(browserstack,value,`certificación iPhone ${value}`));

[
  "openSection(page, 'tasksSection')",
  'Tasks has one visual owner and responsive work cards',
  'TASK_WORKSPACE_OPERATION_FAILED'
].forEach(value=>requireText(browserstackGate,value,`gate BrowserStack ${value}`));

requireText(workflow,'node scripts/check-ux7-tasks-visual-owner.mjs','workflow del owner de tareas');
requireText(workflow,'npm install --ignore-scripts --no-audit --no-fund','instalación reproducible de dependencias del workflow');

const openBraces=(styles.match(/{/g)||[]).length;
const closeBraces=(styles.match(/}/g)||[]).length;
if(openBraces!==closeBraces)failures.push(`tasks-workspace.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

const context=vm.createContext({
  window:{},
  document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null},
  console,
  Set,
  Map,
  Date,
  Intl,
  Promise,
  Array,
  String,
  Number,
  Object,
  Boolean,
  FormData:class {},
  setTimeout:()=>0
});
context.window.window=context.window;

try {
  vm.runInContext(owner,context,{filename:files.owner});
  const tasksOwner=context.window.TasksWorkspace;
  if(!tasksOwner||tasksOwner.owner!=='tasks-workspace.js') {
    failures.push('fixture: el owner canónico no quedó expuesto');
  } else {
    const tasks=[
      {id:'t1',title:'Validar BL',description:'Revisar documento',status:'pending',priority:'critical',is_overdue:true,assigned_admin_id:'u1',assigned_admin_name:'Carla',assigned_team_id:'team-a',assigned_team_name:'Operaciones'},
      {id:'t2',title:'Confirmar proveedor',description:'Orden PO-20',status:'pending',priority:'normal',is_overdue:false,assigned_admin_id:'u2',assigned_admin_name:'Luis',assigned_team_id:'team-b',assigned_team_name:'Compras'},
      {id:'t3',title:'Actualizar tracking',description:'Salida confirmada',status:'in_progress',priority:'high',is_overdue:false,entity_label:'Contenedor MSCU123',assigned_team_id:'team-a'},
      {id:'t4',title:'Resolver bloqueo',description:'Falta documento',status:'blocked',priority:'high',is_overdue:true},
      {id:'t5',title:'Registrar factura',description:'Cierre listo',status:'completed',priority:'low',is_overdue:false,assigned_admin_id:'u1'},
      {id:'t6',title:'Archivo cancelado',description:'Sin acción',status:'cancelled',priority:'normal',is_overdue:false}
    ];
    const metrics=tasksOwner.taskCounts(tasks);
    if(JSON.stringify(metrics)!==JSON.stringify({pending:2,in_progress:1,blocked:1,overdue:2,completed:1}))failures.push(`fixture: métricas inesperadas ${JSON.stringify(metrics)}`);
    const defaults={activeFilter:'all',status:'all',priority:'all',team:'all',assignee:'all',query:''};
    const overdue=tasksOwner.visibleTasks(tasks,{...defaults,activeFilter:'overdue'});
    if(overdue.length!==2||overdue.some(task=>!task.is_overdue))failures.push('fixture: filtro de vencidas perdió su contrato');
    const critical=tasksOwner.visibleTasks(tasks,{...defaults,priority:'critical',query:'carla'});
    if(critical.length!==1||critical[0].id!=='t1')failures.push('fixture: prioridad, responsable o búsqueda perdió su contrato');
    const team=tasksOwner.visibleTasks(tasks,{...defaults,team:'team-a',query:'contenedor'});
    if(team.length!==1||team[0].id!=='t3')failures.push('fixture: equipo y trabajo vinculado perdieron su contrato');
    const unassigned=tasksOwner.visibleTasks(tasks,{...defaults,assignee:'unassigned'});
    if(unassigned.length!==2||!unassigned.some(task=>task.id==='t4')||!unassigned.some(task=>task.id==='t6'))failures.push('fixture: filtro sin asignar perdió su contrato');
    const initial=tasksOwner.getState();
    if(initial.activeFilter!=='pending'||initial.loading||initial.loaded||initial.total!==0)failures.push('fixture: estado inicial del owner no es seguro');
  }
} catch(error) {
  failures.push(`fixture runtime: ${error?.stack||error}`);
}

if(failures.length) {
  console.error(`UX-7 Tasks visual owner gate failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Tasks visual owner gate passed.');
console.log('- Five operational metrics, pure filters and responsive work cards share one native visual owner.');
console.log('- Runtime fixtures verify queue state, search, ownership, priority and overdue behavior without mutations.');
console.log('- Permissions, capabilities, comments, transitions, dependencies, workflow handoffs and API boundaries remain authoritative.');
