import fs from 'node:fs';
import vm from 'node:vm';

const files = {
  owner:'admin/workers-module.js',
  styles:'admin/workers-module.css',
  index:'admin/index.html',
  loader:'admin/erp.js',
  sectionState:'admin/section-state.js',
  api:'api/admins.js',
  browserstack:'e2e/browserstack/ux7-production-readonly.spec.cjs',
  browserstackGate:'scripts/check-browserstack-ios-readonly.mjs',
  workflow:'.github/workflows/ux6-workers-presentation.yml'
};

const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,value,label=value)=>{if(!source.includes(value))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);
if(fs.existsSync('admin/workers-responsive.js'))failures.push('workers-responsive.js debe permanecer retirado');
if(fs.existsSync('admin/workers-actions-menu.js'))failures.push('workers-actions-menu.js debe permanecer retirado');
if(fs.existsSync('admin/workers.html'))failures.push('workers.html duplica el owner visual y debe permanecer retirado');

const owner=read(files.owner);
const styles=read(files.styles);
const index=read(files.index);
const loader=read(files.loader);
const sectionState=read(files.sectionState);
const api=read(files.api);
const browserstack=read(files.browserstack);
const browserstackGate=read(files.browserstackGate);
const workflow=read(files.workflow);

[
  "section.dataset.workersOwner = 'workers-module.js'",
  'class="workers-shell native-workspace-shell"',
  'class="workers-head native-workspace-hero"',
  'class="workers-hero-state"',
  'id="workersOperationalState"',
  'id="workersLastUpdated"',
  'class="workers-summary native-workspace-summary"',
  "'workersMetricActive'",
  "'workersMetricInactive'",
  "'workersMetricTotal'",
  "'workersMetricWithoutPosition'",
  'class="workers-command"',
  'id="workersSearch" type="search"',
  'class="workers-tabs" role="tablist"',
  'id="workersReadOnlyNote"',
  'id="workersResultCount"',
  'id="workersDirectory" class="workers-directory" role="list"',
  'class="workers-card ',
  'id="workersModal"',
  'function visibleWorkers(',
  'function workerMetrics(',
  'function renderDirectory(',
  'function handleSectionKeydown(',
  'function handleDocumentKeydown(',
  "event.key === 'Escape'",
  "event.key !== 'Tab'",
  'window.WorkersModule = Object.freeze',
  'owner:OWNER',
  'getState,',
  'state'
].forEach(value=>requireText(owner,value,`owner visual ${value}`));

[
  "can('administration.workers.read')",
  "can('administration.workers.write')",
  'result.write_access === true',
  "actionAllowed(worker, 'history')",
  "actionAllowed(worker, 'edit')",
  "actionAllowed(worker, 'deactivate')",
  "actionAllowed(worker, 'reactivate')",
  "request('/api/admins?resource=workers'",
  'resource=worker_history&worker_id=',
  "method:'POST'",
  "method:'PATCH'",
  'safeWorkerMessage',
  'WORKERS_UI_FAILED',
  'WORKER_WRITE_PERMISSION_REQUIRED',
  'No hay trabajadores activos',
  'No hay trabajadores desactivados'
].forEach(value=>requireText(owner,value,`límite operativo ${value}`));

