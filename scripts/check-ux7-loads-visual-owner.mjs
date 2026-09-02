import fs from 'node:fs';
import vm from 'node:vm';

const files={
  html:'admin/loads.html',
  styles:'admin/loads.css',
  owner:'admin/loads.js',
  foundation:'admin/embedded-foundation.css',
  api:'api/loads.js',
  navigation:'admin/operational-navigation.js',
  bridge:'admin/operational-context-bridge.js',
  contextualGate:'scripts/check-contextual-sync.mjs',
  workflow:'.github/workflows/ux6-loads-presentation.yml'
};

const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files)){
  if(!fs.existsSync(file))failures.push(`falta ${file}`);
}

const html=read(files.html);
const styles=read(files.styles);
const owner=read(files.owner);
const foundation=read(files.foundation);
const api=read(files.api);
const navigation=read(files.navigation);
const bridge=read(files.bridge);
const contextualGate=read(files.contextualGate);
const workflow=read(files.workflow);

for(const text of [
  '<body class="erp-module-page erp-module-loads" data-owner="loads.js">',
  '/admin/embedded-foundation.css?v=20260902-ux6b3',
  '/admin/loads.css?v=20260902-ux7loads1',
  '/admin/loads.js?v=20260902-ux7loads1',
  '/admin/embedded-auto-refresh.js?v=20260902-ux7loads1',
  'class="module-hero loads-page-head"',
  'id="metrics" class="metrics loads-metrics"',
  'id="clearFilters"',
  'id="loadCount"',
  'id="loadCards"',
  'role="alertdialog"',
  'aria-live="polite"'
])requireText(html,text,`HTML canónico ${text}`);

const foundationIndex=html.indexOf('/admin/embedded-foundation.css?v=20260902-ux6b3');
const ownerCssIndex=html.indexOf('/admin/loads.css?v=20260902-ux7loads1');
if(foundationIndex<0||ownerCssIndex<0||foundationIndex>ownerCssIndex){
  failures.push('la base visual compartida debe cargar antes de loads.css');
}

forbid(html,/<style(?:\s|>)/i,'loads.html conserva CSS incrustado');
forbid(html,/<script(?![^>]*\bsrc=)[^>]*>/i,'loads.html conserva JavaScript incrustado');
forbid(html,/\sstyle\s*=/i,'loads.html conserva estilos inline');
forbid(html,/\son(?:click|change|input|submit|load|error)\s*=/i,'loads.html conserva handlers inline');

for(const selector of [
  '.loads-page-head',
  '.loads-metrics',
  '.loads-filter-panel',
  '.loads-list-panel',
  '.loads-table-wrap',
  '.loads-mobile-list',
  '.load-card',
  '.loads-drawer-modal',
  '.load-detail-section',
  '.status-flow',
  '.loads-context-grid',
  '.loads-empty',
  '@media(max-width:1180px)',
  '@media(max-width:840px)',
  '@media(max-width:620px)',
  '@media(max-width:390px)',
  '@media(prefers-reduced-motion:reduce)'
])requireText(styles,selector,`CSS propietario ${selector}`);

forbid(styles,/@import|!important|font-family\s*:\s*Arial|linear-gradient/i,'loads.css conserva estilos legacy, una importación tardía o una sobrescritura');
forbid(styles,/\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/,'loads.css mezcla comportamiento de JavaScript');
forbid(foundation,/erp-module-loads/,'la base compartida conserva reglas propietarias de Cargues');

