import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {salesFixture} from './lib/figma-sales-fixture.mjs';
import {costsFixture} from './lib/figma-costs-fixture.mjs';
import {financeFixture} from './lib/figma-finance-fixture.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
function mount(html){const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(html,{url:'https://erp-visual.invalid',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});return{dom,w:dom.window,d:dom.window.document,errors};}
const sale=mount(salesFixture({workspace:true}));await tick();
const {w,d}=sale;
const item={id:'qa-item',product_id:'qa-product',product:{name:'Cajas de prueba'},ordered_quantity:2730,ordered_pallets:21,unit:'cajas',supply_plans:[{id:'qa-plan',supply_method:'purchase_direct',planned_quantity:2730,planned_pallets:21,notes:'PO12567',procurement_allocations:[]}],supply_progress:{unplanned_quantity:0}};
const supply={order:{id:'qa-sale',so_number:'SO-QA',currency:'USD',status:'confirmed'},items:[item],purchase_options:[],warehouses:[]};
const base=w.fetch,writes=[];let reject=false;
w.fetch=async(path,options={})=>{
  if(String(path).startsWith('/api/sales-supply'))return{ok:true,status:200,json:async()=>supply};
  if(String(path).startsWith('/api/direct-shipment-dispatch'))return{ok:true,status:200,json:async()=>({rows:[]})};
  if(String(path).startsWith('/api/sales-direct-operation')){
    if(options.method==='POST'){writes.push(JSON.parse(options.body));return{ok:!reject,status:reject?503:200,json:async()=>reject?{error:'Private diagnostic'}:{operation:{purchase_order_id:'qa-po'}}};}
    return{ok:true,status:200,json:async()=>({suppliers:[{id:'qa-supplier',name:'Proveedor QA'}],write_access:true,finance_write:true,logistics_write:true})};
  }
  return base(path,options);
};
w.eval(fs.readFileSync('admin/sales-supply-workspace.js','utf8'));
await w.SalesSupplyWorkspace.open('qa-sale');
assert.match(d.getElementById('salesSupplyBody').textContent,/Falta registrar la compra/);
assert.equal(d.querySelector('[data-supply-action="link-direct"]'),null);
await w.SalesSupplyWorkspace.openOperation();
assert.equal(d.getElementById('directSupplierReference').value,'PO12567');
assert.match(d.getElementById('salesSupplyFormBody').textContent,/2,730 cajas · 21 pallets/);
assert.equal(d.querySelector('[data-direct-qty],[data-direct-pallets]'),null);
d.getElementById('salesSupplyFormSave').click();await tick();
assert.equal(writes.length,0,'Missing supplier and costs must not send a write');
d.getElementById('directSupplier').value='qa-supplier';
d.querySelector('[data-direct-cost]').value='13000.01';
d.getElementById('supplyNewContainer').value='QA1234567';
reject=true;d.getElementById('salesSupplyFormSave').click();await tick();
assert.doesNotMatch(d.getElementById('salesSupplyFormMsg').textContent,/Private diagnostic/);
reject=false;d.getElementById('salesSupplyFormSave').click();await tick();
assert.equal(writes.length,2);assert.equal(writes[0].request_id,writes[1].request_id,'Ambiguous retries must use the same intent');
assert.equal(writes[1].lines[0].total,'13000.01');
assert.equal(writes[1].supplier_reference,'PO12567');assert.equal(writes[1].container_number,'QA1234567');
assert.equal(d.getElementById('salesSupplyFormModal').classList.contains('hidden'),true);
assert.deepEqual(sale.errors,[]);sale.dom.window.close();

const cost=(id,allocations)=>({id,cost_number:id,status:'posted',category:'ocean_freight',currency:'USD',amount:allocations.reduce((s,a)=>s+a.amount,0),allocations,capabilities:{actions:{}}});
const costs=mount(costsFixture({orderData:{
  charges:[cost('FLETE-A',[{sales_order_id:'sale-a',amount:4300}]),cost('BROKER-A',[{sales_order_id:'sale-a',amount:300}]),cost('COMPARTIDO',[{sales_order_id:'sale-a',amount:100},{sales_order_id:'sale-b',amount:200}])],
  targets:{sales_orders:[{id:'sale-a',so_number:'SO-A',currency:'USD',status:'confirmed'},{id:'sale-b',so_number:'SO-B',currency:'USD',status:'confirmed'}]},
  order_summaries:[{sales_order_id:'sale-a',order_total:18994,client_name:'Cliente A'},{sales_order_id:'sale-b',order_total:2000,client_name:'Cliente B'}],
  order_operations:[{sales_order_id:'sale-a',direct_required_quantity:2730,direct_pending_purchase_quantity:0,non_direct_quantity:0,direct_purchase_currency_count:1,direct_purchase_currency:'USD',direct_purchase_amount:13000.01,purchase_orders:[],containers:[]}]
}}));await tick();
const a=costs.d.querySelector('[data-cost-order="sale-a"]'),b=costs.d.querySelector('[data-cost-order="sale-b"]');
assert.ok(a&&b);assert.match(a.textContent,/4,700.00/);assert.match(a.textContent,/1,293.99/);
assert.match(b.textContent,/200.00/);assert.doesNotMatch(b.textContent,/FLETE-A|BROKER-A|4,700.00/);
assert.equal(a.querySelectorAll('.cost-record').length,3);assert.equal(b.querySelectorAll('.cost-record').length,1);
costs.d.querySelector('[data-order-cost="sale-a"]').click();
assert.equal(costs.d.querySelector('[data-target-type]').value,'sales_order_id');
assert.equal(costs.d.querySelector('[data-target-id]').value,'sale-a');
assert.deepEqual(costs.errors,[]);costs.dom.window.close();

const ap=mount(financeFixture({module:'payables'}));await tick();
assert.match(ap.d.getElementById('pendingPurchases').textContent,/Compras por facturar/);
ap.d.querySelector('[data-pending-purchase]').click();
assert.equal(ap.d.getElementById('bPO').value,'fixture-po');
assert.equal(ap.d.getElementById('billModal').classList.contains('hidden'),false);
assert.deepEqual(ap.errors,[]);ap.dom.window.close();
console.log('Direct operation UI: clear missing purchase, inherited quantities, PO reference, single transaction, safe retries, separate order expenses, correct split amounts and purchase-to-bill shortcut passed.');
