import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createFinanceAcceptanceDb} from './lib/finance-acceptance-db.mjs';
import {financeFixture} from './lib/finance-acceptance-fixture.mjs';
import {financeAcceptanceApi} from './lib/finance-acceptance-api.mjs';
const db=await createFinanceAcceptanceDb(),f=await financeFixture(db),api=financeAcceptanceApi(db);
const admin={admin_id:f.actor,role:'master_admin',permissions:[]},reader={admin_id:f.clientB,role:'admin',permissions:['finance.read','reports.read']};
let passed=0,failed=0;
const send=(body,who=admin)=>api.request('invoices',{method:'POST',body,admin:who});
const good=res=>{assert.equal(res.status,200,JSON.stringify(res.body));return res.body;};
const reject=(res,code)=>{assert.equal(res.status,400,JSON.stringify(res.body));assert.equal(res.body.details.code,code);};
async function test(name,run){await db.exec('begin');try{await run();passed++;console.log(`PASS ${name}`);}catch(e){failed++;console.error(`FAIL ${name}: ${e.stack}`);}finally{await db.exec('rollback');}}
const cashNet=report=>report.rows.reduce((n,r)=>n+Number(r.amount)*(r.direction==='in'?1:-1),0);
const movementBody=async(source,{kind='application',target,amount=60,expected,reason='QA customer credit',...rest}={})=>({action:'credit_settlement',movement_type:kind,invoice_id:source.id,target_invoice_id:target?.id,amount:String(amount),expected_available:expected??String((await f.financial(source)).customer_credit_balance),reason,effective_date:'2026-09-01',method:'wire',reference:'QA credit refund',request_id:randomUUID(),...rest});
const reverseBody=m=>({action:'credit_settlement',movement_type:'reversal',movement_id:m.id,reason:'QA correction of entry',request_id:randomUUID(),effective_date:'2026-09-01'});
const credit=async(inv,quantity=25)=>good(await send({action:'credit_quantity',invoice_id:inv.id,request_id:randomUUID(),reason:'QA quantity correction',lines:[{invoice_item_id:(await f.one('select id from invoice_items where invoice_id=$1',[inv.id])).id,quantity,expected_credited_quantity:'0'}]}));
async function scenario(){const sale=await f.sale(),source=await f.invoice(sale),payment=await f.payment(source,400);await credit(source);const target=await f.invoice(await f.sale());return {sale,source,target,payment};}
async function refuses(sql,params,code){await db.exec('savepoint expected_failure');try{await assert.rejects(f.one(sql,params),new RegExp(code));}finally{await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');}}
try{
 await test('CS-01 apply across sales of same customer/currency without another cash event',async()=>{
  const {source,target}=await scenario(),cash=await f.report('cash');const res=good(await send(await movementBody(source,{target})));
  const a=await f.financial(source),b=await f.financial(target);assert.deepEqual([a.total,a.paid_amount,a.customer_credit_balance,a.credit_transferred_amount,b.paid_amount,b.balance_due].map(Number),[300,340,40,60,60,340]);
  assert.equal(res.invoice.credit_movements.length,1);assert.deepEqual(await f.report('cash'),cash);assert.equal(Number(a.cash_payment_amount),400);
  const report=(await f.report('invoices')).rows;assert.equal(report.reduce((n,r)=>n+Number(r.paid_amount),0),400);
 });
 await test('CS-02 refund updates source, cash, sales finance, dashboard and CSV once',async()=>{
  const {sale,source,target}=await scenario();good(await send(await movementBody(source,{target})));const body=await movementBody(source,{kind:'refund',amount:40});const a=good(await send(body)),b=good(await send(body));assert.equal(a.movement.id,b.movement.id);
  const p=await f.financial(source);assert.deepEqual([p.paid_amount,p.customer_credit_balance,p.credit_refunded_amount].map(Number),[300,0,40]);
  const report=await f.report('cash');assert.equal(report.rows.filter(r=>r.event_type==='invoice_credit_refund').length,1);assert.equal(cashNet(report),360);
  const rollup=(await f.dashboard()).activity_by_currency[0];assert.deepEqual([rollup.cash_collected,rollup.cash_paid,rollup.net_cash_flow,rollup.invoice_credit_refund_count].map(Number),[400,40,360,1]);
  assert.equal(Number((await f.one('select cash_received_net from sales_order_customer_financial_progress where sales_order_id=$1',[sale.id])).cash_received_net),360);
  const csv=await api.request('reports',{admin,query:{dataset:'cash',format:'csv'}});assert.equal(csv.status,200);assert.match(csv.body,/invoice_credit_refund/);
 });
 await test('CS-03 reversing uses restores balances and keeps original history',async()=>{
  const {source,target}=await scenario();const application=good(await send(await movementBody(source,{target}))).movement,refund=good(await send(await movementBody(source,{kind:'refund',amount:40}))).movement;
  good(await send(reverseBody(refund)));assert.equal(Number((await f.financial(source)).customer_credit_balance),40);assert.equal(cashNet(await f.report('cash')),400);
  const reverse=reverseBody(application),a=good(await send(reverse)),b=good(await send(reverse));assert.equal(a.movement.id,b.movement.id);
  assert.equal(Number((await f.financial(source)).customer_credit_balance),100);assert.equal(Number((await f.financial(target)).balance_due),400);
  assert.equal((await f.rows('select id from invoice_credit_movements')).length,4);assert.equal((await f.rows("select * from invoice_credit_movement_state where status='reversed'")).length,2);
  reject(await send(reverseBody(application)),'INVOICE_CREDIT_MOVEMENT_REVERSED');
 });
 await test('CS-04 other customers, currencies, draft, void and same invoice are rejected',async()=>{
  const {source}=await scenario();const foreign=await f.invoice(await f.sale({clientId:f.clientB})),eur=await f.invoice(await f.sale({currency:'EUR'})),draft=await f.invoice(await f.sale(),{issued:false}),voided=await f.invoice(await f.sale());await f.one("select * from transition_invoice($1,'void')",[voided.id]);
  for(const target of [foreign,eur,draft,voided,source])reject(await send(await movementBody(source,{target})),'INVOICE_CREDIT_TARGET_INVALID');assert.equal((await f.rows('select * from invoice_credit_movements')).length,0);
 });
 await test('CS-05 source availability and recipient debt limit every use',async()=>{
  const {source}=await scenario(),target=await f.invoice(await f.sale(),{quantity:10});reject(await send(await movementBody(source,{target,amount:101})),'INVOICE_CREDIT_EXCEEDS_AVAILABLE');
  reject(await send(await movementBody(source,{target,amount:41})),'INVOICE_CREDIT_EXCEEDS_TARGET');good(await send(await movementBody(source,{target,amount:40})));
  reject(await send(await movementBody(source,{target,amount:1})),'INVOICE_CREDIT_EXCEEDS_TARGET');assert.equal(Number((await f.financial(source)).customer_credit_balance),60);
 });
 await test('CS-06 stale operator and reused request cannot duplicate or change intent',async()=>{
  const {source,target}=await scenario(),a=await movementBody(source,{target}),stale=await movementBody(source,{kind:'refund',amount:60});const x=good(await send(a)),y=good(await send(a));assert.equal(x.movement.id,y.movement.id);
  reject(await send(stale),'INVOICE_CREDIT_BALANCE_STALE');reject(await send({...a,amount:'20'}),'INVOICE_CREDIT_REQUEST_CONFLICT');assert.equal((await f.rows('select id from invoice_credit_movements')).length,1);
 });
 await test('CS-07 money, dates, reasons and refund methods reject invalid input',async()=>{
  const {source}=await scenario(),body=await movementBody(source,{kind:'refund'});
  for(const amount of ['0','-1','NaN','Infinity','0.001','abc'])reject(await send({...body,amount}),'INVOICE_CREDIT_AMOUNT_INVALID');
  for(const effective_date of ['no-date','2026-02-30','2100-01-01'])reject(await send({...body,effective_date}),'INVOICE_CREDIT_DATE_INVALID');
  reject(await send({...body,reason:'a'}),'INVOICE_CREDIT_REASON_REQUIRED');reject(await send({...body,method:''}),'INVOICE_CREDIT_METHOD_REQUIRED');
  assert.equal((await f.rows('select id from invoice_credit_movements')).length,0);
 });
 await test('CS-08 used credit blocks original payment reversal; reversing uses unlocks it',async()=>{
  const {source,target,payment}=await scenario(),m=good(await send(await movementBody(source,{target}))).movement;
  const reversal=()=>api.request('invoice-payments',{method:'POST',admin,body:{action:'reverse',payment_id:payment.id,reason:'QA entered in error'}});
  reject(await reversal(),'INVOICE_CREDIT_BALANCE_USED');let read=good(await api.request('invoices',{admin,query:{id:source.id}}));assert.equal(read.invoice.payments[0].capabilities.actions.reverse.allowed,false);
  good(await send(reverseBody(m)));good(await reversal());assert.equal(Number((await f.financial(source)).balance_due),300);
 });
 await test('CS-09 advance funding cannot be removed after the excess was spent',async()=>{
  const sale=await f.sale(),source=await f.invoice(sale),advance=await f.advance(sale,400),app=await f.apply(advance,source,400);await credit(source);good(await send(await movementBody(source,{kind:'refund',amount:60})));
  const r=await api.request('customer-advances',{method:'POST',admin,body:{action:'reverse_application',application_id:app.id,reason:'QA correction'}});reject(r,'INVOICE_CREDIT_BALANCE_USED');
  assert.equal(Number((await f.financial(source)).credit_refunded_amount),60);
 });
 await test('CS-10 later uses of received credit must reverse before the incoming transfer',async()=>{
  const {source,target}=await scenario(),third=await f.invoice(await f.sale()),m=good(await send(await movementBody(source,{target,amount:100}))).movement;await credit(target,100);
  const onward=good(await send(await movementBody(target,{target:third,amount:100}))).movement;
  reject(await send(reverseBody(m)),'INVOICE_CREDIT_BALANCE_USED');good(await send(reverseBody(onward)));good(await send(reverseBody(m)));
  assert.equal(Number((await f.financial(source)).customer_credit_balance),100);assert.equal(Number((await f.financial(target)).paid_amount),0);assert.equal(Number((await f.financial(third)).balance_due),400);
 });
 await test('CS-11 incoming credit changes cash and advance overcollection guards',async()=>{
  const {source,target}=await scenario();good(await send(await movementBody(source,{target,amount:100})));
  await refuses('select * from register_invoice_payment($1,301)',[target.id],'PAYMENT_EXCEEDS_BALANCE');
  const sale={id:target.sales_order_id},a=await f.advance(sale,400);await refuses('select * from apply_customer_advance($1,$2,301)',[a.id,target.id],'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE');
  await f.payment(target,300);assert.equal(Number((await f.financial(target)).balance_due),0);
 });
 await test('CS-12 invoice cannot void active incoming credit; history is immutable',async()=>{
  const {source,target}=await scenario(),m=good(await send(await movementBody(source,{target}))).movement;
  reject(await send({action:'void',invoice_id:target.id}),'INVOICE_HAS_CREDIT_MOVEMENTS');
  await refuses('update invoice_credit_movements set amount=1 returning id',[],'INVOICE_CREDIT_IMMUTABLE');await refuses('delete from invoice_credit_movements returning id',[],'INVOICE_CREDIT_IMMUTABLE');
  good(await send(reverseBody(m)));good(await send({action:'void',invoice_id:target.id}));
 });
 await test('CS-13 read-only users see history without write actions; inactive actors fail',async()=>{
  const {source,target}=await scenario(),body=await movementBody(source,{target});assert.equal((await send(body,reader)).status,403);const m=good(await send(body)).movement;
  const read=good(await api.request('invoices',{admin:reader,query:{id:source.id}}));assert.equal(read.invoice.credit_movements[0].capabilities.actions.reverse.allowed,false);assert.equal(read.invoice.capabilities.actions.refund_credit.allowed,false);
  assert.equal((await send(reverseBody(m),reader)).status,403);await db.query('update admin_users set is_active=false where id=$1',[f.actor]);reject(await send(await movementBody(source,{kind:'refund',amount:40})),'INVOICE_CREDIT_ACTOR_INVALID');
 });
 await test('CS-14 cash date/customer/product filters include only posted refunds',async()=>{
  const {source}=await scenario();good(await send(await movementBody(source,{kind:'refund',amount:50})));const hit=await f.report('cash',{start_date:'2026-09-01',end_date:'2026-09-01',client_id:f.client,product_id:f.product});assert.equal(hit.row_count,1);assert.equal(hit.rows[0].event_type,'invoice_credit_refund');
  assert.equal((await f.report('cash',{client_id:f.clientB})).row_count,0);assert.equal((await f.report('cash',{product_id:f.productB})).row_count,0);assert.equal((await f.report('cash',{start_date:'2026-09-02',end_date:'2026-09-02'})).row_count,0);
 });
 await test('CS-15 append-only ledger and new RPC remain backend-only',async()=>{
  const signature='public.manage_invoice_credit(text,uuid,uuid,uuid,numeric,text,uuid,uuid,date,text,text,numeric)';
  for(const role of ['anon','authenticated']){assert.equal((await f.one('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,signature])).allowed,false);for(const table of ['invoice_credit_movements','invoice_active_credit_movements','invoice_credit_totals','invoice_credit_movement_state'])assert.equal((await f.one('select has_table_privilege($1,$2,\'SELECT\') as allowed',[role,table])).allowed,false);}
  for(const privilege of ['INSERT','UPDATE','DELETE'])assert.equal((await f.one('select has_table_privilege(\'service_role\',\'invoice_credit_movements\',$1) as allowed',[privilege])).allowed,false);
 });
 console.log(`Invoice credit settlement: ${passed}/${passed+failed}; isolated SQL/API, all scenarios rolled back.`);if(failed)process.exitCode=1;
}finally{await db.close();}
