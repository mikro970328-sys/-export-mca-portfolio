import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createFinanceAcceptanceDb } from './lib/finance-acceptance-db.mjs';
import { financeFixture } from './lib/finance-acceptance-fixture.mjs';
import { financeAcceptanceApi } from './lib/finance-acceptance-api.mjs';

const db=await createFinanceAcceptanceDb(),f=await financeFixture(db),api=financeAcceptanceApi(db);
const admin={admin_id:f.actor,role:'master_admin',permissions:[]},reader={admin_id:f.clientB,role:'admin',permissions:['finance.read','reports.read']};
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

  await test('API-12 same request reuses its payment and audit, equal independent receipts remain valid',async()=>{
    const inv=await f.invoice(await f.sale()),body={action:'register',invoice_id:inv.id,amount:50,request_id:randomUUID(),notes:'Original receipt'};
    const first=success(await request('invoice-payments',body)).payment;
    const repeat=success(await request('invoice-payments',body)).payment;
    assert.equal(repeat.id,first.id);assert.equal(first.created_by,f.actor);
    assert.equal(n((await f.financial(inv)).paid_amount),50);
    assert.equal(n((await f.one("select count(*) as n from audit_log where action='invoice_payment_registered' and entity_id=$1",[first.id])).n),1);
    const other=success(await request('invoice-payments',{...body,request_id:randomUUID()})).payment;
    assert.notEqual(other.id,first.id);assert.equal(n((await f.financial(inv)).paid_amount),100);
  });
  await test('API-13 a fully paid invoice still confirms its original request',async()=>{
    const inv=await f.invoice(await f.sale()),body={action:'register',invoice_id:inv.id,amount:400,request_id:randomUUID()};
    const first=success(await request('invoice-payments',body)).payment;
    assert.equal(success(await request('invoice-payments',body)).payment.id,first.id);
    assert.equal(n((await f.financial(inv)).balance_due),0);
    assert.equal((await f.rows('select id from payments where invoice_id=$1',[inv.id])).length,1);
  });
  await test('API-14 reuse with altered receipt data is rejected without another payment',async()=>{
    const inv=await f.invoice(await f.sale()),other=await f.invoice(await f.sale());
    const body={action:'register',invoice_id:inv.id,amount:40,request_id:randomUUID(),payment_date:'2026-09-16',method:'wire',reference_number:'QA',notes:'Original'};
    const first=success(await request('invoice-payments',body)).payment;
    for(const patch of [{amount:41},{invoice_id:other.id},{payment_date:'2026-09-17'},{method:'cash'},{reference_number:'Other'},{notes:'Changed'}]){
      const res=await request('invoice-payments',{...body,...patch});
      assert.equal(res.status,400);assert.equal(res.body.details.code,'PAYMENT_REQUEST_CONFLICT');
    }
    const actor=(await f.one("insert into admin_users(username,role) values('QA other writer','master_admin') returning id")).id;
    const res=await api.request('invoice-payments',{method:'POST',body,admin:{...admin,admin_id:actor}});
    assert.equal(res.status,400);assert.equal(res.body.details.code,'PAYMENT_REQUEST_CONFLICT');
    assert.equal(success(await request('invoice-payments',body)).payment.id,first.id);
    assert.equal(n((await f.financial(inv)).paid_amount),40);assert.equal(n((await f.financial(other)).paid_amount),0);
  });
  await test('API-15 retrying a subsequently reversed collection never resurrects it',async()=>{
    const inv=await f.invoice(await f.sale()),body={action:'register',invoice_id:inv.id,amount:80,request_id:randomUUID(),notes:'Original notes'};
    const first=success(await request('invoice-payments',body)).payment;
    success(await request('invoice-payments',{action:'reverse',payment_id:first.id,reason:'QA reverse'}));
    const repeat=success(await request('invoice-payments',body)).payment;
    assert.equal(repeat.id,first.id);assert.equal(repeat.status,'reversed');
    assert.equal(n((await f.financial(inv)).paid_amount),0);
    assert.equal((await f.rows('select id from payments where invoice_id=$1',[inv.id])).length,1);
    assert.equal(n((await f.one("select count(*) as n from audit_log where action='invoice_payment_registered' and entity_id=$1",[first.id])).n),1);
  });
  await test('API-16 malformed request keys and unauthorized retries never reach SQL',async()=>{
    const inv=await f.invoice(await f.sale()),body={action:'register',invoice_id:inv.id,amount:50,request_id:randomUUID()};
    success(await request('invoice-payments',body));
    const start=api.calls.length;
    for(const request_id of ['',42,'not-a-uuid',body.request_id+'extra']){
      const res=await request('invoice-payments',{...body,request_id});
      assert.equal(res.status,400);assert.equal(res.body.details.code,'PAYMENT_REQUEST_INVALID');
    }
    assert.equal((await api.request('invoice-payments',{method:'POST',body,admin:reader})).status,403);
    assert.equal((await api.request('invoice-payments',{method:'POST',body})).status,401);
    assert.equal(api.calls.length,start);
  });
  await test('API-17 failed audit rolls back the receipt and the same request can then succeed',async()=>{
    const inv=await f.invoice(await f.sale()),body={action:'register',invoice_id:inv.id,amount:70,request_id:randomUUID()};
    await db.exec("create function qa_fail_payment_audit() returns trigger language plpgsql as $$ begin if new.action='invoice_payment_registered' then raise exception 'QA_AUDIT_FAILURE'; end if; return new; end; $$; create trigger qa_payment_audit before insert on audit_log for each row execute function qa_fail_payment_audit()");
    assert.equal((await request('invoice-payments',body)).status,500);
    assert.equal((await f.rows('select id from payments where invoice_id=$1',[inv.id])).length,0);
    assert.equal(n((await f.financial(inv)).balance_due),400);
    await db.exec('drop trigger qa_payment_audit on audit_log; drop function qa_fail_payment_audit()');
    success(await request('invoice-payments',body));success(await request('invoice-payments',body));
    assert.equal((await f.rows('select id from payments where invoice_id=$1',[inv.id])).length,1);
    assert.equal(n((await f.financial(inv)).balance_due),330);
  });
  await test('API-18 stored request identity and payload cannot be rewritten',async()=>{
    const inv=await f.invoice(await f.sale()),body={action:'register',invoice_id:inv.id,amount:10,request_id:randomUUID()};
    const payment=success(await request('invoice-payments',body)).payment;
    for(const column of ['registration_request_id','registration_request_payload']){
      await db.exec('savepoint immutable_request');
      await assert.rejects(()=>db.query(`update payments set ${column}=null where id=$1`,[payment.id]),/PAYMENT_STRUCTURE_LOCKED/);
      await db.exec('rollback to savepoint immutable_request; release savepoint immutable_request');
    }
    assert.equal(success(await request('invoice-payments',body)).payment.id,payment.id);
  });

  await test('API-19 supplier retries share one ledger, application and audit even at full settlement',async()=>{
    for(const amount of [40,250]){
      const po=await f.purchase(),bill=await f.bill(po);
      const body={action:'pay_bill',supplier_bill_id:bill.id,amount,request_id:randomUUID()};
      const first=success(await request('supplier-payments',body)).payment;
      const repeated=success(await request('supplier-payments',body)).payment;
      assert.equal(repeated.id,first.id);assert.equal(n((await f.ap(bill)).paid_amount),amount);
      assert.equal((await f.rows('select id from supplier_payments where purchase_order_id=$1',[po.id])).length,1);
      assert.equal((await f.rows('select id from supplier_payment_applications where supplier_payment_id=$1',[first.id])).length,1);
      const audit=await f.rows("select * from audit_log where action='supplier_bill_paid' and entity_id=$1",[first.id]);
      assert.equal(audit.length,1);assert.equal(audit[0].actor_admin_id,f.actor);
    }
  });
  await test('API-20 supplier advance replay preserves later allocation; independent equal payments remain valid',async()=>{
    const po=await f.purchase(),bill=await f.bill(po),body={action:'register',purchase_order_id:po.id,amount:60,request_id:randomUUID()};
    const first=success(await request('supplier-payments',body)).payment;
    success(await request('supplier-payments',{action:'replace_applications',supplier_payment_id:first.id,applications:[{supplier_bill_id:bill.id,amount:35}]}));
    const replay=success(await request('supplier-payments',body)).payment;
    assert.equal(replay.id,first.id);assert.equal(n(replay.progress.applied_amount),35);assert.equal(n(replay.progress.unapplied_amount),25);
    const other=success(await request('supplier-payments',{...body,request_id:randomUUID()})).payment;
    assert.notEqual(first.id,other.id);assert.equal(n((await f.ap(bill)).paid_amount),35);
    assert.equal((await f.rows("select id from audit_log where action='supplier_payment_registered' and entity_id=$1",[first.id])).length,1);
  });
  await test('API-21 supplier request conflicts bind action, target, actor and every financial field',async()=>{
    const po=await f.purchase(),bill=await f.bill(po),otherPo=await f.purchase(),other=await f.bill(otherPo);
    const actor=(await f.one("insert into admin_users(username,role) values('QA supplier other','master_admin') returning id")).id;
    for(const action of ['register','pay_bill']){
      const body={action,purchase_order_id:po.id,supplier_bill_id:bill.id,amount:40,request_id:randomUUID(),payment_date:'2026-09-16',method:'wire',reference:'QA',notes:'Original'};
      const first=success(await request('supplier-payments',body)).payment;
      for(const patch of [{amount:41},{payment_date:'2026-09-17'},{method:'cash'},{reference:'Changed'},{notes:'Changed'},
        action==='register'?{purchase_order_id:otherPo.id}:{supplier_bill_id:other.id},
        {action:action==='register'?'pay_bill':'register'}]){
        const res=await request('supplier-payments',{...body,...patch});
        assert.equal(res.status,400,JSON.stringify(res.body));assert.equal(res.body.details.code,'SUPPLIER_PAYMENT_REQUEST_CONFLICT');
      }
      const res=await api.request('supplier-payments',{method:'POST',body,admin:{...admin,admin_id:actor}});
      assert.equal(res.status,400);assert.equal(res.body.details.code,'SUPPLIER_PAYMENT_REQUEST_CONFLICT');
      assert.equal(success(await request('supplier-payments',body)).payment.id,first.id);
    }
    assert.equal((await f.rows('select id from supplier_payments where purchase_order_id=$1',[po.id])).length,2);
    assert.equal(n((await f.ap(bill)).paid_amount),40);assert.equal(n((await f.ap(other)).paid_amount),0);
  });
  await test('API-22 supplier replay after reversal never revives a payment or its applications',async()=>{
    for(const action of ['register','pay_bill']){
      const po=await f.purchase(),bill=await f.bill(po),body={action,purchase_order_id:po.id,supplier_bill_id:bill.id,amount:80,request_id:randomUUID()};
      const first=success(await request('supplier-payments',body)).payment;
      success(await request('supplier-payments',{action:'reverse',supplier_payment_id:first.id,reason:'QA reversed'}));
      const replay=success(await request('supplier-payments',body)).payment;
      assert.equal(replay.id,first.id);assert.equal(replay.status,'reversed');
      assert.equal(n((await f.ap(bill)).balance_due),250);
      assert.equal((await f.rows('select id from supplier_payments where purchase_order_id=$1',[po.id])).length,1);
    }
  });
  await test('API-23 invalid supplier identities and unauthorized replays cannot reach SQL',async()=>{
    const po=await f.purchase(),bill=await f.bill(po);
    for(const action of ['register','pay_bill']){
      const body={action,purchase_order_id:po.id,supplier_bill_id:bill.id,amount:50,request_id:randomUUID()};
      success(await request('supplier-payments',body));const before=api.calls.length;
      for(const request_id of ['',42,'invalid',body.request_id+'extra']){
        const res=await request('supplier-payments',{...body,request_id});
        assert.equal(res.status,400);assert.equal(res.body.details.code,'SUPPLIER_PAYMENT_REQUEST_INVALID');
      }
      assert.equal((await api.request('supplier-payments',{method:'POST',body,admin:reader})).status,403);
      assert.equal((await api.request('supplier-payments',{method:'POST',body})).status,401);
      assert.equal(api.calls.length,before);
    }
  });
  await test('API-24 supplier audit failure rolls back money and applications before a safe retry',async()=>{
    const po=await f.purchase(),bill=await f.bill(po);
    for(const action of ['register','pay_bill']){
      const body={action,purchase_order_id:po.id,supplier_bill_id:bill.id,amount:40,request_id:randomUUID()};
      const before=(await f.rows('select id from supplier_payments')).length;
      await db.exec("create function qa_fail_supplier_audit() returns trigger language plpgsql as $$ begin if new.action in ('supplier_payment_registered','supplier_bill_paid') then raise exception 'QA_AUDIT_FAILURE'; end if; return new; end; $$; create trigger qa_supplier_audit before insert on audit_log for each row execute function qa_fail_supplier_audit()");
      assert.equal((await request('supplier-payments',body)).status,500);
      assert.equal((await f.rows('select id from supplier_payments')).length,before);
      assert.equal((await f.rows('select id from supplier_payment_applications')).length,0);
      assert.equal(n((await f.ap(bill)).balance_due),250);
      await db.exec('drop trigger qa_supplier_audit on audit_log; drop function qa_fail_supplier_audit()');
      const first=success(await request('supplier-payments',body)).payment;
      assert.equal(success(await request('supplier-payments',body)).payment.id,first.id);
    }
  });
  await test('API-25 supplier identity cannot be altered even during an authorized reversal transition',async()=>{
    const po=await f.purchase(),body={action:'register',purchase_order_id:po.id,amount:10,request_id:randomUUID()};
    const p=success(await request('supplier-payments',body)).payment;
    for(const column of ['registration_request_id','registration_request_payload']){
      await db.exec('savepoint supplier_immutable');
      await assert.rejects(()=>db.query("update supplier_payments set "+column+"=null where id=$1",[p.id]),/SUPPLIER_PAYMENT_IMMUTABLE/);
      await db.exec('rollback to savepoint supplier_immutable; release savepoint supplier_immutable');
      await db.exec("savepoint supplier_reversal; select set_config('export_mca.supplier_payment_transition','reverse',true)");
      await assert.rejects(()=>db.query("update supplier_payments set status='reversed',reversal_reason='QA',"+column+"=null where id=$1",[p.id]),/SUPPLIER_PAYMENT_IMMUTABLE/);
      await db.exec('rollback to savepoint supplier_reversal; release savepoint supplier_reversal');
    }
    assert.equal(success(await request('supplier-payments',body)).payment.id,p.id);
  });
  await test('API-26 rollout preserves legacy SQL callers while the new API always uses atomic audit',async()=>{
    const po=await f.purchase(),bill=await f.bill(po);
    for(const action of ['register','pay_bill']){
      const before=api.audits.length;
      const p=success(await request('supplier-payments',{action,purchase_order_id:po.id,supplier_bill_id:bill.id,amount:20})).payment;
      assert.equal(api.audits.length,before,'new handler must not emit a second caller-side audit');
      const stored=await f.one('select registration_request_id from supplier_payments where id=$1',[p.id]);
      assert.ok(stored.registration_request_id,'legacy HTTP request receives a server identity');
      assert.equal((await f.rows("select id from audit_log where action in ('supplier_payment_registered','supplier_bill_paid') and entity_id=$1",[p.id])).length,1);
    }
    for(const fn of ['register_supplier_payment','pay_supplier_bill_canonical']){
      const p=await f.one('select * from '+fn+'($1,10,current_date,null,null,null,$2)',[fn==='register_supplier_payment'?po.id:bill.id,f.actor]);
      assert.equal(p.registration_request_id,null);
      assert.equal((await f.rows("select id from audit_log where action in ('supplier_payment_registered','supplier_bill_paid') and entity_id=$1",[p.id])).length,0,'old caller still owns its audit during rollout');
    }
  });

  console.log(`Finance API acceptance: ${passed.length}/${passed.length+failures.length}; real handlers/SQL and collection/supplier payment audit; simulated auth/transport/other audit delivery.`);
}finally{await db.close();}
if(failures.length)process.exitCode=1;
