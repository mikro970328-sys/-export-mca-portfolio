import assert from 'node:assert/strict';
import { createFinanceAcceptanceDb } from './lib/finance-acceptance-db.mjs';
import { financeFixture } from './lib/finance-acceptance-fixture.mjs';
import { financeAcceptanceApi } from './lib/finance-acceptance-api.mjs';

const db=await createFinanceAcceptanceDb(),f=await financeFixture(db),api=financeAcceptanceApi(db);
const admin={admin_id:f.actor,role:'master_admin',permissions:[]},reader={admin_id:f.clientB,role:'operator',permissions:['finance.read','reports.read']};
const passed=[],failures=[],n=Number;
const request=(name,body)=>api.request(name,{method:'POST',body,admin});
const get=(name,query={},who=admin)=>api.request(name,{admin:who,query});
const success=res=>{assert.equal(res.status,200,JSON.stringify(res.body));return res.body;};
async function test(name,run){await db.exec('begin');try{await run();passed.push(name);console.log(`PASS ${name}`);}catch(error){failures.push(name);console.error(`FAIL ${name}: ${error.message}`);}finally{await db.exec('rollback');}}
try{
  await test('API-01 anonymous and read-only actors cannot reach financial writes',async()=>{
    const start=api.calls.length;
    for(const name of ['invoices','invoice-payments','customer-advances','supplier-payments','costs']){
      assert.equal((await api.request(name,{method:'POST',body:{action:'register'}})).status,401);
      assert.equal((await api.request(name,{method:'POST',body:{action:'register'},admin:reader})).status,403);
    }
    assert.equal(api.calls.length,start);assert.equal((await api.request('reports')).status,401);
  });
  await test('API-02 invoice create/edit/issue responses and subsequent reads are current',async()=>{
    const so=await f.sale(),line={sales_order_item_id:so.items[0].id,quantity:40};
    const created=success(await request('invoices',{action:'create_plan',sales_order_id:so.id,lines:[line]})).invoice;
    assert.equal(n(created.financial.total),160);
    const edited=success(await request('invoices',{action:'replace_plan',invoice_id:created.id,sales_order_id:so.id,lines:[{...line,quantity:50}]})).invoice;
    assert.equal(n(edited.financial.total),200);
    const issued=success(await request('invoices',{action:'issue',invoice_id:created.id})).invoice;
    assert.equal(issued.status,'issued');assert.equal(issued.capabilities.actions.edit.allowed,false);
    assert.equal(n(success(await get('invoices',{id:created.id})).invoice.financial.balance_due),200);
  });
  await test('API-03 collection, overpayment and reversal update invoice and AR immediately',async()=>{
    const inv=await f.invoice(await f.sale());
    const pay=success(await request('invoice-payments',{action:'register',invoice_id:inv.id,amount:120})).payment;
    assert.equal(n(success(await get('invoices',{id:inv.id})).invoice.financial.balance_due),280);
    const over=await request('invoice-payments',{action:'register',invoice_id:inv.id,amount:281});assert.equal(over.status,400);assert.equal(over.body.details.code,'PAYMENT_EXCEEDS_BALANCE');
    success(await request('invoice-payments',{action:'reverse',payment_id:pay.id,reason:'QA'}));
    assert.equal(n(success(await get('invoices',{id:inv.id})).invoice.financial.balance_due),400);
  });
  await test('API-04 invalid invoice quantities are rejected before RPC',async()=>{
    const so=await f.sale();
    for(const quantity of ['NaN','Infinity','not-a-number',0,-1]){
      const start=api.calls.length;
      const res=await request('invoices',{action:'create_plan',sales_order_id:so.id,lines:[{sales_order_item_id:so.items[0].id,quantity}]});
      assert.equal(res.status,400,JSON.stringify(res.body));assert.equal(api.calls.length,start,`Invalid quantity ${quantity} reached SQL`);
    }
    assert.equal((await f.rows('select * from invoices')).length,0);
  });
  await test('API-05 partial overdue invoice remains in overdue counter',async()=>{
    const inv=await f.invoice(await f.sale());await f.payment(inv,40);
    const data=success(await get('invoices',{id:inv.id}));assert.equal(data.invoice.financial.payment_status,'partial');
    assert.equal(data.metrics.overdue_count,1);assert.equal(n(data.metrics.receivable_by_currency[0].amount),360);
  });
  await test('API-06 read-only capabilities mask writes but preserve business reasons',async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,100);
    const data=success(await get('invoices',{id:inv.id},reader));assert.equal(data.write_access,false);
    assert.equal(data.invoice.capabilities.actions.record_payment.business_allowed,true);assert.equal(data.invoice.capabilities.actions.record_payment.allowed,false);
    const finance=success(await get('customer-advances',{sales_order_id:so.id},reader));assert.equal(finance.write_access,false);
    assert.equal(finance.advances.find(x=>x.customer_advance_id===a.id).capabilities.actions.apply.allowed,false);
  });
  await test('API-07 advance register/apply/refund/reversals return reconciled finance',async()=>{
    const so=await f.sale(),inv=await f.invoice(so);
    const a=success(await request('customer-advances',{action:'register',sales_order_id:so.id,amount:300})).advance;
    const app=success(await request('customer-advances',{action:'apply',customer_advance_id:a.id,invoice_id:inv.id,amount:100}));
    assert.equal(n(app.finance.progress.invoice_balance_due),300);
    const refund=success(await request('customer-advances',{action:'refund',customer_advance_id:a.id,amount:50}));assert.equal(n(refund.finance.progress.advance_available_amount),150);
    const blocked=await request('customer-advances',{action:'reverse',customer_advance_id:a.id,reason:'QA'});assert.equal(blocked.status,400);
    success(await request('customer-advances',{action:'reverse_application',application_id:app.application.id,reason:'QA'}));
    success(await request('customer-advances',{action:'reverse_refund',refund_id:refund.refund.id,reason:'QA'}));
    const reversed=success(await request('customer-advances',{action:'reverse',customer_advance_id:a.id,reason:'QA'}));
    assert.equal(n(reversed.finance.progress.cash_received_net),0);assert.equal(n(reversed.finance.progress.invoice_balance_due),400);
  });
  await test('API-08 supplier payment distribution and reversal expose current AP',async()=>{
    const po=await f.purchase(),bill=await f.bill(po);
    const p=success(await request('supplier-payments',{action:'register',purchase_order_id:po.id,amount:100})).payment;
    assert.equal(n(p.progress.unapplied_amount),100);
    const allocated=success(await request('supplier-payments',{action:'replace_applications',supplier_payment_id:p.id,applications:[{supplier_bill_id:bill.id,amount:60}]})).payment;
    assert.equal(n(allocated.progress.unapplied_amount),40);
    let data=success(await get('supplier-payments'));assert.equal(n(data.bills[0].financial.balance_due),190);
    success(await request('supplier-payments',{action:'reverse',supplier_payment_id:p.id,reason:'QA'}));
    data=success(await get('supplier-payments'));assert.equal(n(data.bills[0].financial.balance_due),250);
    const direct=success(await request('supplier-payments',{action:'pay_bill',supplier_bill_id:bill.id,amount:250})).payment;
    assert.equal(n(direct.progress.unapplied_amount),0);assert.equal(n((await f.ap(bill)).balance_due),0);
  });
  await test('API-09 non-finite supplier payment and distribution amounts never reach RPC',async()=>{
    const po=await f.purchase(),bill=await f.bill(po),p=await f.supplierPayment(po,100);
    for(const body of [
      {action:'register',purchase_order_id:po.id,amount:'Infinity'},
      {action:'pay_bill',supplier_bill_id:bill.id,amount:'Infinity'},
      {action:'replace_applications',supplier_payment_id:p.id,applications:[{supplier_bill_id:bill.id,amount:'NaN'}]},
      {action:'replace_applications',supplier_payment_id:p.id,applications:[{supplier_bill_id:bill.id,amount:'invalid'}]}
    ]){const start=api.calls.length;assert.equal((await request('supplier-payments',body)).status,400);assert.equal(api.calls.length,start,'Invalid payment amount reached SQL');}
  });
  await test('API-10 cost create/post/void refreshes real cost read models',async()=>{
    const so=await f.sale();
    const cost=success(await request('costs',{action:'create',category:'domestic_trucking',stage:'fulfillment',amount:50,currency:'USD',allocations:[{sales_order_id:so.id,amount:50}]})).charge;
    success(await request('costs',{action:'post',cost_charge_id:cost.id}));
    let data=success(await get('costs'));assert.equal(data.charges[0].status,'posted');assert.equal(n(data.cost_models.sales_order_direct[0].direct_cost_amount),50);
    success(await request('costs',{action:'void',cost_charge_id:cost.id}));data=success(await get('costs'));assert.equal(data.charges[0].status,'void');assert.equal(data.cost_models.sales_order_direct.length,0);
  });
  await test('API-11 cash JSON and CSV share advances/refunds and report filters',async()=>{
    const so=await f.sale(),a=await f.advance(so,100);await f.refund(a,20);
    const query={dataset:'cash',include_options:'0',client_id:f.client,currency:'USD'};
    const data=success(await get('reports',query));assert.equal(data.row_count,2);assert.equal(data.currency_policy,'separate_no_fx');
    const csv=await get('reports',{...query,format:'csv'});assert.equal(csv.status,200);assert.ok(csv.headers['Content-Type'].startsWith('text/csv'));
    for(const row of data.rows){assert.ok(csv.body.includes(`"${row.event_type}"`));assert.ok(csv.body.includes(`"${row.amount}"`));}
    assert.equal((await get('reports',{dataset:'invoices',supplier_id:f.supplier})).status,400);
    assert.equal((await get('reports',{dataset:'cash',start_date:'2026-02-30'})).status,400);
  });
  console.log(`Finance API acceptance: ${passed.length}/${passed.length+failures.length}; real handlers/SQL, simulated auth/transport/audit.`);
}finally{await db.close();}
if(failures.length)process.exitCode=1;
