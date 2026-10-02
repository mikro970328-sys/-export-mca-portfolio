import fs from 'node:fs';
import assert from 'node:assert/strict';
import {JSDOM,VirtualConsole} from 'jsdom';
import {salesFixture} from './lib/figma-sales-fixture.mjs';
import {costsFixture} from './lib/figma-costs-fixture.mjs';
import {purchasesFixture} from './lib/figma-purchases-fixture.mjs';
import {financeFixture} from './lib/figma-finance-fixture.mjs';
const tick=()=>new Promise(resolve=>setTimeout(resolve,35));
function mount(html){const errors=[],vc=new VirtualConsole();vc.on('jsdomError',e=>errors.push(e.message));const dom=new JSDOM(html,{url:'https://erp-visual.invalid',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});return{dom,w:dom.window,d:dom.window.document,errors};}
const sale=mount(salesFixture({workspace:true}));await tick();
const {w,d}=sale;
const item={id:'qa-item',product_id:'qa-product',product:{name:'Cajas de prueba'},ordered_quantity:2730,ordered_pallets:21,unit:'cajas',supply_plans:[{id:'qa-plan',supply_method:'purchase_direct',planned_quantity:2730,planned_pallets:21,notes:'PO12567',procurement_allocations:[]}],supply_progress:{unplanned_quantity:0}};
const supply={order:{id:'qa-sale',so_number:'SO-QA',currency:'USD',status:'confirmed'},items:[item],purchase_options:[],warehouses:[]};
const base=w.fetch,writes=[];let reject=false,releaseDocuments=null,documentGate=null;
w.fetch=async(path,options={})=>{
  if(String(path).startsWith('/api/sales-supply'))return{ok:true,status:200,json:async()=>supply};
  if(String(path).startsWith('/api/direct-shipment-dispatch'))return{ok:true,status:200,json:async()=>({rows:[]})};
  if(String(path).startsWith('/api/shipment-document-readiness')){
    if(documentGate)await documentGate;
    return{ok:true,status:200,json:async()=>({readiness:[{shipment_id:'qa-shipment',documentation_required:true,document_status:'pending'}]})};
  }
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

// Exercise the real owners as the same order progresses, including an old
// purchase shortcut arriving after the container has already been linked.
const procurement={id:'qa-procurement',allocated_sales_quantity:2730,allocated_sales_pallets:21,allocated_purchase_quantity:2730,allocated_purchase_pallets:21,purchase_order:{id:'qa-po',po_number:'PO-QA',status:'confirmed',supplier:{name:'Proveedor QA'}},purchase_order_item:{id:'qa-po-item',purchase_order_id:'qa-po',unit:'cajas'},direct_shipments:[]};
item.supply_plans[0].procurement_allocations=[procurement];
await w.SalesSupplyWorkspace.open('qa-sale');
assert.match(d.getElementById('salesSupplyBody').textContent,/Compra registrada · falta contenedor/);
assert.equal(d.querySelector('[data-supply-action="direct-operation"]').textContent,'Poner número de contenedor');
assert.equal(d.querySelector('[data-supply-action="new-direct"]'),null,'The guided container step replaces the repeated line shortcut');
const direct={id:'qa-direct',shipment_id:'qa-shipment',allocated_sales_quantity:2730,allocated_sales_pallets:21,allocated_purchase_quantity:2730,allocated_purchase_pallets:21,shipment:{id:'qa-shipment',container_number:'QA1234567',active:true},dispatch:null};
procurement.direct_shipments=[{...direct,allocated_sales_quantity:1000,allocated_purchase_quantity:1000}];
await w.SalesSupplyWorkspace.open('qa-sale');
assert.match(d.getElementById('salesSupplyBody').textContent,/falta contenedor/,'One linked container must not hide another unassigned part of the purchase');
procurement.direct_shipments=[direct];
await w.SalesSupplyWorkspace.open('qa-sale');
assert.match(d.getElementById('salesSupplyBody').textContent,/listos · falta despacho/);
assert.equal(d.querySelector('[data-supply-action="direct-operation"]'),null,'An already linked purchase and container must not offer another purchase form');
assert.equal(d.querySelector('[data-supply-action="new-direct"]'),null);
await w.SalesSupplyWorkspace.openOperation();
assert.equal(d.getElementById('salesSupplyFormModal').classList.contains('hidden'),true,'A stale purchase shortcut must open the linked operation for review');
assert.equal(d.getElementById('salesSupplyModal').classList.contains('hidden'),false);
assert.equal(writes.length,2,'Reviewing a completed assignment must not write');
d.querySelector('[data-supply-close="main"]').click();

w.__fixtureWorkspace={...w.__fixtureWorkspace,items:[item],direct_operation:{direct_required_quantity:2730,direct_pending_purchase_quantity:0,non_direct_quantity:0,direct_purchase_currency_count:1,direct_purchase_currency:'USD',direct_purchase_amount:13000,purchase_orders:[procurement.purchase_order],containers:[direct.shipment]},summary:{...w.__fixtureWorkspace.summary,order_total:18994,fulfillment_status:'partial',attributed_sales_revenue:9497,recognized_merchandise_cogs:6500,cogs_currency:'USD',direct_cost_amount:4600,direct_cost_currency_count:1,direct_cost_currency:'USD',contribution_margin:-1603,merchandise_cost_coverage:'estimated'}};
await w.SalesWorkspace.open('qa-sale');
assert.equal(d.querySelector('.sales-workspace-next [data-ws-action="supply"]').textContent,'Contenedor y despacho');
assert.equal(d.querySelectorAll('#detailBody [data-ws-action="supply"]').length,1,'The same operation must not appear again in the order card');
const estimate=d.querySelector('#salesWorkspacePanel .sales-ws-money-table .total');
assert.match(estimate.textContent,/Ganancia estimada del pedido.*1,394.00/,'The full-order estimate must not borrow the partial assigned contribution');
const recognized=d.querySelector('#salesWorkspacePanel details');
assert.match(recognized.textContent,/Venta de mercancía asignada.*9,497.00/);
assert.match(recognized.textContent,/Costo de mercancía asignada.*6,500.00/);
assert.match(recognized.textContent,/Resultado de mercancía asignada.*-\$1,603.00/);
assert.match(recognized.textContent,/compra estimada/);
assert.doesNotMatch(d.getElementById('detailBody').textContent,/Ganancia reconocida|Costo despachado/,'Assigned allocations must not be described as a posted dispatch ledger');

for(let visit=0;visit<2;visit++)for(const tab of ['logistics','documents']){
  const oldButton=d.querySelector(`[data-ws-tab="${tab}"]`);
  oldButton.click();await tick();
  assert.equal(oldButton.isConnected,false,'The native owner must replace the clicked tab in this regression');
  const augmentation=d.querySelector('[data-direct-supply-augment]');
  assert.ok(augmentation,`${tab}: Direct Ship must survive the native tab replacement`);
  assert.match(augmentation.textContent,/QA1234567/);
  if(tab==='logistics'){
    assert.equal(d.querySelector('[data-direct-logistics-placeholder]'),null,'A linked container replaces the empty Direct Ship card');
    assert.equal(d.querySelectorAll('#detailBody [data-ws-action="supply"], #detailBody [data-supply-open-main]').length,1,'Logistics keeps one operation entry');
  }
  assert.equal(d.querySelectorAll('[data-direct-supply-augment]').length,1);
  await w.SalesWorkspace.reload({keepTab:true});
  assert.equal(d.querySelectorAll('[data-direct-supply-augment]').length,1,'Refreshing the active tab must restore exactly one Direct Ship block');
}
// Multi-product containers dispatch once, while corrections retain their line IDs.
const secondDirect={...direct,id:'qa-direct-second'};
const secondItem={...item,id:'qa-item-second',supply_plans:[{...item.supply_plans[0],id:'qa-plan-second',procurement_allocations:[{...procurement,id:'qa-procurement-second',direct_shipments:[secondDirect]}]}]};
supply.items=[item,secondItem];
await w.SalesSupplyWorkspace.open('qa-sale');
assert.equal(d.querySelectorAll('[data-supply-action="dispatch-direct"]').length,1);
assert.equal(d.querySelectorAll('[data-supply-action="open-tracking"]').length,1);
assert.equal(d.querySelectorAll('[data-supply-action="unlink-direct"]').length,2,'Line allocation changes must stay distinct');
secondDirect.dispatch={dispatched_at:'2026-10-01T14:00:00Z'};
direct.dispatch=secondDirect.dispatch;
await w.SalesSupplyWorkspace.open('qa-sale');
assert.equal(d.querySelectorAll('[data-supply-action="correct-direct"]').length,2,'Each product keeps its own physical correction');
direct.dispatch=null;supply.items=[item];
d.querySelector('[data-supply-close="main"]').click();

// When the native read model already contains this container, do not add it again.
w.__fixtureWorkspace.logistics=[{shipment_id:'qa-shipment',container_number:'QA1234567'}];
await w.SalesWorkspace.open('qa-sale');
d.querySelector('[data-ws-tab="documents"]').click();await tick();
assert.equal(d.querySelector('[data-direct-supply-augment]'),null,'Native documents already own the linked container');
assert.equal(d.querySelectorAll('[data-ws-action="open_tracking"][data-ws-id="qa-shipment"]').length,1);
w.__fixtureWorkspace.logistics=[];
await w.SalesWorkspace.reload();

documentGate=new Promise(resolve=>{releaseDocuments=resolve;});
d.querySelector('[data-ws-tab="documents"]').click();await tick();
d.querySelector('[data-ws-tab="summary"]').click();
releaseDocuments();await tick();documentGate=null;
assert.equal(d.querySelector('[data-direct-supply-augment]'),null,'A late document response must not be appended to the summary tab');

Object.assign(direct,{planned_sales_quantity:2730,planned_purchase_quantity:2730,allocated_sales_quantity:2700,allocated_purchase_quantity:2700,has_quantity_correction:true,dispatch:{dispatched_at:'2026-10-01T14:00:00Z'}});
await w.SalesSupplyWorkspace.open('qa-sale');
assert.match(d.getElementById('salesSupplyBody').textContent,/Despacho registrado · hay diferencias/);
assert.match(d.getElementById('salesSupplyBody').textContent,/Diferencia: 30/);
assert.equal(d.querySelector('[data-supply-action="new-direct"]'),null,'A corrected physical shortage must not reopen the original allocation for another container');
assert.equal(d.querySelector('[data-supply-action="direct-operation"]'),null);
assert.equal(d.querySelector('[data-supply-action="dispatch-direct"]'),null);
assert.equal(writes.length,2);

w.__fixtureWorkspace.summary.contribution_status='direct_cost_multi_currency';
w.__fixtureWorkspace.summary.direct_cost_currency_count=2;
w.__fixtureWorkspace.summary.direct_cost_currency=null;
w.__fixtureWorkspace.summary.contribution_margin=null;
await w.SalesWorkspace.open('qa-sale');
assert.match(d.querySelector('.sales-workspace-kpis').textContent,/Ganancia asignadaMonedas distintas/);
assert.match(d.querySelector('#salesWorkspacePanel .sales-ws-money-table .total').textContent,/Monedas distintas/);
w.__fixtureWorkspace.financial_access={read:false,write:false};
await w.SalesWorkspace.reload();
assert.doesNotMatch(d.getElementById('detailBody').textContent,/6,500.00|1,394.00|-\$1,603.00|13,000.00/,'The financial presentation must preserve the read permission boundary');
assert.deepEqual(sale.errors,[]);sale.dom.window.close();

const customerFinance=mount(salesFixture({workspace:true}));await tick();
const financeFetch=customerFinance.w.fetch;
customerFinance.w.fetch=async(path,options={})=>{
  if(String(path).startsWith('/api/customer-advances'))return{ok:true,status:200,json:async()=>({progress:{so_number:'SO-DEMO-0248',currency:'USD',sales_order_total:39916,advance_cash_received:0,advance_available_amount:0,cash_received_net:39916,issued_invoice_total:39916,invoice_balance_due:0},advances:[],invoices:[],sales_order_capabilities:{actions:{}}})};
  if(String(path).startsWith('/api/proformas'))return{ok:true,status:200,json:async()=>({proformas:[],sales_order_capabilities:{actions:{}}})};
  return financeFetch(path,options);
};
customerFinance.w.eval(fs.readFileSync('admin/sales-customer-finance.js','utf8'));
await customerFinance.w.SalesWorkspace.open('fixture-sale-0');await tick();
assert.equal(customerFinance.d.getElementById('openCustomerFinance').classList.contains('hidden'),true);
for(let visit=0;visit<2;visit++){
  customerFinance.d.querySelector('[data-ws-tab="billing"]').click();await tick();
  const options=customerFinance.d.querySelector('#salesFinanceInline details');
  assert.ok(options,'Additional finance options must survive the workspace replacing the clicked tab');
  assert.equal(options.open,false);
  options.open=true;
  customerFinance.d.querySelector('[data-cf-open-inline]').click();await tick();
  assert.equal(customerFinance.d.getElementById('salesFinanceModal').classList.contains('hidden'),false);
  assert.equal(customerFinance.d.querySelector('[data-cf-register]'),null,'A read-only finance operator must not get a write button');
  customerFinance.d.querySelector('[data-cf-close-main]').click();
  customerFinance.d.querySelector('[data-ws-tab="summary"]').click();await tick();
}
assert.deepEqual(customerFinance.errors,[]);customerFinance.dom.window.close();

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

const ap=mount(financeFixture({module:'payables'}));
assert.equal(ap.d.getElementById('newBill').disabled,true,'The supplier invoice action waits for its initial purchase and permission data');
await tick();
assert.equal(ap.d.getElementById('newBill').disabled,false,'A writable purchase enables the invoice action after loading');
assert.match(ap.d.getElementById('pendingPurchases').textContent,/Compras por facturar/);
ap.d.querySelector('[data-pending-purchase]').click();
assert.equal(ap.d.getElementById('bPO').value,'fixture-po');
assert.equal(ap.d.getElementById('billModal').classList.contains('hidden'),false);
assert.deepEqual(ap.errors,[]);ap.dom.window.close();
// A rapid issue → confirm sequence must wait for the refreshed canonical purchase.
const purchase=mount(purchasesFixture());await tick();
const pw=purchase.w,pd=purchase.d;
const seed=await (await pw.fetch('/api/purchases')).json();
const order=seed.orders.find(row=>row.status==='draft');
order.capabilities.actions.issue={allowed:true};
order.capabilities.actions.confirm={allowed:false};
let releasePurchaseRead,holdPurchaseRead=false;
const purchaseReadGate=new Promise(resolve=>{releasePurchaseRead=resolve;});
pw.fetch=async(path,options={})=>{
  if(options.method==='POST'){
    assert.equal(JSON.parse(options.body).action,'issue');
    order.status='issued';order.capabilities.actions.issue.allowed=false;order.capabilities.actions.confirm.allowed=true;
    holdPurchaseRead=true;
    return{ok:true,status:200,json:async()=>({order})};
  }
  if(holdPurchaseRead)await purchaseReadGate;
  return{ok:true,status:200,json:async()=>seed};
};
await pw.load();
pd.querySelector('[data-view="all"]').click();
pd.querySelector(`[data-view-order="${order.id}"]`).click();
pd.querySelector('[data-detail-action="issue"]').click();
pd.getElementById('purchaseDecisionAccept').click();await tick();
assert.equal(pd.getElementById('detailModal').classList.contains('hidden'),false,'The previous purchase must not be reopened before its canonical refresh');
releasePurchaseRead();await tick();
assert.equal(pd.getElementById('detailModal').classList.contains('hidden'),true);
pd.querySelector(`[data-view-order="${order.id}"]`).click();
assert.ok(pd.querySelector('[data-detail-action="confirm"]'),'The next action uses refreshed purchase capabilities');
assert.deepEqual(purchase.errors,[]);purchase.dom.window.close();

console.log('Direct operation UI: purchase/container/dispatch stages, stale shortcuts, physical corrections, native tab replacement, late document responses, partial assigned results, currency and finance guards, safe retries, grouped expenses and purchase-to-bill shortcut passed.');
