import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import * as lib from '../api/_lib.js';
import * as cargoModule from '../api/_shipment-cargo.js';
import {logisticsFixture} from './lib/figma-logistics-fixture.mjs';

// Real projection, API serializer and native Tracking/editor. All records below
// are isolated examples; external requests and notifications are prohibited.
const sale={id:'sale-example',so_number:'SO-EXAMPLE',status:'confirmed'};
const allocation=(id,shipment,quantity,pallets,unit='unidades',productId='product-example',name='Refresco <Ejemplo>')=>({
  id,shipment_id:shipment,allocated_sales_quantity:quantity,allocated_sales_pallets:pallets,
  procurement:{supply_plan_line:{sales_order_item:{product_id:productId,unit,
    product:{id:productId,name,sku:'SKU-EXAMPLE'},sales_order:sale}},purchase_order_item:{purchase_order:{status:'ordered'}}}
});
const direct=[allocation('allocation-a','container-a',100,2),allocation('allocation-b','container-b',80,1),
  allocation('allocation-c','container-a',20,1,'cajas','product-boxes','Cajas ejemplo')];
const effective=[{id:'allocation-a',allocated_sales_quantity:90,allocated_sales_pallets:1.5}];
const projected=cargoModule.shipmentCargoMap([],direct,effective);
assert.deepEqual(projected.get('container-a').totals,[{unit:'unidades',quantity:90},{unit:'cajas',quantity:20}]);
assert.equal(projected.get('container-a').pallets,2.5);
assert.equal(projected.get('container-b').items[0].quantity,80,'other containers do not inherit the entire sale');
assert.equal(projected.get('container-a').sales_orders.length,1);
assert.equal(cargoModule.shipmentCargoMap([], [{...direct[0],procurement:{...direct[0].procurement,purchase_order_item:{purchase_order:{status:'cancelled'}}}}]).size,0);
const load={shipment_id:'container-warehouse',status:'loaded',items:[{product_id:'product-example',product:{name:'Mercancía almacén'},unit:'unidades',planned_quantity:40,planned_pallets:3}]};
assert.equal(cargoModule.shipmentCargoMap([load]).get('container-warehouse').items[0].pallets,3);
assert.equal(cargoModule.shipmentCargoMap([{...load,status:'cancelled'}]).size,0);
assert.doesNotMatch(cargoModule.SHIPMENT_DIRECT_CARGO_SELECT,/unit_price|cost|balance|total_amount/);

async function apiRequest(method,body={},options={}){
  const calls=[],permissions=[];
  const shipment={id:'container-a',client_id:'client-example',importer_id:'importer-example',container_number:'EXAMPLE-001',
    product:'Old manual description',quantity:null,quantity_unit:null,active:true,booking_number:'BOOK-EXAMPLE',
    clients:{id:'client-example',name:'Contacto ejemplo',company:'Empresa ejemplo'},importer:{id:'importer-example',name:'Importadora ejemplo'}};
  const deps={
    './_lib.js':{...lib,authorizeAdmin:async(_req,res,permission)=>{
      permissions.push(permission);
      if(options.denied){lib.fail(res,403,'No tienes permiso para realizar esta acción');return null;}
      return {username:'example',permissions:['logistics.read','logistics.write']};
    },supabase:async(table,params={})=>{
      calls.push({table,...params});
      if(params.method==='POST'&&table==='shipment_history'&&params.body[0]?.event_type==='note'&&options.failNote)throw Error('SUPABASE_503:isolated');
      if(params.method==='PATCH'&&table==='shipments')return [{...shipment,...params.body}];
      if(params.method)return [];
      if(table==='shipments')return [shipment];
      if(table==='loads')return options.warehouse?[{id:'load-example',...load,shipment_id:shipment.id}]:[];
      if(table==='direct_shipment_allocations')return options.unlinked?[]:direct;
      if(table==='direct_shipment_effective_allocations')return effective;
      return [];
    },sendWhatsApp:async()=>{throw Error('Notifications prohibited');}},
    './_operation-lifecycle.js':{reconcileOperationLifecycle:async()=>{}},
    './_notification-delivery.js':{claimNotificationDelivery:async()=>{},releaseNotificationDelivery:async()=>{}},
    './_shipment-actions.js':{assertShipmentBusinessAction:async()=>{},loadShipmentActionCapabilities:async()=>({actions:{edit:{allowed:true}}}),
      loadShipmentActionCapabilityMap:async()=>({map:new Map(),write_access:true})},
    './_shipment-cargo.js':cargoModule
  };
  const pages=fs.readFileSync('api/_shipment-list-pages.js','utf8').replace(/^import \{([^}]+)\} from '([^']+)';$/gm,(_,names,path)=>`const {${names}}=deps[${JSON.stringify(path)}];`).replace('export async function','async function');
  deps['./_shipment-list-pages.js']=new Function('deps',pages+'\nreturn {readShipmentListPages};')(deps);
  const source=fs.readFileSync('api/shipments.js','utf8').replace(/^import \{([^}]+)\} from '([^']+)';$/gm,(_,names,path)=>`const {${names}}=deps[${JSON.stringify(path)}];`).replace('export default async function handler','async function handler');
  const handler=new Function('deps','console',source+'\nreturn handler;')(deps,{error(){},info(){}});
  const res={setHeader(){},end(text){this.body=JSON.parse(text);}};
  await handler({method,body,headers:{},query:{}},res);
  return {res,calls,permissions};
}
const read=await apiRequest('GET');
assert.equal(read.res.statusCode,200);
assert.deepEqual(read.permissions,['logistics.read'],'operative importer needs no client-directory permission');
assert.equal(read.res.body.shipments[0].importer.name,'Importadora ejemplo');
assert.equal(read.res.body.shipments[0].cargo.items[0].quantity,90);
assert.equal(read.calls.length,5,'fixed batch; no query per shipment');
for(const body of [{product:'Override'},{quantity:999},{client_id:null},{quantity_unit:'otro'}]){
  const r=await apiRequest('PATCH',{id:'container-a',...body});
  assert.equal(r.res.statusCode,400);
  assert.match(r.res.body.error,/se toman de la venta o cargue/);
  assert.equal(r.calls.some(call=>call.method),false);
}
const note=await apiRequest('PATCH',{id:'container-a',note:'Observación ejemplo'});
assert.equal(note.res.statusCode,200);
assert.deepEqual(Object.keys(note.calls.find(call=>call.table==='shipments'&&call.method==='PATCH').body),['updated_at']);
assert.equal(note.calls.find(call=>call.table==='shipment_history'&&call.body?.[0]?.event_type==='note').body[0].details,'Observación ejemplo');
assert.equal(note.calls.some(call=>['loads','direct_shipment_allocations'].includes(call.table)),false,'sparse metadata has no cargo guard query');
assert.equal((await apiRequest('PATCH',{id:'container-a',note:'x'.repeat(4001)})).res.statusCode,400);
assert.equal((await apiRequest('PATCH',{id:'container-a',note:'Observación ejemplo'},{failNote:true})).res.statusCode,500,'failed note must not report success');
assert.equal((await apiRequest('PATCH',{id:'container-a',product:'Manual permitido'},{unlinked:true})).res.statusCode,200);
assert.equal((await apiRequest('PATCH',{id:'container-a',quantity:999},{warehouse:true,unlinked:true})).res.statusCode,400);
assert.equal((await apiRequest('PATCH',{id:'container-a',client_id:'client-warehouse'},{warehouse:true,unlinked:true})).res.statusCode,200,'warehouse client assignment keeps its existing canonical rules');
const denied=await apiRequest('GET',{}, {denied:true});assert.equal(denied.calls.length,0);

