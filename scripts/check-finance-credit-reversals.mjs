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
const reversal=note=>({action:'reverse_credit_note',credit_note_id:note.id,request_id:randomUUID(),reason:'QA correction of quantity credit'});
const creditBody=async(inv,quantity=10,prior=0,itemId)=>({action:'credit_quantity',invoice_id:inv.id,request_id:randomUUID(),reason:'QA quantity credit',lines:[{invoice_item_id:itemId||(await f.one('select id from invoice_items where invoice_id=$1 order by id',[inv.id])).id,quantity:String(quantity),expected_credited_quantity:String(prior)}]});
const credit=async(...args)=>good(await send(await creditBody(...args))).credit_note;
const read=async(inv,who=admin)=>good(await api.request('invoices',{admin:who,query:{id:inv.id}})).invoice;
const use=async(inv,amount,target)=>good(await send({action:'credit_settlement',movement_type:target?'application':'refund',invoice_id:inv.id,target_invoice_id:target?.id,amount:String(amount),expected_available:String((await f.financial(inv)).customer_credit_balance),reason:'QA use of customer credit',request_id:randomUUID(),effective_date:'2026-09-01',method:'wire'})).movement;
const undoUse=async m=>good(await send({action:'credit_settlement',movement_type:'reversal',movement_id:m.id,request_id:randomUUID(),reason:'QA reverse downstream use',effective_date:'2026-09-01'}));
async function test(name,run){await db.exec('begin');try{await run();passed++;console.log('PASS '+name);}catch(e){failed++;console.error('FAIL '+name+': '+e.stack);}finally{await db.exec('rollback');}}
async function refuses(sql,params,code){await db.exec('savepoint expected_failure');try{await assert.rejects(f.one(sql,params),new RegExp(code));}finally{await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');}}
try{
 await test('CR-01 reversal restores AR, COGS and reports while preserving original invoice and cash',async()=>{
  const so=await f.sale(),po=await f.purchase();await f.fulfill(so,po);await f.bill(po);const inv=await f.invoice(so);await f.payment(inv,100);
  const lines=await f.rows('select * from invoice_items'),cash=await f.report('cash'),note=await credit(inv);
  const before=await f.rows('select * from invoice_credit_notes'),result=good(await send(reversal(note))),p=result.invoice.financial;
  assert.deepEqual([p.total,p.paid_amount,p.balance_due,p.credited_amount,p.customer_credit_balance].map(Number),[400,100,300,0,0]);
  assert.match(result.reversal.reversal_number,/^RC-/);assert.equal(result.invoice.credit_notes[0].status,'reversed');assert.equal(result.invoice.credit_notes[0].reversal_reason,'QA correction of quantity credit');
  assert.deepEqual(await f.rows('select * from invoice_items'),lines);assert.deepEqual(await f.rows('select * from invoice_credit_notes'),before);assert.deepEqual(await f.report('cash'),cash);
  const report=(await f.report('invoices')).rows[0];assert.deepEqual([report.invoice_total,report.recognized_merchandise_cogs,report.gross_margin,report.credited_amount].map(Number),[400,250,150,0]);
  const csv=await api.request('reports',{admin,query:{dataset:'invoices',format:'csv'}});assert.equal(csv.status,200);assert.match(csv.body,/INV-/);
 });
 await test('CR-02 retry is exact, conflicting requests fail and retrying original issuance does not reactivate',async()=>{
  const inv=await f.invoice(await f.sale()),body=await creditBody(inv),note=good(await send(body)).credit_note,undo=reversal(note);
  const a=good(await send(undo)),b=good(await send(undo));assert.equal(a.reversal.id,b.reversal.id);rejected(await send({...undo,reason:'Different intent'}),'INVOICE_CREDIT_REQUEST_CONFLICT');
  rejected(await send(reversal(note)),'INVOICE_CREDIT_NOTE_REVERSED');good(await send(body));assert.equal(Number((await f.financial(inv)).total),400);
  assert.equal((await f.rows('select id from invoice_credit_note_reversals')).length,1);assert.equal((await f.rows('select id from invoice_credit_notes')).length,1);
 });
 await test('CR-03 reader, inactive actor, invalid ID, request and reason cannot reverse',async()=>{
  const inv=await f.invoice(await f.sale()),note=await credit(inv),body=reversal(note);assert.equal((await send(body,reader)).status,403);
  const visible=await read(inv,reader);assert.equal(visible.credit_notes[0].capabilities.actions.reverse.allowed,false);
  rejected(await send({...body,credit_note_id:randomUUID()}),'INVOICE_CREDIT_NOTE_NOT_FOUND');rejected(await send({...body,credit_note_id:'bad'}),'INVOICE_CREDIT_NOTE_NOT_FOUND');
  rejected(await send({...body,request_id:'bad'}),'INVOICE_CREDIT_REQUEST_REQUIRED');for(const reason of ['x','x'.repeat(2001)])rejected(await send({...body,reason}),'INVOICE_CREDIT_REASON_REQUIRED');
  await db.query('update admin_users set is_active=false where id=$1',[f.actor]);rejected(await send(body),'INVOICE_CREDIT_ACTOR_INVALID');assert.equal((await f.rows('select id from invoice_credit_note_reversals')).length,0);
 });
 await test('CR-04 shared-line reverse order conserves every rounded cent',async()=>{
  const inv=await f.invoice(await f.sale({lines:[{...f.baseLine,ordered_quantity:3,ordered_pallets:0.3,unit_price:0.333}]}));
  const a=await credit(inv,1,0),b=await credit(inv,1,1),c=await credit(inv,1,2);
  rejected(await send(reversal(a)),'INVOICE_CREDIT_LATER_NOTE_ACTIVE');rejected(await send(reversal(b)),'INVOICE_CREDIT_LATER_NOTE_ACTIVE');
  for(const [note,net,quantity] of [[c,0.33,1],[b,0.67,2],[a,1,3]]){good(await send(reversal(note)));const row=await f.one('select * from invoice_net_items where invoice_id=$1',[inv.id]);assert.equal(Number(row.line_total),net);assert.equal(Number(row.quantity),quantity);}
  assert.equal(Number((await f.financial(inv)).credited_amount),0);
 });
 await test('CR-05 later notes on independent lines do not block each other',async()=>{
  const so=await f.sale({lines:[f.baseLine,{...f.baseLine,product_id:f.productB}]}),draft=await f.one('select * from create_invoice_plan($1,$2::jsonb)',[so.id,JSON.stringify(so.items.map(i=>({sales_order_item_id:i.id,quantity:100})))]);
  const inv=await f.one("select * from transition_invoice($1,'issue')",[draft.id]),items=await f.rows('select * from invoice_items where invoice_id=$1 order by id',[inv.id]);
  const a=await credit(inv,10,0,items[0].id),b=await credit(inv,20,0,items[1].id);good(await send(reversal(a)));
  assert.equal(Number((await f.financial(inv)).credited_amount),80);assert.equal((await read(inv)).credit_notes.find(n=>n.id===b.id).status,'posted');
 });
 await test('CR-06 multi-line reversal is atomic when a single line has a later note',async()=>{
  const so=await f.sale({lines:[f.baseLine,{...f.baseLine,product_id:f.productB}]}),draft=await f.one('select * from create_invoice_plan($1,$2::jsonb)',[so.id,JSON.stringify(so.items.map(i=>({sales_order_item_id:i.id,quantity:100})))]);
  const inv=await f.one("select * from transition_invoice($1,'issue')",[draft.id]),items=await f.rows('select * from invoice_items where invoice_id=$1 order by id',[inv.id]);
  const body=await creditBody(inv,10,0,items[0].id);body.lines.push((await creditBody(inv,10,0,items[1].id)).lines[0]);const a=good(await send(body)).credit_note,b=await credit(inv,5,10,items[1].id);
  rejected(await send(reversal(a)),'INVOICE_CREDIT_LATER_NOTE_ACTIVE');assert.equal((await f.rows('select id from invoice_credit_note_reversals')).length,0);assert.equal(Number((await f.financial(inv)).credited_amount),100);
  good(await send(reversal(b)));good(await send(reversal(a)));assert.equal(Number((await f.financial(inv)).total),800);
 });
 await test('CR-07 draft and issued rebilling reserve capacity until corrected or voided',async()=>{
  for(const issued of [false,true]){const so=await f.sale(),inv=await f.invoice(so),note=await credit(inv),other=await f.invoice(so,{quantity:10,issued});
   rejected(await send(reversal(note)),'INVOICE_CREDIT_QUANTITY_REUSED');assert.equal((await read(inv)).credit_notes[0].capabilities.actions.reverse.reason,'INVOICE_CREDIT_QUANTITY_REUSED');
   good(await send({action:'void',invoice_id:other.id}));good(await send(reversal(note)));assert.equal(Number((await f.financial(inv)).total),400);
   assert.equal(Number((await f.one('select allocated_invoice_quantity from sales_order_item_invoice_progress where sales_order_item_id=$1',[so.items[0].id])).allocated_invoice_quantity),100);
  }
 });
 await test('CR-08 refunded credit blocks reversal until the refund entry is reversed',async()=>{
  const inv=await f.invoice(await f.sale());await f.payment(inv,400);const note=await credit(inv,25),m=await use(inv,60),cash=await f.report('cash');
  rejected(await send(reversal(note)),'INVOICE_CREDIT_BALANCE_USED');assert.deepEqual(await f.report('cash'),cash);await undoUse(m);good(await send(reversal(note)));assert.equal(Number((await f.financial(inv)).balance_due),0);
 });
 await test('CR-09 transferred credit blocks reversal until the application is reversed',async()=>{
  const inv=await f.invoice(await f.sale()),target=await f.invoice(await f.sale());await f.payment(inv,400);const note=await credit(inv,25),m=await use(inv,100,target);
  rejected(await send(reversal(note)),'INVOICE_CREDIT_BALANCE_USED');assert.equal(Number((await f.financial(target)).paid_amount),100);await undoUse(m);good(await send(reversal(note)));assert.equal(Number((await f.financial(target)).balance_due),400);
 });
 await test('CR-10 sufficiently funded uses remain valid when reversing a later smaller note',async()=>{
  const inv=await f.invoice(await f.sale());await f.payment(inv,400);const a=await credit(inv,25),b=await credit(inv,10,25);await use(inv,50);const cash=await f.report('cash');
  good(await send(reversal(b)));const p=await f.financial(inv);assert.deepEqual([p.total,p.paid_amount,p.customer_credit_balance].map(Number),[300,350,50]);
  assert.deepEqual(await f.report('cash'),cash);rejected(await send(reversal(a)),'INVOICE_CREDIT_BALANCE_USED');
 });
 await test('CR-11 fully reversed notes allow ordinary void with no cash and preserve history',async()=>{
  const inv=await f.invoice(await f.sale()),note=await credit(inv);rejected(await send({action:'void',invoice_id:inv.id}),'INVOICE_HAS_CREDITS');good(await send(reversal(note)));
  assert.equal((await read(inv)).capabilities.actions.void.allowed,true);good(await send({action:'void',invoice_id:inv.id}));assert.equal((await read(inv)).credit_notes[0].status,'reversed');
 });
 await test('CR-12 zero-cent quantities and re-crediting use active canonical quantities',async()=>{
  const inv=await f.invoice(await f.sale({lines:[{...f.baseLine,ordered_quantity:3,ordered_pallets:0.3,unit_price:0.001}]})),note=await credit(inv,1);assert.equal(Number(note.total),0);good(await send(reversal(note)));
  rejected(await send(await creditBody(inv,1,1)),'INVOICE_CREDIT_STALE');const fresh=await credit(inv,1,0);assert.notEqual(fresh.id,note.id);assert.equal(Number((await read(inv)).items[0].credited_quantity),1);
 });
 await test('CR-13 append-only reversal table and views remain backend-only',async()=>{
  const inv=await f.invoice(await f.sale()),note=await credit(inv);good(await send(reversal(note)));
  for(const sql of ['update invoice_credit_note_reversals set reason=\'Edited\' returning id','delete from invoice_credit_note_reversals returning id'])await refuses(sql,[],'INVOICE_CREDIT_IMMUTABLE');
  const signature='public.reverse_invoice_quantity_credit(uuid,uuid,text,uuid)';
  for(const role of ['anon','authenticated']){assert.equal((await f.one('select has_function_privilege($1,$2,\'EXECUTE\') as ok',[role,signature])).ok,false);
   for(const table of ['invoice_credit_note_reversals','invoice_active_credit_notes','invoice_active_credit_note_lines','invoice_credit_note_state'])assert.equal((await f.one('select has_table_privilege($1,$2,\'SELECT\') as ok',[role,table])).ok,false);}
  for(const privilege of ['INSERT','UPDATE','DELETE'])assert.equal((await f.one('select has_table_privilege(\'service_role\',\'invoice_credit_note_reversals\',$1) as ok',[privilege])).ok,false);
  assert.equal((await f.one('select has_function_privilege(\'service_role\',$1,\'EXECUTE\') as ok',[signature])).ok,true);
 });
 await test('CR-14 advance-funded reversal restores settlement without changing cash or advance history',async()=>{
  const so=await f.sale(),inv=await f.invoice(so),advance=await f.advance(so,400);await f.apply(advance,inv,400);const note=await credit(inv,25),cash=await f.report('cash');
  good(await send(reversal(note)));const p=await f.financial(inv);assert.deepEqual([p.total,p.paid_amount,p.advance_applied_amount,p.cash_payment_amount,p.customer_credit_balance].map(Number),[400,400,400,0,0]);assert.deepEqual(await f.report('cash'),cash);assert.equal(Number((await f.advanceProgress(advance)).applied_amount),400);
 });
 console.log('Invoice credit reversals: '+passed+'/'+(passed+failed)+'; isolated SQL/API, all scenarios rolled back.');if(failed)process.exitCode=1;
}finally{await db.close();}