for(const text of [
  "owner:'loads.js'",
  "const embeddedMode=new URLSearchParams(location.search).get('embedded')==='1';",
  'function redirectToAdminLogin()',
  "window.top.location.replace('/admin/index.html');",
  "function safeLoadMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.',context='operation')",
  "console.error('LOADS_UI_FAILED'",
  'function renderMetrics()',
  'function renderRows()',
  'function renderLoadDetail(load)',
  'async function renderOperationalContext(load)',
  'function actionButtons(load)',
  'function startLoads(',
  'function handleStoredSession(',
  "window.addEventListener('storage',handleStoredSession)",
  "can(load,'reserve')",
  "can(load,'release')",
  "can(load,'start_loading')",
  "can(load,'mark_loaded')",
  "can(load,'dispatch')",
  "can(load,'edit')",
  "can(load,'cancel')",
  "can(load,'assign_container')",
  "can(load,'unassign_container')",
  "can(load,'view_tracking')",
  "parentCan('sales.read')",
  "parentCan('warehouse.read')",
  "parentCan('logistics.read')",
  'window.LoadsModule=Object.freeze('
])requireText(owner,text,`owner de Cargues ${text}`);

if((owner.match(/error\?\.message/g)||[]).length!==1){
  failures.push('error?.message solo puede leerse dentro del traductor seguro de Cargues');
}
forbid(owner,/\berror\.message\b/,'Cargues vuelve a renderizar error.message directamente');
forbid(owner,/\be\.message\b/,'Cargues vuelve a renderizar e.message directamente');
forbid(owner,/\sstyle\s*=/i,'loads.js conserva estilos inline');
forbid(owner,/\.style(?:\.|\[)/,'loads.js vuelve a mutar estilos directamente');
forbid(owner,/document\.createElement\(['"]style['"]\)|style\.textContent/,'loads.js vuelve a inyectar CSS');
forbid(owner,/\bMutationObserver\b/,'loads.js vuelve a observar y recomponer el DOM');
forbid(owner,/\b(?:prompt|alert|confirm)\s*\(/,'loads.js vuelve a usar diálogos nativos');
forbid(owner,/location\.(?:href|replace)\s*=\s*['"]\/admin\/pwa\.html/,'Cargues vuelve a montar el ERP completo dentro del iframe');
forbid(owner,/if\s*\(!token\)\s*location\.(?:href|replace)/,'Cargues redirige el iframe antes de que el shell complete el inicio de sesión');
forbid(owner,/if\s*\(load\.status===['"](?:draft|reserved|loading|loaded)['"]\)/,'Cargues infiere acciones desde status en lugar de capabilities');

const embeddedListeners=new Map();
const embeddedRedirects=[];
let embeddedFetches=0;
const embeddedWindow={
  top:{location:{replace:path=>embeddedRedirects.push(`top:${path}`)}},
  addEventListener:(type,handler)=>embeddedListeners.set(type,handler),
  removeEventListener:type=>embeddedListeners.delete(type)
};

vm.runInNewContext(owner,{
  URLSearchParams,
  console,
  document:{getElementById:()=>null},
  fetch:async()=>{
    embeddedFetches+=1;
    throw new Error('No debe consultar la API antes de recibir la sesión');
  },
  localStorage:{getItem:()=>null,removeItem:()=>{}},
  location:{search:'?embedded=1',replace:path=>embeddedRedirects.push(`self:${path}`)},
  window:embeddedWindow
},{filename:files.owner});

if(embeddedRedirects.length)failures.push(`Cargues embebido sin sesión redirige prematuramente: ${embeddedRedirects.join(', ')}`);
if(!embeddedListeners.has('storage'))failures.push('Cargues embebido sin sesión no espera el token del shell');
if(embeddedFetches)failures.push('Cargues embebido consulta la API antes de que el shell complete el inicio de sesión');

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
  return {
    id,
    value:'',
    innerHTML:'',
    textContent:'',
    className:classes.join(' '),
    classList:new FakeClassList(...classes),
    dataset:{},
    attributes:new Map(),
    listeners:new Map(),
    hidden:false,
    disabled:false,
    addEventListener(type,handler){this.listeners.set(type,handler);},
    setAttribute(name,value){this.attributes.set(name,String(value));},
    focus(){},
    closest(){return null;}
  };
}

const fixtureNodes=new Map();
for(const id of [
  'metrics','pageMsg','newLoad','loadModuleMode','loadLastUpdated','loadCount','loadListContext',
  'loadRows','loadCards','empty','planWarehouse','containerClient','containerImporter',
  'existingContainer','search','statusFilter','refresh','clearFilters','savePlan','createContainer',
  'assignExisting','decisionAccept','decisionReject','drawerBody','drawerTitle','drawerSub','sourceGroups',
  'planScheduled','planNotes','planTitle','planMsg','containerLoadLabel','containerNumber','containerCarrier',
  'containerBooking','containerBol','containerMsg','decisionTitle','decisionText','drawerModal','planModal',
  'containerModal','decisionModal','loadOperationalContext','loadOperationalContextSection'
])fixtureNodes.set(id,fakeElement(id));

for(const id of ['drawerModal','planModal','containerModal','decisionModal'])fixtureNodes.get(id).classList.add('hidden');

const fixtureWindow={addEventListener(){},removeEventListener(){}};
fixtureWindow.parent=fixtureWindow;
fixtureWindow.top=fixtureWindow;
let fixtureFetches=0;

const listLoad={
  id:'load-1',
  load_number:'CG-<100>',
  status:'draft',
  notes:'Salida de prueba',
  scheduled_at:'2026-09-03T13:00:00.000Z',
  updated_at:'2026-09-02T18:45:00.000Z',
  warehouse_id:'warehouse-1',
  warehouse:{id:'warehouse-1',code:'MIA',name:'Miami'},
  shipment_id:null,
  shipment:null,
  capabilities:{container_pending:true,actions:{
    reserve:{allowed:true},
    edit:{allowed:true},
    assign_container:{allowed:true},
    create_container:{allowed:true},
    dispatch:{allowed:false},
    view_tracking:{allowed:false}
  }}
};

const detailLoad={
  ...listLoad,
  items:[{
    product_id:'product-1',
    product:{name:'Producto <Prueba>'},
    planned_quantity:24,
    planned_pallets:2,
    unit:'cajas',
    allocations:[{
      receipt_item_id:'receipt-item-1',
      allocated_quantity:24,
      allocated_pallets:2,
      receipt_item:{lot_number:'L-01',receipt:{receipt_number:'WR-100'}}
    }]
  }],
  traceability:[{
    receipt_number:'WR-100',
    product_name:'Producto <Prueba>',
    product_unit:'cajas',
    allocated_quantity:24,
    allocated_pallets:2,
    reserved_quantity_net:0,
    dispatched_quantity:0
  }]
};

vm.runInNewContext(owner,{
  URLSearchParams,
  console,
  document:{
    activeElement:fakeElement('active'),
    addEventListener(){},
    getElementById:id=>fixtureNodes.get(id)||null,
    querySelectorAll:selector=>selector==='.modal'
      ?['drawerModal','planModal','containerModal','decisionModal'].map(id=>fixtureNodes.get(id))
      :[]
  },
  fetch:async url=>{
    fixtureFetches+=1;
    const detail=String(url).includes('?id=');
    return {
      ok:true,
      status:200,
      json:async()=>detail?{load:detailLoad}:{
        loads:[listLoad],
        warehouses:[{id:'warehouse-1',code:'MIA',name:'Miami'}],
        sources:[],
        clients:[],
        importers:[],
        shipments:[],
        stats:{total:1,draft:1,reserved:0,loading:0,loaded:0,dispatched:0,cancelled:0},
        write_access:true
      }
    };
  },
  localStorage:{getItem:key=>key==='export_mca_token'?'fixture-token':null,removeItem(){}},
  location:{search:'?embedded=1',replace(){}},
  window:fixtureWindow
},{filename:`${files.owner}:fixture`});

await new Promise(resolve=>setTimeout(resolve,0));
await new Promise(resolve=>setTimeout(resolve,0));

if(fixtureFetches!==1)failures.push(`Cargues debe consultar una vez su bootstrap al iniciar; consultó ${fixtureFetches}`);
if(!fixtureNodes.get('loadRows').innerHTML.includes('CG-&lt;100&gt;'))failures.push('Cargues no escapa ni presenta la operación del bootstrap');
if(!fixtureNodes.get('loadCards').innerHTML.includes('MIA · Miami'))failures.push('Cargues no presenta la vista móvil de la operación');
if(fixtureNodes.get('loadCount').textContent!=='1 cargue')failures.push('Cargues no actualiza el contador de resultados');
if(fixtureNodes.get('newLoad').hidden)failures.push('Cargues oculta la acción de creación pese a write_access');
if(!fixtureNodes.get('metrics').innerHTML.includes('Planes en preparación'))failures.push('Cargues no presenta el resumen operativo');

await fixtureWindow.LoadsModule?.openLoad('load-1');
if(fixtureFetches!==2)failures.push(`Abrir un cargue debe consultar una vez el detalle; total de consultas ${fixtureFetches}`);
if(fixtureNodes.get('drawerModal').classList.contains('hidden'))failures.push('El detalle de Cargues no abre su drawer accesible');
if(fixtureNodes.get('drawerModal').attributes.get('aria-hidden')!=='false')failures.push('El drawer de Cargues no sincroniza aria-hidden');
if(!fixtureNodes.get('drawerBody').innerHTML.includes('Producto &lt;Prueba&gt;'))failures.push('El detalle no escapa ni presenta la mercancía');
if(!fixtureNodes.get('drawerBody').innerHTML.includes('WR-100'))failures.push('El detalle no conserva la trazabilidad WR');
if(!fixtureNodes.get('drawerBody').innerHTML.includes('data-action="reserve"'))failures.push('El detalle no presenta la acción permitida por capabilities');
if(fixtureNodes.get('drawerBody').innerHTML.includes('data-action="dispatch"'))failures.push('El detalle presenta una acción denegada por capabilities');

for(const text of [
  "authorizeAdmin(req,res,req.method==='GET'?'logistics.read':'logistics.write')",
  "supabase('rpc/execute_load_action'",
  "supabase('rpc/replace_load_plan_canonical'",
  "supabase('rpc/create_load_shipment_canonical'",
  "supabase('rpc/assign_load_shipment_canonical'",
  "return fail(res,500,'No se pudo procesar Cargues')"
])requireText(api,text,`API canónica de Cargues ${text}`);

requireText(navigation,"return callEmbedded('loadsSection','LoadsModule.openLoad',[loadId]);",'navegación directa hacia LoadsModule.openLoad');
forbid(navigation,/CONTEXT_SECTIONS[^;]*loadsSection/,'Cargues sigue recibiendo el bridge visual compartido');
forbid(navigation,/openLoad[^\n]*installBridge\('loadsSection'\)/,'openLoad todavía inyecta el bridge anterior');
forbid(bridge,/function initLoads\s*\(/,'el bridge conserva un segundo owner de Cargues');
forbid(bridge,/\/admin\/loads\.html/,'el bridge todavía se activa dentro de Cargues');
requireText(contextualGate,'openOperationalPurchaseReceipt','gate contextual preservado');

for(const text of [
  'admin/loads.css',
  'admin/loads.html',
  'admin/loads.js',
  'admin/operational-navigation.js',
  'admin/operational-context-bridge.js',
  'scripts/check-ux7-loads-visual-owner.mjs',
  'node scripts/check-ux7-loads-visual-owner.mjs',
  'node scripts/check-contextual-sync.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs'
])requireText(workflow,text,`workflow ${text}`);

const openingBraces=(styles.match(/{/g)||[]).length;
const closingBraces=(styles.match(/}/g)||[]).length;
if(openingBraces!==closingBraces)failures.push(`loads.css está desbalanceado: ${openingBraces}/${closingBraces}`);

if(failures.length){
  console.error('UX-7 Loads visual owner gate failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-7 Loads visual owner gate passed.');
console.log('- Cargues usa los owners canónicos loads.html, loads.css y loads.js.');
console.log('- Listado, responsive, drawers y acciones conservan capabilities del backend.');
console.log('- El iframe espera la sesión del shell y las relaciones operativas no dependen de un segundo bridge visual.');
