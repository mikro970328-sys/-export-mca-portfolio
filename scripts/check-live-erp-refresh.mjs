import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { assertAllocationsWithinAvailability } from '../api/_load-plan-availability.js';

const read=file=>fs.readFileSync(file,'utf8');
const shell=read('admin/index.html');
const refresh=read('admin/embedded-auto-refresh.js');
const loads=read('admin/loads.js');
const loadsApi=read('api/loads.js');
const salesLoadsApi=read('api/sales-loads.js');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};

for(const text of [
  '/admin/embedded-auto-refresh.js?v=20260904-live2',
  '/admin/erp.js?v=20260904-simple-nav1'
])requireText(shell,text,`shell ${text}`);

for(const text of [
  'function installTopFetchObserver()',
  'function frameRefresher(win)',
  'function mutationScope(path)',
  'function scheduleShellRefresh(reason,scope)',
  "loader?.loadCore",
  "loader?.loadDashboard",
  "window.addEventListener('storage'",
  "['/api/sales-loads','loads']",
  "['/api/shipments','shipments']",
  "['/api/clients','clients']",
  "new CustomEvent('export-mca:mutation-committed'"
])requireText(refresh,text,`sincronización ${text}`);

for(const text of [
  "if(current.wasBusy&&!busy&&current.pending)refreshFrame(frame,'close-after-change')",
  'function scheduleSourceRefresh(frame,scope)',
  'if(sourceFrame)scheduleSourceRefresh(sourceFrame,scope)',
  "if(method==='GET'&&current?.fallbackTimer)",
  'refreshSections(RELATED[scope] || [], sourceFrame',
  "scheduleShellRefresh('cross-tab-change',scope)"
])requireText(refresh,text,`recarga solo después de cambios ${text}`);

for(const forbidden of [
  "window.addEventListener('focus'",
  "document.addEventListener('visibilitychange'",
  "refreshFrame(frame, 'section-open')",
  "refreshFrame(sourceFrame, `mutation:${scope}:self`)"
])if(refresh.includes(forbidden))failures.push(`recarga pasiva prohibida ${forbidden}`);

for(const text of [
  'const NEXT_STAGE=Object.freeze({',
  'const ACTION_REASON_LABELS=Object.freeze({',
  'function compactNextStep(load)',
  'function nextStageMarkup(load)',
  'function handleLoadListClick(event)',
  'data-quick-action=',
  'Revisar bloqueo',
  'supera el saldo disponible'
])requireText(loads,text,`flujo visible ${text}`);

for(const source of [loadsApi,salesLoadsApi]){
  requireText(source,"from './_load-plan-availability.js'",'import de disponibilidad de WR');
  requireText(source,'await assertLoadPlanAvailability(lines)','validación autoritativa antes de crear el plan');
}

const id='11111111-1111-4111-8111-111111111111';
const lines=[{allocations:[{receipt_item_id:id,allocated_quantity:840,allocated_pallets:28}]}];
const balances=[{receipt_item_id:id,physical_quantity:840,reserved_quantity:0,physical_pallets:28,reserved_pallets:0}];
assert.equal(assertAllocationsWithinAvailability(lines,balances),true);
assert.throws(
  ()=>assertAllocationsWithinAvailability([{allocations:[{receipt_item_id:id,allocated_quantity:841,allocated_pallets:28}]}],balances),
  /INSUFFICIENT_WR_AVAILABLE_BALANCE/
);
assert.throws(
  ()=>assertAllocationsWithinAvailability([{allocations:[{receipt_item_id:id,allocated_quantity:840,allocated_pallets:29}]}],balances),
  /INSUFFICIENT_WR_AVAILABLE_BALANCE/
);

const listeners=new Map();
let coreRefreshes=0;
let dashboardRefreshes=0;
class FixtureObserver{observe(){} disconnect(){}}
class FixtureEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}}
const fixtureWindow={
  addEventListener(type,handler){listeners.set(type,handler);},
  dispatchEvent(event){listeners.get(event.type)?.(event);},
  fetch:async()=>({ok:true}),
  ExportMcaAdminData:{
    async loadCore(){coreRefreshes+=1;},
    async loadDashboard(){dashboardRefreshes+=1;}
  }
};
fixtureWindow.parent=fixtureWindow;
fixtureWindow.top=fixtureWindow;
const fixtureDocument={
  readyState:'complete',
  body:{},
  hidden:false,
  addEventListener(){},
  querySelector(){return null;},
  querySelectorAll(){return [];}
};
vm.runInNewContext(refresh,{
  window:fixtureWindow,
  document:fixtureDocument,
  location:{href:'https://erp.example/admin/index.html',hash:'',pathname:'/admin/index.html',search:''},
  history:{state:null,replaceState(){}},
  localStorage:{setItem(){}},
  MutationObserver:FixtureObserver,
  CustomEvent:FixtureEvent,
  CSS:{escape:value=>String(value)},
  URL,
  Date,
  JSON,
  console,
  setTimeout,
  clearTimeout
},{filename:'admin/embedded-auto-refresh.js'});
await fixtureWindow.fetch('/api/loads',{method:'POST'});
await new Promise(resolve=>setTimeout(resolve,220));
assert.equal(coreRefreshes,1,'una mutación debe reconciliar los datos base del ERP');
assert.equal(dashboardRefreshes,1,'una mutación debe reconciliar el dashboard');

if(failures.length){
  console.error('Live ERP refresh and Load flow check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Live ERP refresh and Load flow check passed.');
