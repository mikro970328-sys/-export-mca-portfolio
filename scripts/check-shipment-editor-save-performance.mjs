import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const nodes = new Map();
const ids = [
  'shipmentEditorMessage','editorQuantity','editorClient','editorContainer','editorProduct',
  'editorQuantityUnit','editorDepartureDate','editorCarrier','editorBooking','editorBol',
  'editorStatus','editorImporter','shipmentEditorSave','shipmentEditorCancel','dashboardSection'
];
for (const id of ids) nodes.set(id,{id,value:'',textContent:'',className:'',disabled:false,isConnected:true,addEventListener(){},focus(){}});
nodes.get('dashboardSection').classList={contains:name=>name==='hidden'};
const fixture = {
  id:'shipment-1',container_number:'SIMU0000001',client_id:null,product:'Mercancia simulada',
  quantity:1,quantity_unit:'unidad simulada',departure_date:null,carrier:'SIMULACION INTERNA',
  booking_number:'SIM-BOOK',bol_number:'SIM-BL',operational_status:'Registrado',last_status:'Registrado',
  importer_id:'importer-1'
};
const importerState={importers:[{id:'importer-1',name:'Importadora Uno',active:true}],client_importers:[],shipment_importers:[{shipment_id:fixture.id,importer_id:'importer-1'}]};
const window={shipments:[{...fixture}],clients:[],importerState,shipmentWriteAccess:true,loadAll(){throw new Error('full reload must not run')}};
let closeCount=0,renderCount=0,syncCount=0,dashboardCount=0;
let passedImporterState=null;
window.openModal=(_title,_html)=>{
  const current=window.shipments[0];
  const values={editorClient:current.client_id||'',editorContainer:current.container_number,editorProduct:current.product,editorQuantity:String(current.quantity),editorQuantityUnit:current.quantity_unit,editorDepartureDate:current.departure_date||'',editorCarrier:current.carrier,editorBooking:current.booking_number,editorBol:current.bol_number,editorStatus:current.operational_status,editorImporter:window.importerState.importers.find(item=>item.id===current.importer_id)?.name||''};
  for(const [id,value] of Object.entries(values))nodes.get(id).value=value;
  nodes.get('shipmentEditorSave').isConnected=true;
};
window.closeModal=()=>{closeCount++;nodes.get('shipmentEditorSave').isConnected=false};
window.ContainersModule={render(){renderCount++},async syncImporters(state){syncCount++;passedImporterState=state;window.importerState=state}};
window.ExportMcaAdminData={loadDashboard(){dashboardCount++;return Promise.resolve()}};
const requests=[];
const document={
  readyState:'complete',
  getElementById:id=>nodes.get(id)||null,
  querySelectorAll:()=>[...nodes.values()],
  addEventListener(){},
  activeElement:null
};
const response=(data)=>({ok:true,json:async()=>data});
const fetch=async(path,options={})=>{
  const body=options.body?JSON.parse(options.body):{};
  requests.push({path,method:options.method||'GET',body});
  if(path==='/api/shipments')return response({shipment:{...window.shipments[0],...body,capabilities:{actions:{edit:{allowed:true}}}}});
  if(path==='/api/importers'){
    const next={importers:[{id:'importer-1',name:'Importadora Uno',active:true},{id:'importer-2',name:'Importadora Dos',active:true}],client_importers:[],shipment_importers:[{shipment_id:fixture.id,importer_id:'importer-2'}]};
    return response({assignment:{shipment_id:fixture.id,importer_id:'importer-2'},state:next});
  }
  throw new Error('Unexpected request '+path);
};
vm.runInNewContext(fs.readFileSync('admin/shipment-editor.js','utf8'),{window,document,fetch,localStorage:{getItem:()=>''},console});
const editor=window.ShipmentEditor;
await editor.open(fixture.id);
nodes.get('editorProduct').value='Mercancia simulada editada';
await nodes.get('shipmentEditorSave').onclick();
assert.equal(requests.length,1,'a product edit should make one request');
assert.equal(requests[0].path,'/api/shipments');
assert.deepEqual(Object.keys(requests[0].body).sort(),['id','product'],'only changed shipment fields should be sent');
assert.equal(window.shipments[0].product,'Mercancia simulada editada','local row should update from the save response');
assert.ok(renderCount>0,'tracking should render from the updated local row');
assert.equal(syncCount,0,'unchanged importer should not be reloaded');
assert.equal(dashboardCount,0,'hidden dashboard should not refresh');
await editor.open(fixture.id);
const beforeNoop=requests.length;
await nodes.get('shipmentEditorSave').onclick();
assert.equal(requests.length,beforeNoop,'unchanged form should not write');
await editor.open(fixture.id);
nodes.get('editorImporter').value='Importadora Dos';
const beforeImporter=requests.length;
await nodes.get('shipmentEditorSave').onclick();
assert.equal(requests.length,beforeImporter+1,'importer-only edit should make one request');
assert.equal(requests.at(-1).path,'/api/importers');
assert.equal(window.shipments[0].importer_id,'importer-2','local shipment should reflect importer assignment');
assert.equal(syncCount,1,'returned importer state should update tracking without another request');
assert.ok(passedImporterState?.shipment_importers?.some(row=>row.importer_id==='importer-2'));
assert.equal(dashboardCount,0);
assert.equal(closeCount,3);
console.log('Shipment editor save-performance regression passed: sparse update, no-op skip, importer-only update, local refresh, no full reload.');