const fixture=logisticsFixture({module:'tracking'});
const errors=[];
const dom=new JSDOM(fixture,{url:'https://isolated.example/admin/index.html',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(window){
  window.console={...console,error(...args){errors.push(args.join(' '));}};
}});
const window=dom.window;
await new Promise(resolve=>setTimeout(resolve,20));
const row=window.shipments[0];
row.cargo=projected.get('container-a');
row.fulfillment={mode:'direct',status:'planned'};
row.importer={id:'fixture-operative-importer',name:'Importadora operativa ejemplo'};
row.importer_id=row.importer.id;
window.importerState={importers:[],client_importers:[],shipment_importers:[]};
window.ContainersModule.render();
const visible=window.document.querySelector('[data-shipment-row]');
assert.match(visible.textContent,/Refresco <Ejemplo>/);
assert.match(visible.textContent,/90 unidades · 1.5 pallets/);
assert.match(visible.textContent,/20 cajas · 1 pallets/);
assert.match(visible.textContent,/Importadora operativa ejemplo/);
assert.equal(visible.querySelector('Ejemplo'),null,'cargo names are escaped');
const originalOpen=window.openModal;
window.openModal=(title,html)=>{originalOpen(title,html);};
await window.ShipmentEditor.open(row.id);
for(const id of ['editorClient','editorImporter','editorProduct','editorQuantity','editorQuantityUnit'])assert.equal(window.document.getElementById(id),null,'linked '+id+' is read-only');
assert.match(window.document.querySelector('.shipment-editor').textContent,/90 unidades · 1.5 pallets/);
const before=window.__fixtureCalls.length;
window.clients=[]; // Logistics operators need not load the client directory.
window.document.getElementById('editorNote').value='Nota aislada ejemplo';
await window.document.getElementById('shipmentEditorSave').onclick();
const saved=window.__fixtureCalls.slice(before);
assert.equal(saved.length,1);
assert.equal(saved[0].path,'/api/shipments');
assert.deepEqual(JSON.parse(JSON.stringify(saved[0].body)),{id:row.id,note:'Nota aislada ejemplo'});
assert.equal(window.shipments[0].client_id,row.client_id);
assert.equal(window.shipments[0].clients.name,row.clients.name);
assert.equal(window.shipments[0].importer_id,row.importer_id);
assert.equal(window.shipments[0].cargo.items[0].quantity,90);
await window.ShipmentEditor.open(row.id);
window.document.getElementById('editorBooking').value='BOOK-UPDATED';
await window.document.getElementById('shipmentEditorSave').onclick();
assert.deepEqual(JSON.parse(JSON.stringify(window.__fixtureCalls.at(-1).body)),{id:row.id,booking_number:'BOOK-UPDATED'});
assert.equal(window.__fixtureCalls.some(call=>call.path==='/api/importers'&&call.method==='PATCH'),false);
window.shipments[0].fulfillment={mode:'warehouse',status:'loaded'};
window.shipments[0].cargo={...window.shipments[0].cargo,mode:'warehouse'};
await window.ShipmentEditor.open(row.id);
assert.ok(window.document.getElementById('editorClient'),'warehouse client assignment is retained');
assert.ok(window.document.getElementById('editorImporter'),'warehouse operative importer remains independent');
assert.equal(window.document.getElementById('editorProduct'),null,'warehouse cargo stays derived from the load');
window.document.getElementById('shipmentEditorCancel').onclick();
assert.deepEqual(errors,[]);
dom.window.close();
console.log('Shipment cargo regression passed: exact allocations, split containers, effective corrections, mixed units, operational importer, protected edits, sparse notes and native UI.');
