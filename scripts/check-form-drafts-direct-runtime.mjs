import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM,VirtualConsole} from 'jsdom';
import {salesFixture} from './lib/figma-sales-fixture.mjs';
import {purchasesFixture} from './lib/figma-purchases-fixture.mjs';

const tick=()=>new Promise(resolve=>setTimeout(resolve,25));
const response=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function fixture(html){
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
  const dom=new JSDOM(html,{url:'https://erp-visual.invalid',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
  return {dom,w:dom.window,d:dom.window.document,errors};
}
const user=(w,id)=>w.localStorage.setItem('export_mca_user',JSON.stringify({id}));
const write=(w,node,value)=>{node.value=value;node.dispatchEvent(new w.Event(node.tagName==='SELECT'?'change':'input',{bubbles:true}));};
const records=w=>Object.keys(w.localStorage).filter(key=>key.startsWith('export_mca_form_draft_v1:'));

// Original UI owners; all requests are handled in memory. Nothing reaches production.
const sales=fixture(salesFixture({workspace:true}));
try{
  const {w,d}=sales;await tick();user(w,'operator-a');
  w.eval(fs.readFileSync('admin/form-drafts.js','utf8'));
  const original=w.fetch,writes=[];
  let fail=true;
  const item={id:'qa-item',product_id:'fixture-product',product:{name:'QA product'},unit:'cajas',ordered_quantity:100,ordered_pallets:10,supply_plans:[],supply_progress:{ordered_quantity:100,unplanned_quantity:100}};
  w.fetch=async(path,options={})=>{
    const url=new URL(path,'https://erp-visual.invalid');
    if(url.pathname==='/api/sales-direct-operation'){
      if(options.method==='POST'){
        writes.push(JSON.parse(options.body));
        return fail?response({error:'Temporary failure'},503):response({operation:{purchase_order_id:'qa-purchase'}});
      }
      return response({write_access:true,logistics_write:true,finance_write:true,suppliers:[{id:'qa-supplier',name:'QA Supplier'}]});
    }
    if(url.pathname==='/api/sales-supply')return response({order:{id:url.searchParams.get('sales_order_id'),so_number:'QA-SO',status:'draft',currency:'USD'},items:[item],warehouses:[],purchase_options:[],direct_shipment_options:[]});
    if(url.pathname==='/api/direct-shipment-dispatch')return response({rows:[]});
    return original(path,options);
  };
  w.eval(fs.readFileSync('admin/sales-supply-workspace.js','utf8'));
  const open=async id=>{await w.SalesSupplyWorkspace.openOperation(null,id);await tick();};
  const close=()=>d.querySelector('[data-supply-form-close]').click();
  await open('sale-a');
  assert.match(d.getElementById('directNewPurchase').textContent,/100 cajas.*10 pallets/);
  for(const [id,value] of Object.entries({directSupplier:'qa-supplier','direct-cost-qa-item':'240.75',directSupplierReference:'PO-123',supplyNewContainer:'QA-CONTAINER',supplyNewCarrier:'QA Carrier',supplyNewBooking:'BK-SAVED',supplyNewBol:'BL-SAVED',supplyNewDeparture:'2026-11-01',directSupplierInvoice:'SUP-123'}))write(w,d.getElementById(id),value);
  close();await open('sale-a');
  assert.equal(d.getElementById('direct-cost-qa-item').value,'240.75');
  assert.equal(d.getElementById('supplyNewBooking').value,'BK-SAVED');
  assert.equal(d.getElementById('directSupplierInvoice').value,'SUP-123');
  assert.equal(d.querySelector('#salesSupplyFormModal [data-form-draft-status]').dataset.formDraftStatus,'restored');
  assert.equal(writes.length,0,'Recovery must never submit an operation');
  close();await open('sale-b');assert.equal(d.getElementById('supplyNewBooking').value,'');
  close();user(w,'operator-b');await open('sale-a');assert.equal(d.getElementById('supplyNewBooking').value,'');
  close();user(w,'operator-a');await open('sale-a');
  d.getElementById('salesSupplyFormSave').click();await tick();
  assert.equal(writes.length,1);assert.equal(d.getElementById('direct-cost-qa-item').value,'240.75');
  const key=records(w)[0],record=w.localStorage.getItem(key);
  assert.equal(JSON.parse(record).data.request_id,writes[0].request_id,'Persist the request identity before sending');
  close();await open('sale-a');
  write(w,d.getElementById('direct-cost-qa-item'),'241');
  d.getElementById('salesSupplyFormSave').click();await tick();
  assert.equal(writes.length,1,'An uncertain operation cannot be retried with changed values');
  write(w,d.getElementById('direct-cost-qa-item'),'240.75');
  d.getElementById('salesSupplyFormSave').click();await tick();
  assert.deepEqual(writes[1],writes[0],'Reopening must preserve the idempotent retry payload');
  fail=false;d.getElementById('salesSupplyFormSave').click();await tick();await tick();
  assert.deepEqual(writes[2],writes[0]);assert.equal(records(w).length,0,'Clear only after server confirmation');
  await open('sale-a');assert.equal(d.getElementById('supplyNewBooking').value,'');close();
  // Simulate a fresh page by restoring the persisted record with a new controller.
  w.localStorage.setItem(key,record);await open('sale-a');
  assert.equal(d.getElementById('supplyNewBooking').value,'BK-SAVED');
  await w.ExportMcaDrafts.get(d.querySelector('#salesSupplyFormModal .dialog')).discard();
  assert.equal(d.getElementById('supplyNewBooking').value,'');
  assert.equal(records(w).length,0);
  assert.deepEqual(sales.errors,[]);
}finally{sales.dom.window.close();}

const purchases=fixture(purchasesFixture());
try{
  const {w,d}=purchases;await tick();
  const original=w.fetch,writes=[];let fail=true;
  w.fetch=async(path,options={})=>{
    if(String(path).startsWith('/api/purchase-direct-sale')){
      if(options.method==='POST'){writes.push(JSON.parse(options.body));return fail?response({error:'Temporary failure'},503):response({sale:{sales_order_id:'qa-sale',so_number:'QA-SO'}});}
      return response({clients:[{id:'qa-client',name:'QA Client'}],importers:[{id:'qa-importer',name:'QA Importer'}],client_importers:[{client_id:'qa-client',importer_id:'qa-importer'}]});
    }
    return original(path,options);
  };
  const button=d.querySelector('[data-direct-sale-order]');
  const open=async()=>{button.click();await tick();};
  const close=()=>d.querySelector('[data-close="directSale"]').click();
  await open();assert.match(d.getElementById('directSaleLines').textContent,/100 cajas.*10 pallets/);
  for(const [id,value] of Object.entries({dsClient:'qa-client',dsImporter:'qa-importer',dsReference:'CUSTOMER-REF',dsNationalization:'nationalized'}))write(w,d.getElementById(id),value);
  write(w,d.querySelector('.dsLineTotal'),'3000.99');close();
  await open();assert.equal(d.getElementById('dsClient').value,'qa-client');assert.equal(d.getElementById('dsImporter').value,'qa-importer');assert.equal(d.getElementById('dsNationalization').value,'nationalized');assert.equal(d.querySelector('.dsLineTotal').value,'3000.99');
  close();user(w,'another-operator');await open();assert.equal(d.getElementById('dsClient').value,'');assert.equal(d.querySelector('.dsLineTotal').value,'');
  close();user(w,'fixture-operator');await open();
  assert.equal(writes.length,0);d.getElementById('saveDirectSale').click();await tick();
  assert.equal(writes.length,1);assert.equal(d.querySelector('.dsLineTotal').value,'3000.99');
  close();await open();assert.equal(d.getElementById('dsReference').value,'CUSTOMER-REF');
  fail=false;d.getElementById('saveDirectSale').click();await tick();await tick();
  assert.equal(writes[1].line_totals[0].line_total,'3000.99');assert.equal(writes[1].importer_id,'qa-importer');
  assert.equal(records(w).length,0);await open();assert.equal(d.querySelector('.dsLineTotal').value,'');
  assert.deepEqual(purchases.errors,[]);
}finally{purchases.dom.window.close();}
console.log('Direct Ship draft recovery passed: close/reopen, user and operation isolation, dependent fields, discard, failed saves, safe retries and cleanup after confirmation.');