if((owner.match(/error\?\.message/g)||[]).length!==1)failures.push('error?.message solo puede leerse dentro del traductor seguro');
forbid(owner,/\berror\.message\b|\be\.message\b/,'Trabajadores renderiza errores técnicos directamente');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'Trabajadores usa diálogos nativos');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'Trabajadores inyecta CSS desde JavaScript');
forbid(owner,/\.style(?:\.|\[)/,'Trabajadores muta estilos inline');
forbid(owner,/\bMutationObserver\b|\bResizeObserver\b/,'Trabajadores observa y recompone el DOM');
forbid(owner,/\sstyle\s*=/i,'Trabajadores conserva atributos style');
forbid(owner,/<table\b/,'Trabajadores conserva una tabla ancha no responsiva');
forbid(owner,/currentUser\?*\.role|role\s*===\s*['"]master_admin['"]/,'Trabajadores infiere acceso por rol legacy');

[
  '#workersSection',
  '.workers-shell',
  '.workers-head.native-workspace-hero',
  '.workers-hero-state',
  '.workers-summary.native-workspace-summary',
  '.workers-summary-card.native-workspace-summary-card',
  '.workers-command',
  '.workers-search-field',
  '.workers-tabs',
  '.workers-readonly',
  '.workers-panel',
  '.workers-panel-head',
  '.workers-result-count',
  '.workers-directory',
  '.workers-directory-list',
  '.workers-card',
  '.workers-card-meta',
  '.workers-card-foot',
  '.workers-empty',
  '.workers-loading',
  '.workers-modal',
  '.workers-modal-form',
  '.workers-history',
  '#workersSection :focus-visible',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:760px)',
  '@media(max-width:560px)',
  '@media(max-width:480px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
].forEach(value=>requireText(styles,value,`CSS propietario ${value}`));

requireText(styles,'overflow-x:hidden;','protección contra desbordamiento del owner');
forbid(styles,/@import|font-family\s*:\s*Arial|(?:linear|radial)-gradient|!important/i,'workers-module.css conserva importación tardía, degradado o sobrescritura legacy');
const openBraces=(styles.match(/{/g)||[]).length;
const closeBraces=(styles.match(/}/g)||[]).length;
if(openBraces!==closeBraces)failures.push(`workers-module.css tiene llaves desbalanceadas: ${openBraces}/${closeBraces}`);

requireText(index,'<section id="workersSection" class="app-section hidden" aria-live="polite"></section>','placeholder vacío para el owner de Trabajadores');
const workersStart=index.indexOf('<section id="workersSection"');
const workersEnd=index.indexOf('<section id="adminsSection"',workersStart);
const workersMarkup=workersStart>=0&&workersEnd>workersStart?index.slice(workersStart,workersEnd):'';
forbid(workersMarkup,/workers-(?:shell|head|command|panel)|workerCreateForm/,'index.html duplica presentación del owner de Trabajadores');
forbid(index,/<script[^>]+src=["']\/admin\/workers-module\.js/i,'index.html carga estáticamente el owner de Trabajadores');

const cssRef="/admin/workers-module.css?v=20260903-ux7workers1";
const jsRef="/admin/workers-module.js?v=20260903-ux7workers1";
const cssIndex=loader.indexOf(cssRef);
const jsIndex=loader.indexOf(jsRef);
if(cssIndex<0||jsIndex<0||cssIndex>jsIndex)failures.push('erp.js debe cargar CSS antes del owner JavaScript de Trabajadores');
requireText(loader,"accessCan('administration.workers.read')",'carga condicionada por permiso efectivo de lectura');
requireText(loader,"/admin/section-state.js?v=20260903-ux7workers1",'restauración de secciones revisada');

requireText(sectionState,'accessControl.sectionAllowed(id)','restauración delegada al control de acceso DB-backed');
forbid(sectionState,/workersSection[^\n]+master_admin|adminsSection[^\n]+master_admin/,'section-state.js vuelve a bloquear por rol legacy');

[
  'loadAdminAccessContext',
  'workerWriteAccess',
  'workerCapabilities',
  "'administration.workers.read'",
  "'administration.workers.write'",
  "'WORKER_WRITE_PERMISSION_REQUIRED'",
  "'WORKER_ALREADY_INACTIVE'",
  "'WORKER_ALREADY_ACTIVE'",
  'write_access:writeAccess',
  'capabilities:workerCapabilities(worker, writeAccess)',
  "console.error('[api/admins]'",
  "return fail(res, 500, 'No se pudo completar la operación');"
].forEach(value=>requireText(api,value,`API de Trabajadores ${value}`));
forbid(api,/return fail\(res,\s*500,[^\n]*error\.message|String\(error\.message\)/,'api/admins.js filtra detalles inesperados al cliente');

[
  "openSection(page, 'workersSection')",
  'Workers has one visual owner and responsive directory cards',
  'workers-directory-iphone-safari',
  "workersState.owner !== 'workers-module.js'",
  'workersState.metricCount !== 4',
  "item.path === '/api/admins'",
  "checkpoint('workers-directory-readonly'",
  'submitted:false',
  'WORKERS_UI_FAILED'
].forEach(value=>requireText(browserstack,value,`certificación iPhone ${value}`));

[
  "openSection(page, 'workersSection')",
  'Workers has one visual owner and responsive directory cards',
  'WORKERS_UI_FAILED'
].forEach(value=>requireText(browserstackGate,value,`gate BrowserStack ${value}`));

requireText(workflow,'name: UX7 Workers Visual Owner','nombre del workflow dedicado');
requireText(workflow,'node scripts/check-ux7-workers-visual-owner.mjs','workflow del owner de Trabajadores');
requireText(workflow,'node scripts/check-browserstack-ios-readonly.mjs','contrato iPhone de solo lectura');
requireText(workflow,'npm install --ignore-scripts --no-audit --no-fund','instalación reproducible del workflow');

const context=vm.createContext({
  window:{},
  document:{readyState:'loading',addEventListener:()=>{},getElementById:()=>null},
  console,
  Set,
  Date,
  Promise,
  Array,
  String,
  Number,
  Object,
  Boolean,
  setTimeout:()=>0
});
context.window.window=context.window;

try {
  vm.runInContext(owner,context,{filename:files.owner});
  const workersOwner=context.window.WorkersModule;
  if(!workersOwner||workersOwner.owner!=='workers-module.js'){
    failures.push('fixture: el owner canónico no quedó expuesto');
  }else{
    const workers=[
      {id:'w1',full_name:'Carla Méndez',phone:'+5351111111',position:'Logística',is_active:true},
      {id:'w2',full_name:'Luis Pérez',phone:'+5352222222',position:'',is_active:true},
      {id:'w3',full_name:'Ana Ruiz',phone:'+5353333333',position:'Ventas',is_active:false,deactivation_reason:'Jubilación'}
    ];
    const metrics=workersOwner.workerMetrics(workers);
    if(JSON.stringify(metrics)!==JSON.stringify({total:3,active:2,inactive:1,withoutPosition:1}))failures.push(`fixture: métricas inesperadas ${JSON.stringify(metrics)}`);
    const active=workersOwner.visibleWorkers(workers,{status:'active',query:''});
    if(active.length!==2||active.some(worker=>worker.is_active===false))failures.push('fixture: filtro de activos perdió su contrato');
    const inactive=workersOwner.visibleWorkers(workers,{status:'inactive',query:'jubilación'});
    if(inactive.length!==1||inactive[0].id!=='w3')failures.push('fixture: estado inactivo o motivo perdieron su contrato');
    const search=workersOwner.visibleWorkers(workers,{status:'all',query:'logística'});
    if(search.length!==1||search[0].id!=='w1')failures.push('fixture: búsqueda por cargo perdió su contrato');
    const initial=workersOwner.getState();
    if(initial.status!=='active'||initial.loading||initial.loaded||initial.total!==0||initial.modalOpen)failures.push('fixture: estado inicial del owner no es seguro');
  }
}catch(error){
  failures.push(`fixture runtime: ${error?.stack||error}`);
}

try {
  let mountCallback=null;
  const requests=[];
  const section={dataset:{},innerHTML:'',addEventListener:()=>{}};
  const mountedContext=vm.createContext({
    window:{
      ExportMcaAccessControl:{can:()=>true},
      api:async path=>{
        requests.push(path);
        return {
          write_access:true,
          workers:[
            {id:'w1',full_name:'Carla Méndez',phone:'+5351111111',position:'Logística',is_active:true,capabilities:{actions:{history:{allowed:true},edit:{allowed:true},deactivate:{allowed:true},reactivate:{allowed:false}}}},
            {id:'w2',full_name:'Ana Ruiz',phone:'+5352222222',position:'Ventas',is_active:false,capabilities:{actions:{history:{allowed:true},edit:{allowed:true},deactivate:{allowed:false},reactivate:{allowed:true}}}}
          ]
        };
      },
      addEventListener:()=>{}
    },
    document:{
      readyState:'loading',
      activeElement:null,
      body:{classList:{add:()=>{},remove:()=>{}}},
      addEventListener:(name,callback)=>{if(name==='DOMContentLoaded')mountCallback=callback;},
      getElementById:id=>id==='workersSection'?section:null,
      querySelectorAll:()=>[]
    },
    console,
    Set,
    Date,
    Promise,
    Array,
    String,
    Number,
    Object,
    Boolean,
    setTimeout:()=>0
  });
  mountedContext.window.window=mountedContext.window;
  vm.runInContext(owner,mountedContext,{filename:`${files.owner}:mounted`});
  if(typeof mountCallback!=='function')failures.push('fixture montado: no registró el arranque del owner');
  else await mountCallback();
  const mountedOwner=mountedContext.window.WorkersModule;
  const mountedState=mountedOwner?.getState?.();
  if(section.dataset.workersOwner!=='workers-module.js'||!section.innerHTML.includes('id="workersDirectory"'))failures.push('fixture montado: la superficie canónica no se renderizó');
  if(requests.length!==1||requests[0]!=='/api/admins?resource=workers')failures.push(`fixture montado: consulta inicial inesperada ${JSON.stringify(requests)}`);
  if(!mountedState?.loaded||mountedState.total!==2||mountedState.metrics?.active!==1||mountedState.writeAccess!==true)failures.push(`fixture montado: estado inesperado ${JSON.stringify(mountedState)}`);
}catch(error){
  failures.push(`fixture montado: ${error?.stack||error}`);
}

try {
  let opened='';
  const section={classList:{contains:value=>value==='app-section'}};
  const sectionContext=vm.createContext({
    window:{
      showSection:id=>{opened=id;return true;},
      ExportMcaAccessControl:{sectionAllowed:id=>id==='workersSection'},
      dispatchEvent:()=>{},
      addEventListener:()=>{}
    },
    document:{
      documentElement:{style:{}},
      getElementById:id=>id==='workersSection'?section:null
    },
    localStorage:{getItem:()=> 'workersSection',setItem:()=>{},removeItem:()=>{}},
    CustomEvent:class {},
    requestAnimationFrame:callback=>callback()
  });
  sectionContext.window.window=sectionContext.window;
  vm.runInContext(sectionState,sectionContext,{filename:files.sectionState});
  if(opened!=='workersSection')failures.push('fixture de navegación: un permiso efectivo no restauró Trabajadores');
}catch(error){
  failures.push(`fixture de navegación: ${error?.stack||error}`);
}

if(failures.length){
  console.error(`UX-7 Workers visual owner gate failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX-7 Workers visual owner gate passed.');
console.log('- Four operational metrics, pure filters and responsive directory cards share one visual owner.');
console.log('- Runtime fixtures verify status, search and safe initial state without mutations.');
console.log('- Permissions, per-worker capabilities, history, audit RPCs and stable API boundaries remain authoritative.');
