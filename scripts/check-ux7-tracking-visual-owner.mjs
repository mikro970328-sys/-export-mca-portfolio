import fs from 'node:fs';
import vm from 'node:vm';

const files={
  html:'admin/index.html',
  styles:'admin/containers-module.css',
  owner:'admin/containers-module.js',
  editor:'admin/shipment-editor.js',
  editorStyles:'admin/shipment-editor.css',
  loader:'admin/erp.js',
  foundation:'admin/native-workspace-foundation.css',
  workflow:'.github/workflows/ux6-containers-presentation.yml'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const html=read(files.html);
const styles=read(files.styles);
const owner=read(files.owner);
const editor=read(files.editor);
const editorStyles=read(files.editorStyles);
const loader=read(files.loader);
const foundation=read(files.foundation);
const workflow=read(files.workflow);

const sectionMarkup=(id,nextId)=>{
  const start=html.indexOf(`<section id="${id}"`);
  const end=nextId?html.indexOf(`<section id="${nextId}"`,start):html.length;
  return start>=0&&end>start?html.slice(start,end):'';
};
const registration=sectionMarkup('registerContainerSection','containersSection');
const tracking=sectionMarkup('containersSection','publicationsSection');

for(const text of [
  'data-owner="containers-module.js"',
  'id="shipmentRegistrationForm"',
  'id="registrationReadiness"',
  'id="resetShipmentForm"',
  'id="shipmentContainer"',
  'id="shipmentImporter"',
  'class="tracking-registration-layout"',
  'class="registration-guide"',
  'type="submit"'
])requireText(registration,text,`registro estático ${text}`);

for(const text of [
  'data-owner="containers-module.js"',
  'id="trackingTitle"',
  'class="tracking-metrics"',
  'id="trackingTotalCount"',
  'id="trackingActiveCount"',
  'id="trackingDeliveredCount"',
  'id="trackingUnassignedCount"',
  'id="trackingDocumentsReadyCount"',
  'id="trackingClearFilters"',
  'id="shipmentSearch"',
  'data-container-filter="active"',
  'id="trackingResultCount"',
  'id="shipments"',
  'aria-live="polite"'
])requireText(tracking,text,`Tracking estático ${text}`);

forbid(registration,/\sstyle\s*=|\son(?:click|change|input|submit)\s*=/i,'el registro estático conserva estilo o handler inline');
forbid(tracking,/\sstyle\s*=|\son(?:click|change|input|submit)\s*=/i,'Tracking estático conserva estilo o handler inline');

for(const selector of [
  '.tracking-hero',
  '.tracking-metrics',
  '.tracking-filter-panel',
  '.tracking-table-wrap',
  '.tracking-mobile-list',
  '.tracking-card',
  '.tracking-registration-layout',
  '.registration-guide',
  'grid-template-columns:minmax(0,1fr)',
  '.container-actions-popover',
  '.tracking-dialog-root',
  '.tracking-history',
  '.manual-track-list',
  '@media(max-width:1180px)',
  '@media(max-width:900px)',
  '@media(max-width:700px)',
  '@media(max-width:430px)',
  '@media(prefers-reduced-motion:reduce)'
])requireText(styles,selector,`CSS propietario ${selector}`);

forbid(styles,/@import|!important|font-family\s*:\s*Arial|(?:linear|radial)-gradient/i,'containers-module.css conserva CSS legacy, importaciones tardías o degradados');
forbid(styles,/\b(?:fetch|MutationObserver)\b|\b(?:prompt|alert|confirm)\s*\(/,'containers-module.css mezcla comportamiento JavaScript');
forbid(foundation,/#registerContainerSection|#containersSection/,'la base compartida invade el owner de Tracking');

for(const text of [
  "owner:'containers-module.js'",
  "trackingOwner:'containers-module.js'",
  "registrationOwner:'containers-module.js'",
  'function renderMetrics()',
  'function tableRow(shipment)',
  'function mobileCard(shipment)',
  'function syncContainerGuidance()',
  'function resetRegistrationForm(',
  'function actionList(shipment)',
  'return defs.filter(([cap])=>actionAllowed(shipment,cap))',
  "register.hidden=!shipmentWriteAccess()",
  "request('/api/shipment-document-readiness')",
  "request('/api/shipments'",
  "request('/api/importers'",
  "request('/api/shipment-documents'",
  "request('/api/history?shipment_id='",
  "request('/api/manual-tracking-event'",
  "request('/api/tracking-alerts?action=check')",
  "window.OperationalNavigation?.loadForShipment?.(shipment.id)",
  "window.TasksWorkspace?.load?.()",
  "window.ExportMcaAccessControl?.can?.('documents.write')"
])requireText(owner,text,`owner de Tracking ${text}`);

for(const capability of ['view_info','view_documents','edit','view_history','assign_client','manual_tracking','release','deliver','reactivate','delete']){
  requireText(owner,`['${capability}'`, `capability ${capability}`);
}

forbid(owner,/\sstyle\s*=/i,'containers-module.js conserva estilos inline');
forbid(owner,/\.style(?:\.|\[)/,'containers-module.js muta estilos directamente');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'containers-module.js inyecta CSS');
forbid(owner,/\bMutationObserver\b/,'containers-module.js recompone el DOM con MutationObserver');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'containers-module.js usa diálogos nativos');
forbid(owner,/registration-form-shell/i,'containers-module.js conserva el shell visual retirado');
forbid(loader,/registration-form-shell/i,'erp.js conserva el shell visual retirado');
if(fs.existsSync('admin/registration-form-shell.js'))failures.push('registration-form-shell.js debe permanecer retirado');

for(const text of [
  "loadStylesheet('/admin/containers-module.css?v=20260903-ux7tracking2', 'data-containers-module-style')",
  "loadScript('/admin/containers-module.js?v=20260903-ux7tracking2', 'data-containers-module')",
  "loadStylesheet('/admin/shipment-editor.css?v=20260903-ux7tracking2', 'data-shipment-editor-style')",
  "loadScript('/admin/shipment-editor.js?v=20260903-ux7tracking2', 'data-shipment-editor')"
])requireText(loader,text,`asset canónico ${text}`);
requireText(html,'/admin/erp.js?v=20260903-ux7icons2','revisión de caché del ERP');

for(const text of [
  'class="shipment-editor" data-owner="shipment-editor.js"',
  'class="shipment-editor-summary"',
  'class="shipment-editor-section-head"',
  'for="editorClient"',
  'for="editorContainer"',
  "request('/api/shipments', { method:'PATCH', body:JSON.stringify(payload()) })",
  "action:'assign_shipment'",
  "owner:'containers-module.js'"
])requireText(editor,text,`editor ${text}`);
for(const selector of ['.shipment-editor-summary','.shipment-editor-grid','.shipment-editor-info','.shipment-editor-footer','.shipment-editor-error','@media(max-width:720px)',':focus-visible'])requireText(editorStyles,selector,`CSS editor ${selector}`);
forbid(editor,/\sstyle\s*=|\.style(?:\.|\[)|\b(?:prompt|alert|confirm)\s*\(/i,'ShipmentEditor conserva estilos inline, mutaciones visuales o diálogos nativos');
forbid(editorStyles,/@import|!important|font-family\s*:\s*Arial|(?:linear|radial)-gradient/i,'shipment-editor.css conserva CSS legacy o degradados');

for(const text of [
  'admin/index.html',
  'admin/containers-module.css',
  'admin/containers-module.js',
  'admin/shipment-editor.css',
  'admin/shipment-editor.js',
  'scripts/check-ux7-tracking-visual-owner.mjs',
  'node scripts/check-ux7-tracking-visual-owner.mjs',
  'node scripts/check-ux5-shipment-actions.mjs',
  'node scripts/check-cuba-documentation.mjs',
  'node scripts/check-shipment-importer-independence.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs'
])requireText(workflow,text,`workflow ${text}`);

class FakeClassList{
  constructor(...names){this.names=new Set(names);}
  add(...names){names.forEach(name=>this.names.add(name));}
  remove(...names){names.forEach(name=>this.names.delete(name));}
  contains(name){return this.names.has(name);}
  toggle(name,force){
    const active=force===undefined?!this.names.has(name):Boolean(force);
    if(active)this.names.add(name);else this.names.delete(name);
    return active;
  }
}

function fakeElement(id,...classes){
  const readinessText={textContent:''};
  return {
    id,
    value:'',
    innerHTML:'',
    textContent:'',
    className:classes.join(' '),
    classList:new FakeClassList(...classes),
    dataset:{},
    hidden:false,
    disabled:false,
    options:[],
    attributes:new Map(),
    listeners:new Map(),
    addEventListener(type,handler){this.listeners.set(type,handler);},
    setAttribute(name,value){this.attributes.set(name,String(value));},
    focus(){},
    reset(){this.value='';},
    querySelector(selector){return selector==='span:last-child'?readinessText:null;},
    closest(){return null;}
  };
}

const fixtureNodes=new Map();
for(const id of [
  'registerContainerSection','containersSection','shipments','saveShipment','shipmentRegistrationForm',
  'resetShipmentForm','shipmentContainer','registrationContainerHelp','registrationReadiness','shipmentMsg',
  'shipmentClient','shipmentImporter','shipmentImporterOptions','shipmentBooking','shipmentBol','shipmentCarrier',
  'shipmentDepartureDate','shipmentProduct','shipmentQuantity','shipmentQuantityUnit','shipmentSearch',
  'trackingClearFilters','trackingRegisterShortcut','trackingLastUpdated','trackingResultCount','trackingFeedback',
  'trackingTotalCount','trackingActiveCount','trackingDeliveredCount','trackingUnassignedCount','trackingDocumentsReadyCount'
])fixtureNodes.set(id,fakeElement(id));

const filterButtons=['active','delivered','all'].map(filter=>{
  const button=fakeElement(`filter-${filter}`,filter==='active'?'active':'');
  button.dataset.containerFilter=filter;
  return button;
});

const fixtureWindow={
  shipments:[
    {
      id:'shipment-1',container_number:'ABCD1234567',client_id:null,active:true,carrier:'Crowley',product:'Producto <Seguro>',quantity:24,quantity_unit:'cajas',departure_date:'2026-09-03',booking_number:'BK-1',bol_number:'BL-1',operational_status:'Registrado',clients:null,
      capabilities:{actions:{view_info:{allowed:true},view_documents:{allowed:true},edit:{allowed:true},view_history:{allowed:true},assign_client:{allowed:true},manual_tracking:{allowed:true},release:{allowed:true},deliver:{allowed:false},reactivate:{allowed:false},delete:{allowed:false}}}
    },
    {
      id:'shipment-2',container_number:'WXYZ7654321',client_id:'client-1',active:false,carrier:'MSC',product:'Aceite',operational_status:'Entregado',clients:{name:'Cliente Uno'},
      capabilities:{actions:{view_info:{allowed:true},view_documents:{allowed:false},edit:{allowed:false},view_history:{allowed:true},assign_client:{allowed:false},manual_tracking:{allowed:false},release:{allowed:false},deliver:{allowed:false},reactivate:{allowed:true},delete:{allowed:false}}}
    }
  ],
  clients:[{id:'client-1',name:'Cliente Uno',company:'Empresa Uno'}],
  shipmentWriteAccess:true,
  addEventListener(){},
  dispatchEvent(){},
  showSection(){},
  ExportMcaAccessControl:{can:()=>false}
};

let fixtureFetches=0;
vm.runInNewContext(owner,{
  console,
  document:{
    readyState:'complete',
    activeElement:fakeElement('active'),
    body:{appendChild(){}},
    getElementById:id=>fixtureNodes.get(id)||null,
    querySelector:()=>null,
    querySelectorAll:selector=>selector==='[data-container-filter]'?filterButtons:[],
    addEventListener(){},
    createElement:tag=>fakeElement(tag)
  },
  fetch:async url=>{
    fixtureFetches+=1;
    const data=String(url).includes('shipment-document-readiness')
      ?{readiness:[{shipment_id:'shipment-1',document_status:'ready',missing_documents:[]}]}
      :{importers:[{id:'importer-1',name:'Importadora Uno',active:true}],client_importers:[],shipment_importers:[{shipment_id:'shipment-1',importer_id:'importer-1'}]};
    return {ok:true,json:async()=>data};
  },
  localStorage:{getItem:()=> 'fixture-token'},
  Intl,
  Date,
  Map,
  Set,
  FormData,
  CustomEvent:class CustomEvent{},
  setTimeout,
  clearTimeout,
  window:fixtureWindow
},{filename:`${files.owner}:fixture`});

await new Promise(resolve=>setTimeout(resolve,0));
await new Promise(resolve=>setTimeout(resolve,0));

if(fixtureFetches!==2)failures.push(`Tracking debe consultar importadoras y readiness una vez al iniciar; consultó ${fixtureFetches}`);
if(!fixtureWindow.ContainersModule)failures.push('Tracking no publica su owner después del montaje');
if(!fixtureNodes.get('shipments').innerHTML.includes('tracking-table-wrap'))failures.push('Tracking no presenta la tabla de escritorio');
if(!fixtureNodes.get('shipments').innerHTML.includes('tracking-mobile-list'))failures.push('Tracking no presenta las tarjetas móviles');
if(!fixtureNodes.get('shipments').innerHTML.includes('Producto &lt;Seguro&gt;'))failures.push('Tracking no escapa el contenido operativo');
if(fixtureNodes.get('trackingTotalCount').textContent!=='2')failures.push('Tracking no calcula el total visible recibido del backend');
if(fixtureNodes.get('trackingActiveCount').textContent!=='1')failures.push('Tracking no presenta el total activo');
if(fixtureNodes.get('trackingDeliveredCount').textContent!=='1')failures.push('Tracking no presenta el total entregado');
if(fixtureNodes.get('trackingUnassignedCount').textContent!=='1')failures.push('Tracking no presenta operaciones sin cliente');
if(fixtureNodes.get('trackingDocumentsReadyCount').textContent!=='1')failures.push('Tracking no limita Docs READY a documentos visibles y listos');
if(fixtureNodes.get('registerContainerSection').hidden)failures.push('Tracking oculta el registro pese a shipmentWriteAccess');

fixtureWindow.shipmentWriteAccess=false;
fixtureWindow.ContainersModule?.render();
if(!fixtureNodes.get('registerContainerSection').hidden)failures.push('Tracking expone el registro sin shipmentWriteAccess');
if(!fixtureNodes.get('trackingRegisterShortcut').hidden)failures.push('Tracking expone el acceso directo de registro sin shipmentWriteAccess');

for(const [file,source] of [[files.styles,styles],[files.editorStyles,editorStyles]]){
  const opening=(source.match(/{/g)||[]).length;
  const closing=(source.match(/}/g)||[]).length;
  if(opening!==closing)failures.push(`${file} está desbalanceado: ${opening}/${closing}`);
}

if(failures.length){
  console.error('UX-7 Tracking visual owner gate failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 Tracking visual owner gate passed.');
console.log('- Registro, listado, métricas, responsive y diálogos pertenecen a containers-module.js.');
console.log('- Acciones y documentos conservan capabilities, permisos y contratos del backend.');
console.log('- El shell visual dinámico anterior permanece retirado.');
