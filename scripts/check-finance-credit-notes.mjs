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
const rejected=(res,code)=>{assert.equal(res.status,400,JSON.stringify(res.body));assert.equal(res.body.details.code,code);};
const payload=async(inv,quantity=10,prior=0)=>({action:'credit_quantity',invoice_id:inv.id,request_id:randomUUID(),reason:'QA delivered quantity correction',lines:[{invoice_item_id:(await f.one('select id from invoice_items where invoice_id=$1',[inv.id])).id,quantity,expected_credited_quantity:prior}]});
async function test(name,run){await db.exec('begin');try{await run();passed++;console.log(`PASS ${name}`);}catch(e){failed++;console.error(`FAIL ${name}: ${e.stack}`);}finally{await db.exec('rollback');}}
async function refuses(sql,params,code){await db.exec('savepoint expected_failure');try{await assert.rejects(f.one(sql,params),new RegExp(code));}finally{await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');}}
try{
 await test('CN-01 840 to 810 preserves original invoice, payment and cash, reconciles report',async()=>{
  const so=await f.sale({lines:[{...f.baseLine,ordered_quantity:840,ordered_pallets:84}]}),inv=await f.invoice(so);await f.payment(inv,1000);
  const original=await f.rows('select * from invoice_items where invoice_id=$1',[inv.id]),cash=await f.report('cash');
  const result=good(await send(await payload(inv,30))),p=result.invoice.financial;
  assert.equal(Number(result.credit_note.total),120);assert.match(result.credit_note.credit_number,/^NC-/);
  assert.deepEqual([p.original_total,p.credited_amount,p.total,p.paid_amount,p.balance_due,p.customer_credit_balance].map(Number),[3360,120,3240,1000,2240,0]);
  assert.deepEqual(await f.rows('select * from invoice_items where invoice_id=$1',[inv.id]),original);assert.deepEqual(await f.report('cash'),cash);
  const report=(await f.report('invoices')).rows[0];assert.deepEqual([report.original_total,report.credited_amount,report.invoice_total,report.balance_due].map(Number),[3360,120,3240,2240]);
  assert.equal(result.invoice.credit_notes.length,1);assert.equal(Number(result.invoice.items[0].credited_quantity),30);
 });
 await test('CN-02 retry is exactly once and request UUID cannot change intent',async()=>{
  const inv=await f.invoice(await f.sale()),body=await payload(inv);const a=good(await send(body)),b=good(await send(body));assert.equal(a.credit_note.id,b.credit_note.id);
  rejected(await send({...body,reason:'Different reason'}),'INVOICE_CREDIT_REQUEST_CONFLICT');assert.equal((await f.rows('select id from invoice_credit_notes')).length,1);
 });
 await test('CN-03 stale operator cannot apply a second discount',async()=>{
  const inv=await f.invoice(await f.sale()),a=await payload(inv),b=await payload(inv);good(await send(a));rejected(await send(b),'INVOICE_CREDIT_STALE');assert.equal(Number((await f.financial(inv)).credited_amount),40);
 });
 await test('CN-04 foreign line makes the entire request atomic',async()=>{
  const inv=await f.invoice(await f.sale()),other=await f.invoice(await f.sale()),body=await payload(inv);body.lines.push((await payload(other)).lines[0]);
  rejected(await send(body),'INVOICE_CREDIT_LINES_INVALID');assert.equal((await f.rows('select id from invoice_credit_notes')).length,0);assert.equal(Number((await f.financial(inv)).total),400);
 });
 await test('CN-05 invalid quantities and duplicate lines do not write',async()=>{
  const inv=await f.invoice(await f.sale());for(const q of [0,-1,'NaN','Infinity','-Infinity','abc'])rejected(await send(await payload(inv,q)),'INVOICE_CREDIT_QUANTITY_INVALID');
  rejected(await send(await payload(inv,101)),'INVOICE_CREDIT_EXCEEDS_QUANTITY');const dup=await payload(inv);dup.lines.push(dup.lines[0]);rejected(await send(dup),'INVOICE_CREDIT_LINES_INVALID');
  const bad=await payload(inv);bad.lines[0].expected_credited_quantity=null;rejected(await send(bad),'INVOICE_CREDIT_LINES_INVALID');
  assert.equal((await f.rows('select id from invoice_credit_notes')).length,0);
 });
 await test('CN-06 draft/void invoices and inactive actors reject credit notes',async()=>{
  const inv=await f.invoice(await f.sale(),{issued:false});rejected(await send(await payload(inv)),'INVOICE_CREDIT_REQUIRES_ISSUED');
  await f.one("select * from transition_invoice($1,'void')",[inv.id]);rejected(await send(await payload(inv)),'INVOICE_CREDIT_REQUIRES_ISSUED');
  const issued=await f.invoice(await f.sale());await db.query('update admin_users set is_active=false where id=$1',[f.actor]);rejected(await send(await payload(issued)),'INVOICE_CREDIT_ACTOR_INVALID');
 });
 await test('CN-07 read-only actor sees notes but cannot issue or invoke credit capabilities',async()=>{
  const inv=await f.invoice(await f.sale()),body=await payload(inv);assert.equal((await send(body,reader)).status,403);good(await send(body));
  const read=good(await api.request('invoices',{admin:reader,query:{id:inv.id}}));assert.equal(read.invoice.credit_notes.length,1);assert.equal(read.invoice.capabilities.actions.credit.allowed,false);
 });
 await test('CN-08 further collection and advance application obey the reduced total',async()=>{
  const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,200);await f.payment(inv,100);good(await send(await payload(inv,50)));
  await refuses('select * from register_invoice_payment($1,101)',[inv.id],'PAYMENT_EXCEEDS_BALANCE');
  await refuses('select * from apply_customer_advance(p_customer_advance_id=>$1,p_invoice_id=>$2,p_amount=>101,p_actor=>$3)',[a.id,inv.id,f.actor],'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE');
  await f.apply(a,inv,100);assert.equal(Number((await f.financial(inv)).balance_due),0);
 });
 await test('CN-09 credit against a fully paid invoice records credit balance without refund',async()=>{
  const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,100);await f.apply(a,inv,100);const payment=await f.payment(inv,300),cash=await f.report('cash');
  good(await send(await payload(inv,10)));assert.equal(Number((await f.financial(inv)).customer_credit_balance),40);assert.deepEqual(await f.report('cash'),cash);
  await f.one("select * from reverse_invoice_payment($1,'QA reversal')",[payment.id]);const p=await f.financial(inv);assert.equal(Number(p.customer_credit_balance),0);assert.equal(Number(p.balance_due),260);
 });
 await test('CN-10 repeated fractional credits reconcile to displayed cents',async()=>{
  const so=await f.sale({lines:[{...f.baseLine,ordered_quantity:3,ordered_pallets:0.3,unit_price:0.333}]}),inv=await f.invoice(so);
  const amounts=[];for(let prior=0;prior<3;prior++)amounts.push(Number(good(await send(await payload(inv,1,prior))).credit_note.total));
  assert.deepEqual(amounts,[0.33,0.34,0.33]);const p=await f.financial(inv);assert.equal(Number(p.total),0);assert.equal(Number(p.credited_amount),1);assert.equal(p.payment_status,'paid');
 });
 await test('CN-11 original invoice and credit history remain immutable and cannot be voided',async()=>{
  const inv=await f.invoice(await f.sale());good(await send(await payload(inv)));
  await refuses('update invoice_items set quantity=90 where invoice_id=$1 returning id',[inv.id],'INVOICE_ITEMS_LOCKED');
  await refuses('update invoice_credit_notes set reason=$1 returning id',['Edited'],'INVOICE_CREDIT_IMMUTABLE');
  await refuses('delete from invoice_credit_note_lines returning id',[],'INVOICE_CREDIT_IMMUTABLE');
  rejected(await send({action:'void',invoice_id:inv.id}),'INVOICE_HAS_CREDITS');
 });
 await test('CN-12 net billed quantity frees capacity and still prevents overbilling',async()=>{
  const so=await f.sale(),inv=await f.invoice(so);good(await send(await payload(inv,10)));await f.invoice(so,{quantity:10,issued:false});
  await refuses('select * from create_invoice_plan($1,$2::jsonb)',[so.id,JSON.stringify([{sales_order_item_id:so.items[0].id,quantity:1}])],'INVOICE_QUANTITY_EXCEEDS_SALES_ORDER');
 });
 await test('CN-13 COGS and margin use net quantities, full credit has no residual cost',async()=>{
  const so=await f.sale(),po=await f.purchase();await f.fulfill(so,po);await f.bill(po);const inv=await f.invoice(so);good(await send(await payload(inv,10)));
  let report=(await f.report('invoices')).rows[0];assert.equal(Number(report.recognized_merchandise_cogs),225);assert.equal(Number(report.gross_margin),135);
  good(await send(await payload(inv,90,10)));report=(await f.report('invoices')).rows[0];assert.equal(Number(report.recognized_merchandise_cogs),0);assert.equal(Number(report.invoice_total),0);assert.equal(Number(report.gross_margin),0);
 });
 await test('CN-14 fully credited unfulfilled invoice has a known zero net value and cost',async()=>{
  const inv=await f.invoice(await f.sale());good(await send(await payload(inv,100)));const r=(await f.report('invoices')).rows[0];assert.equal(r.recognized_merchandise_cogs,0);assert.equal(r.gross_margin,0);
 });
 await test('CN-15 notes and RPC preserve the backend-only boundary',async()=>{
  const signature='public.create_invoice_quantity_credit(uuid,uuid,jsonb,text,uuid)';
  for(const role of ['anon','authenticated']){
   assert.equal((await f.one('select has_function_privilege($1,$2,\'EXECUTE\') as allowed',[role,signature])).allowed,false);
   for(const table of ['invoice_credit_notes','invoice_credit_note_lines','invoice_net_items'])assert.equal((await f.one('select has_table_privilege($1,$2,\'SELECT\') as allowed',[role,table])).allowed,false);
  }
  assert.equal((await f.one('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') as allowed',[signature])).allowed,true);
  for(const table of ['invoice_credit_notes','invoice_credit_note_lines'])for(const privilege of ['INSERT','UPDATE','DELETE'])assert.equal((await f.one('select has_table_privilege(\'service_role\',$1,$2) as allowed',[table,privilege])).allowed,false);
 });
 await test('CN-16 fractional quantities keep the canonical decimal concurrency token',async()=>{
  const inv=await f.invoice(await f.sale());good(await send(await payload(inv,'0.1')));const second=good(await send(await payload(inv,'0.2','0.1')));
  assert.equal(Number(second.invoice.items[0].credited_quantity),0.3);
  good(await send(await payload(inv,'0.1',second.invoice.items[0].credited_quantity)));assert.equal(Number((await f.financial(inv)).credited_amount),1.6);
 });
 console.log(`Invoice credit notes: ${passed}/${passed+failed}; isolated SQL/API, all business scenarios rolled back.`);if(failed)process.exitCode=1;
}finally{await db.close();}
