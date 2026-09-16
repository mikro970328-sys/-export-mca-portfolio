import assert from 'node:assert/strict';
import {createFinanceAcceptanceDb} from './lib/finance-acceptance-db.mjs';
import {financeFixture} from './lib/finance-acceptance-fixture.mjs';
import {financeAcceptanceApi} from './lib/finance-acceptance-api.mjs';
const db=await createFinanceAcceptanceDb(),f=await financeFixture(db),api=financeAcceptanceApi(db);
const admin={admin_id:f.actor,role:'master_admin',permissions:[]},reader={admin_id:f.clientB,role:'admin',permissions:['finance.read','reports.read']};
let passed=0,failed=0,serial=0;
const send=(name,body,who=admin)=>api.request(name,{method:'POST',body,admin:who});
const good=r=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
const bad=r=>{assert.equal(r.status,400,JSON.stringify(r.body));assert.doesNotMatch(r.body.error,/No se pudo procesar|NaN|Infinity|constraint|syntax/i);};
const line=(po,values={})=>({purchase_order_item_id:po.items[0].id,billed_quantity:'3',unit_cost:'0.33333333',...values});
const billBody=(po,lines=[line(po)])=>({action:'create_plan',purchase_order_id:po.id,supplier_invoice_number:'QA-SUPPLIER-'+(++serial),lines});
const create=async(po,lines)=>good(await send('payables',billBody(po,lines))).bill;
const post=async b=>good(await send('payables',{action:'post',supplier_bill_id:b.id})).bill;
const register=async(po,amount)=>good(await send('supplier-payments',{action:'register',purchase_order_id:po.id,amount})).payment;
const distribute=async(p,applications)=>good(await send('supplier-payments',{action:'replace_applications',supplier_payment_id:p.id,applications})).payment;
const pay=async(b,amount)=>good(await send('supplier-payments',{action:'pay_bill',supplier_bill_id:b.id,amount})).payment;
const num=Number;
async function snapshot(){const state={};for(const t of ['supplier_bills','supplier_bill_items','supplier_payments','supplier_payment_applications'])state[t]=await f.rows('select * from '+t+' order by id');return state;}
async function test(name,run){await db.exec('begin');try{await run();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.stack);}finally{await db.exec('rollback');}}
async function refuses(sql,args,pattern){await db.exec('savepoint rejected');try{await assert.rejects(f.one(sql,args),pattern);}finally{await db.exec('rollback to savepoint rejected; release savepoint rejected');}}
try {
 await test('SF-01 both sides of a displayed cent settle without invisible debt or false overpayment',async()=>{
  for(const rate of ['0.33333333','0.33333334']){
   const po=await f.purchase(),b=await post(await create(po,[line(po,{unit_cost:rate})]));
   assert.equal(num(b.financial.bill_total),1);assert.equal(num(b.items[0].line_total),1);
   const p=await pay(b,'1.00');assert.equal(num(p.progress.unapplied_amount),0);
   const a=await f.ap(b);assert.equal(num(a.balance_due),0);assert.equal(a.payment_status,'paid');
   assert.equal((await f.one('select unit_cost::text from supplier_bill_items where supplier_bill_id=$1',[b.id])).unit_cost,rate);
  }
 });
 await test('SF-02 each decimal line rounds half up before totals and cost aggregation',async()=>{
  const po=await f.purchase({lines:[{...f.baseLine,ordered_quantity:3,ordered_pallets:3,units_per_pallet:1},{...f.baseLine,product_id:f.productB,ordered_quantity:1,ordered_pallets:1,units_per_pallet:1}]});
  const first=po.items.find(x=>x.product_id===f.product),second=po.items.find(x=>x.product_id===f.productB);
  const b=await post(await create(po,[{purchase_order_item_id:first.id,billed_quantity:'3',unit_cost:'0.145'},{purchase_order_item_id:second.id,billed_quantity:'1',unit_cost:'0.335'}]));
  assert.equal(num(b.financial.bill_total),0.78);assert.deepEqual(b.items.map(x=>num(x.line_total)).sort(),[0.34,0.44]);
  await pay(b,'0.78');assert.equal((await f.ap(b)).payment_status,'paid');
  const costs=await f.rows('select actual_billed_cost from purchase_order_item_merchandise_cost_basis where purchase_order_id=$1',[po.id]);
  assert.deepEqual(costs.map(x=>num(x.actual_billed_cost)).sort(),[0.34,0.44]);
 });
 await test('SF-03 exact entered total remains authoritative for non-terminating unit rates',async()=>{
  const po=await f.purchase(),b=await post(await create(po,[line(po,{line_total:'100.00',unit_cost:'999'})]));
  assert.equal(num(b.financial.bill_total),100);assert.equal(b.items[0].pricing_mode,'total');assert.equal(num(b.items[0].entered_line_total),100);
  await pay(b,'100');assert.equal(num((await f.ap(b)).balance_due),0);
 });
 await test('SF-04 API rejects malformed and nonfinite supplier lines without writes or success audits',async()=>{
  const po=await f.purchase(),before=await snapshot(),audits=api.audits.length;
  for(const field of ['billed_quantity','unit_cost','line_total']){
   for(const value of ['NaN','Infinity','-Infinity','bad','0x10','1e309',true,{},[1]]){
    const values={[field]:value};if(field==='unit_cost')values.line_total='';
    bad(await send('payables',billBody(po,[line(po,values)])));
   }
  }
  for(const value of [null,[],1])bad(await send('payables',billBody(po,[value])));
  assert.deepEqual(await snapshot(),before);assert.equal(api.audits.length,audits);
 });
 await test('SF-05 SQL rejects nonfinite bills, payments and distributions at the source',async()=>{
  const po=await f.purchase();
  for(const [field,code] of [['billed_quantity',/SUPPLIER_BILL_QUANTITY_INVALID/],['unit_cost',/SUPPLIER_BILL_COST_REQUIRED/],['line_total',/SUPPLIER_BILL_LINE_TOTAL_INVALID/]]){
   for(const value of ['NaN','Infinity','-Infinity']){
    await refuses('select * from create_supplier_bill_plan(p_purchase_order_id=>$1,p_lines=>$2::jsonb)',[po.id,JSON.stringify([line(po,{[field]:value})])],code);
   }
  }
  const b=await post(await create(po)),p=await register(po,'1');
  for(const value of ['NaN','Infinity','-Infinity']){
   await refuses('select * from register_supplier_payment($1,$2::numeric)',[po.id,value],/SUPPLIER_PAYMENT_AMOUNT_INVALID/);
   await refuses('select * from pay_supplier_bill_canonical($1,$2::numeric)',[b.id,value],/SUPPLIER_PAYMENT_AMOUNT_INVALID/);
   await refuses('select * from replace_supplier_payment_applications_canonical($1,$2::jsonb)',[p.id,JSON.stringify([{supplier_bill_id:b.id,amount:value}])],/SUPPLIER_PAYMENT_APPLICATION_AMOUNT_INVALID/);
  }
 });
 await test('SF-06 exact totals, paid amounts and allocations reject fractions smaller than a cent',async()=>{
  const po=await f.purchase();
  for(const value of ['0.001','1.00000000000000000001','1e-3']){
   bad(await send('payables',billBody(po,[line(po,{line_total:value})])));
   await refuses('select * from create_supplier_bill_plan(p_purchase_order_id=>$1,p_lines=>$2::jsonb)',[po.id,JSON.stringify([line(po,{line_total:value})])],/SUPPLIER_BILL_LINE_TOTAL_PRECISION/);
   bad(await send('supplier-payments',{action:'register',purchase_order_id:po.id,amount:value}));
  }
  const b=await post(await create(po)),p=await register(po,'1');
  bad(await send('supplier-payments',{action:'pay_bill',supplier_bill_id:b.id,amount:'0.001'}));
  bad(await send('supplier-payments',{action:'replace_applications',supplier_payment_id:p.id,applications:[{supplier_bill_id:b.id,amount:'0.001'}]}));
  await refuses('select * from register_supplier_payment($1,0.001)',[po.id],/SUPPLIER_PAYMENT_AMOUNT_PRECISION/);
  await refuses('select * from replace_supplier_payment_applications_canonical($1,$2::jsonb)',[p.id,JSON.stringify([{supplier_bill_id:b.id,amount:'0.001'}])],/SUPPLIER_PAYMENT_APPLICATION_AMOUNT_PRECISION/);
  const valid=await register(po,'1.2300e0');assert.equal(num(valid.amount),1.23);
 });
 await test('SF-07 replacing a draft with an invalid second line is atomic',async()=>{
  const po=await f.purchase(),b=await create(po),before=await snapshot(),audits=api.audits.length;
  bad(await send('payables',{...billBody(po,[line(po,{unit_cost:'0.4'}),line(po,{unit_cost:'NaN'})]),action:'replace_plan',supplier_bill_id:b.id}));
  await refuses('select * from replace_supplier_bill_plan_canonical($1,$2,$3::jsonb)',[b.id,po.id,JSON.stringify([line(po,{unit_cost:'0.4'}),line(po,{line_total:'NaN'})])],/SUPPLIER_BILL_LINE_TOTAL_INVALID/);
  assert.deepEqual(await snapshot(),before);assert.equal(api.audits.length,audits);
 });
 await test('SF-08 advance distributes and redistributes across partial bills without new cash',async()=>{
  const po=await f.purchase(),p=await register(po,'2'),a=await post(await create(po)),b=await post(await create(po));
  const cash=await f.report('cash');
  let allocated=await distribute(p,[{supplier_bill_id:a.id,amount:'0.75'},{supplier_bill_id:b.id,amount:'0.50'}]);
  assert.equal(num(allocated.progress.unapplied_amount),0.75);
  assert.deepEqual([num((await f.ap(a)).balance_due),num((await f.ap(b)).balance_due)],[0.25,0.5]);
  allocated=await distribute(p,[{supplier_bill_id:a.id,amount:'1'},{supplier_bill_id:b.id,amount:'1'}]);
  assert.equal(num(allocated.progress.unapplied_amount),0);assert.equal((await f.ap(a)).payment_status,'paid');assert.equal((await f.ap(b)).payment_status,'paid');
  await distribute(p,[]);assert.deepEqual([num((await f.ap(a)).balance_due),num((await f.ap(b)).balance_due)],[1,1]);assert.deepEqual(await f.report('cash'),cash);
 });
 await test('SF-09 wrong PO and over-allocation leave prior distribution intact',async()=>{
  const po=await f.purchase(),p=await register(po,'2'),a=await post(await create(po)),other=await post(await create(await f.purchase({currency:'EUR'})));
  await distribute(p,[{supplier_bill_id:a.id,amount:'0.50'}]);const before=await snapshot();
  for(const applications of [[{supplier_bill_id:a.id,amount:'0.25'},{supplier_bill_id:other.id,amount:'0.25'}],[{supplier_bill_id:a.id,amount:'1.01'}],[{supplier_bill_id:a.id,amount:'2.01'}]]){
   bad(await send('supplier-payments',{action:'replace_applications',supplier_payment_id:p.id,applications}));assert.deepEqual(await snapshot(),before);
  }
 });
 await test('SF-10 advance reversal preserves payment and allocation history while reopening AP',async()=>{
  const po=await f.purchase(),p=await register(po,'2'),a=await post(await create(po)),b=await post(await create(po));
  await distribute(p,[{supplier_bill_id:a.id,amount:'1'},{supplier_bill_id:b.id,amount:'1'}]);
  const apps=await f.rows('select * from supplier_payment_applications order by id');
  const reversed=good(await send('supplier-payments',{action:'reverse',supplier_payment_id:p.id,reason:'QA wrong bank entry; preserve history'})).payment;
  assert.equal(reversed.status,'reversed');assert.equal(num(reversed.progress.unapplied_amount),0);
  assert.deepEqual(await f.rows('select * from supplier_payment_applications order by id'),apps);assert.deepEqual([num((await f.ap(a)).balance_due),num((await f.ap(b)).balance_due)],[1,1]);
  assert.equal((await f.report('cash')).row_count,0);
 });
 await test('SF-11 supplier reports, CSV and dashboard reconcile rounded AP and cash',async()=>{
  const po=await f.purchase(),b=await post(await create(po));await pay(b,'0.60');
  const report=(await f.report('supplier_bills')).rows.find(x=>x.supplier_bill_id===b.id||x.bill_number===b.bill_number);
  assert.ok(report);assert.equal(num(report.bill_total),1);assert.equal(num(report.balance_due),0.4);
  const dashboard=await f.dashboard(),balances=dashboard.balances_by_currency.find(x=>x.currency==='USD');assert.equal(num(balances.ap_balance),0.4);
  const cash=await f.report('cash');assert.equal(cash.row_count,1);assert.equal(num(cash.rows[0].amount),0.6);
  const csv=await api.request('reports',{admin,query:{dataset:'supplier_bills',format:'csv'}});assert.equal(csv.status,200);assert.ok(csv.body.includes(b.bill_number));assert.doesNotMatch(csv.body,/NaN|Infinity|0\.400000/);
 });
 await test('SF-12 reader capabilities and mutation permission stay enforced',async()=>{
  const po=await f.purchase(),b=await post(await create(po)),p=await register(po,'1'),before=await snapshot();
  const bills=good(await api.request('payables',{admin:reader})).bills;
  assert.equal(bills.find(x=>x.id===b.id).capabilities.actions.pay.allowed,false);
  for(const [endpoint,body] of [['payables',billBody(po)],['supplier-payments',{action:'register',purchase_order_id:po.id,amount:'1'}],['supplier-payments',{action:'replace_applications',supplier_payment_id:p.id,applications:[]}]]){
   assert.equal((await send(endpoint,body,reader)).status,403);
  }
  assert.deepEqual(await snapshot(),before);
 });
 await test('SF-13 stored constraints and RPC boundaries block alternate financial write paths',async()=>{
  const constraints=await f.rows("select conname,convalidated from pg_constraint where conname in ('supplier_bill_items_finite_values','supplier_bill_items_exact_total_cents','supplier_payments_finite_cents','supplier_payment_applications_finite_cents')");
  assert.equal(constraints.length,4);assert.ok(constraints.every(x=>x.convalidated));
  for(const role of ['anon','authenticated','service_role']){
   for(const table of ['supplier_bill_items','supplier_payments','supplier_payment_applications']){
    const p=await f.one("select has_table_privilege($1,$2,'INSERT,UPDATE,DELETE') allowed",[role,table]);assert.equal(p.allowed,false);
   }
   assert.equal((await f.one("select has_function_privilege($1,'register_supplier_payment(uuid,numeric,date,text,text,text,uuid)','EXECUTE') allowed",[role])).allowed,role==='service_role');
  }
 });
 await test('SF-14 valid zero-cost quantities remain payable at zero without an artificial cent',async()=>{
  const po=await f.purchase(),b=await post(await create(po,[line(po,{unit_cost:'0.001'})]));
  assert.equal(num(b.financial.bill_total),0);assert.equal(b.financial.payment_status,'paid');assert.equal(b.capabilities.actions.pay.allowed,false);
  assert.equal(num(b.items[0].billed_quantity),3);
 });
 assert.equal(api.errors.length,0,'Expected input refusals must not become internal errors');
} finally {await db.close();}
console.log('Supplier finance variants: '+passed+'/14; isolated SQL/API, transactions rolled back.');
if(failed)process.exitCode=1;
