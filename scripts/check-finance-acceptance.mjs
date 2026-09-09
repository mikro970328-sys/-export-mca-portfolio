import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createFinanceAcceptanceDb, financeAcceptanceMigrations } from './lib/finance-acceptance-db.mjs';
import { financeFixture } from './lib/finance-acceptance-fixture.mjs';

const db=await createFinanceAcceptanceDb();
const f=await financeFixture(db), {rows,one,json}=f;
const n=Number, passed=[],failures=[];
const tables=['sales_orders','sales_order_items','invoices','invoice_items','payments','customer_advances',
  'customer_advance_applications','customer_advance_refunds','proformas','proforma_items','purchase_orders',
  'purchase_order_items','supplier_bills','supplier_bill_items','supplier_payments','supplier_payment_applications',
  'cost_charges','cost_charge_allocations','warehouse_receipts','warehouse_receipt_items','purchase_receipt_allocations',
  'loads','load_items','load_allocations','inventory_movements','sales_fulfillment_allocations','shipments','shipment_history','operations'];
async function snapshot(){const state={};for(const t of tables)state[t]=await rows(`select to_jsonb(t) as row from ${t} t order by to_jsonb(t)::text`);return state;}
async function rejects(sql,params,code){
  const before=await snapshot();await db.exec('savepoint expected_failure');let error;
  try{await db.query(sql,params);}catch(e){error=e;}
  await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');
  assert.ok(error,`Expected ${code}`);assert.ok(error.message.includes(code),`Expected ${code}; got ${error.message}`);
  assert.deepEqual(await snapshot(),before,`${code}: no partial writes`);
}
async function test(name,run){await db.exec('begin');try{await run();passed.push(name);console.log(`PASS ${name}`);}catch(e){failures.push(name);console.error(`FAIL ${name}: ${e.message}`);}finally{await db.exec('rollback');}}
const invoiceState=async inv=>(await one('select invoice_action_state($1) as state',[inv.id])).state;
const cashNet=report=>report.rows.reduce((sum,r)=>sum+(r.direction==='in'?1:-1)*n(r.amount),0);

try{
  await test('INV-01 exact commercial total settles at displayed cents',async()=>{
    const so=await f.sale({lines:[{...f.baseLine,ordered_quantity:840,ordered_pallets:28,units_per_pallet:30,line_total:1000}]}),inv=await f.invoice(so);
    assert.equal(n((await f.financial(inv)).total),1000);
    await f.payment(inv,333.33);await f.payment(inv,666.67);
    const p=await f.financial(inv);assert.equal(n(p.balance_due),0);assert.equal(p.payment_status,'paid');
    await rejects('select * from register_invoice_payment($1,0.01)',[inv.id],'PAYMENT_INVOICE_ALREADY_SETTLED');
  });
  await test('INV-02 failed later invoice line and replacement are atomic',async()=>{
    const so=await f.sale(),inv=await f.invoice(so,{quantity:40,issued:false});
    const bad=[{sales_order_item_id:so.items[0].id,quantity:20},{sales_order_item_id:so.items[0].id,quantity:-1}];
    await rejects('select * from replace_invoice_plan($1,$2,$3::jsonb)',[inv.id,so.id,json(bad)],'INVOICE_QUANTITY_INVALID');
    assert.equal(n((await f.financial(inv)).total),160);
    await one('select * from replace_invoice_plan($1,$2,$3::jsonb)',[inv.id,so.id,json([{sales_order_item_id:so.items[0].id,quantity:50}])]);
    assert.equal(n((await f.financial(inv)).total),200);
  });
  await test('INV-03 non-void drafts reserve invoice quantity; void releases it',async()=>{
    const so=await f.sale(),inv=await f.invoice(so,{quantity:60,issued:false});
    await rejects('select * from create_invoice_plan($1,$2::jsonb)',[so.id,json([{sales_order_item_id:so.items[0].id,quantity:50}])],'INVOICE_QUANTITY_EXCEEDS_SALES_ORDER');
    await one("select * from transition_invoice($1,'void')",[inv.id]);
    const replacement=await f.invoice(so);assert.equal(n((await f.financial(replacement)).total),400);
  });
  await test('INV-04 invoice context is checked and issued structure is locked',async()=>{
    const so=await f.sale(),other=await f.sale({clientId:f.clientB});
    await rejects('select * from create_invoice_plan($1,$2::jsonb)',[so.id,json([{sales_order_item_id:other.items[0].id,quantity:10}])],'INVOICE_SO_ITEM_MISMATCH');
    const op=await one("insert into operations(operation_code,client_id) values('QA-FIN-OP',$1) returning id",[f.clientB]);
    await rejects('select * from create_invoice_plan(p_sales_order_id=>$1,p_lines=>$2::jsonb,p_operation_id=>$3)',[so.id,json([{sales_order_item_id:so.items[0].id,quantity:10}]),op.id],'INVOICE_OPERATION_CLIENT_MISMATCH');
    const inv=await f.invoice(so);assert.equal((await invoiceState(inv)).actions.edit.allowed,false);
    await rejects('select * from replace_invoice_plan($1,$2,$3::jsonb)',[inv.id,so.id,json([{sales_order_item_id:so.items[0].id,quantity:10}])],'INVOICE_NOT_DRAFT');
  });
  await test('AR-01 partial payment, overpayment rejection and reversal restore balance',async()=>{
    const inv=await f.invoice(await f.sale()),pay=await f.payment(inv,120);
    assert.equal(n((await f.financial(inv)).balance_due),280);
    await rejects('select * from register_invoice_payment($1,280.01)',[inv.id],'PAYMENT_EXCEEDS_BALANCE');
    await rejects("select * from transition_invoice($1,'void')",[inv.id],'INVOICE_HAS_POSTED_PAYMENTS');
    await one("select * from reverse_invoice_payment($1,'QA correction')",[pay.id]);
    assert.equal(n((await f.financial(inv)).balance_due),400);
    await rejects('select * from reverse_invoice_payment($1)',[pay.id],'PAYMENT_ALREADY_REVERSED');
    await one("select * from transition_invoice($1,'void')",[inv.id]);
    assert.equal((await f.report('invoices')).row_count,0);assert.equal((await f.report('cash')).row_count,0);
  });
  await test('AR-02 draft invoice rejects payment without ledger writes',async()=>{
    const inv=await f.invoice(await f.sale(),{issued:false});
    await rejects('select * from register_invoice_payment($1,1)',[inv.id],'PAYMENT_INVOICE_NOT_ISSUED');
    await rejects('select * from register_invoice_payment($1,0)',[inv.id],'PAYMENT_AMOUNT_INVALID');
  });
  await test('ADV-01 advance plus cash settles once and refund reduces available money',async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,300);
    await f.apply(a,inv,200);await f.payment(inv,200);await f.refund(a,75);
    const p=await f.financial(inv),ap=await f.advanceProgress(a);
    assert.equal(n(p.paid_amount),400);assert.equal(n(p.cash_payment_amount),200);assert.equal(n(p.advance_applied_amount),200);
    assert.equal(n(ap.available_amount),25);
    const progress=await one('select * from sales_order_customer_financial_progress where sales_order_id=$1',[so.id]);
    assert.equal(n(progress.cash_received_net),425);assert.equal(n(progress.invoice_balance_due),0);
    assert.equal((await rows('select * from payments')).length,1);
  });
  await test('ADV-02 available advance and invoice balance independently limit application',async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,100);
    await rejects('select * from apply_customer_advance($1,$2,101)',[a.id,inv.id],'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_AVAILABLE');
    await f.payment(inv,350);
    await rejects('select * from apply_customer_advance($1,$2,51)',[a.id,inv.id],'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE');
    await f.apply(a,inv,50);
    await rejects('select * from refund_customer_advance($1,51)',[a.id],'CUSTOMER_ADVANCE_REFUND_EXCEEDS_AVAILABLE');
    assert.equal(n((await f.advanceProgress(a)).available_amount),50);
  });
  await test('ADV-03 advances cannot cross sales or currencies',async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,100);
    for(const other of [await f.sale(),await f.sale({clientId:f.clientB}),await f.sale({currency:'EUR'})]){
      const otherInv=await f.invoice(other);
      await rejects('select * from apply_customer_advance($1,$2,10)',[a.id,otherInv.id],'CUSTOMER_ADVANCE_APPLICATION_CONTEXT_MISMATCH');
    }
    assert.equal(n((await f.financial(inv)).balance_due),400);
  });
  await test('ADV-04 reversing applications and refunds restores all balances with reasons',async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,300),app=await f.apply(a,inv,100),refund=await f.refund(a,50);
    await rejects("select * from reverse_customer_advance($1,'QA')",[a.id],'CUSTOMER_ADVANCE_HAS_ACTIVE_APPLICATIONS');
    await rejects("select * from transition_invoice($1,'void')",[inv.id],'INVOICE_HAS_POSTED_ADVANCE_APPLICATIONS');
    await rejects("select * from reverse_customer_advance_application($1,'')",[app.id],'CUSTOMER_ADVANCE_APPLICATION_REVERSAL_REASON_REQUIRED');
    await one("select * from reverse_customer_advance_application($1,'QA')",[app.id]);
    await rejects("select * from reverse_customer_advance($1,'QA')",[a.id],'CUSTOMER_ADVANCE_HAS_ACTIVE_REFUNDS');
    await one("select * from reverse_customer_advance_refund($1,'QA')",[refund.id]);
    assert.equal(n((await f.advanceProgress(a)).available_amount),300);
    await one("select * from reverse_customer_advance($1,'QA')",[a.id]);
    assert.equal(n((await f.financial(inv)).balance_due),400);assert.equal((await f.report('cash')).row_count,0);
  });
  await test('PRO-01 issued proforma snapshots totals without AR or cash',async()=>{
    const so=await f.sale(),p=await one('select * from create_proforma($1)',[so.id]);
    await one("select * from transition_proforma($1,'issue')",[p.id]);
    const total=await one('select sum(line_total) as total from proforma_items where proforma_id=$1',[p.id]);assert.equal(n(total.total),400);
    assert.equal((await f.report('invoices')).row_count,0);assert.equal((await f.report('cash')).row_count,0);
    await rejects("select * from transition_proforma($1,'void','')",[p.id],'PROFORMA_VOID_REASON_REQUIRED');
    await one("select * from transition_proforma($1,'void','QA')",[p.id]);
  });
  await test('AP-01 supplier exact total, partial/full payment and reversals reconcile',async()=>{
    const po=await f.purchase(),b=await f.bill(po,{total:100,quantity:3}),p=await f.payBill(b,40);
    assert.equal(n((await f.ap(b)).balance_due),60);
    await rejects('select * from pay_supplier_bill_canonical(p_supplier_bill_id=>$1,p_amount=>61,p_actor=>$2)',[b.id,f.actor],'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL');
    const p2=await f.payBill(b,60);assert.equal((await f.ap(b)).payment_status,'paid');
    for(const payment of [p,p2])await one("select * from reverse_supplier_payment_canonical($1,'QA',$2)",[payment.id,f.actor]);
    assert.equal(n((await f.ap(b)).balance_due),100);assert.equal((await f.report('cash')).row_count,0);
  });
  await test('AP-02 unapplied supplier payment counts as cash and distribution is replaceable',async()=>{
    const po=await f.purchase(),b=await f.bill(po,{total:100}),p=await f.supplierPayment(po,150);
    assert.equal(n((await f.ap(b)).paid_amount),0);assert.equal(cashNet(await f.report('cash')),-150);
    await f.distribute(p,[{supplier_bill_id:b.id,amount:60}]);
    const progress=await one('select * from supplier_payment_progress where supplier_payment_id=$1',[p.id]);assert.equal(n(progress.unapplied_amount),90);
    await f.distribute(p,[]);assert.equal(n((await f.ap(b)).balance_due),100);assert.equal(cashNet(await f.report('cash')),-150);
  });
  await test('AP-03 invalid distribution restores previous applications',async()=>{
    const po=await f.purchase(),b=await f.bill(po,{total:100}),p=await f.supplierPayment(po,80),other=await f.bill(await f.purchase());
    await f.distribute(p,[{supplier_bill_id:b.id,amount:40}]);
    await rejects('select * from replace_supplier_payment_applications_canonical($1,$2::jsonb,$3)',[p.id,json([{supplier_bill_id:b.id,amount:30},{supplier_bill_id:other.id,amount:20}]),f.actor],'SUPPLIER_PAYMENT_APPLICATION_CONTEXT_MISMATCH');
    await rejects('select * from replace_supplier_payment_applications_canonical($1,$2::jsonb,$3)',[p.id,json([{supplier_bill_id:b.id,amount:81}]),f.actor],'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_PAYMENT');
    assert.equal(n((await f.ap(b)).paid_amount),40);
  });
  await test('COST-01 fully allocated cost posts once and void removes direct expense',async()=>{
    const so=await f.sale(),cost=await f.cost(so,{allocated:40,posted:false});
    await rejects('select * from post_cost_charge_canonical($1,$2)',[cost.id,f.actor],'COST_CHARGE_NOT_FULLY_ALLOCATED');
    await one("select * from replace_cost_charge_canonical(p_cost_charge_id=>$1,p_category=>'domestic_trucking',p_stage=>'fulfillment',p_amount=>50,p_allocations=>$2::jsonb,p_actor=>$3)",[cost.id,json([{sales_order_id:so.id,amount:50,basis:'manual'}]),f.actor]);
    await one('select * from post_cost_charge_canonical($1,$2)',[cost.id,f.actor]);
    assert.equal(n((await one('select * from sales_order_profitability where sales_order_id=$1',[so.id])).direct_cost_amount),50);
    await rejects('select * from post_cost_charge_canonical($1,$2)',[cost.id,f.actor],'COST_CHARGE_NOT_DRAFT');
    await one('select * from void_cost_charge_canonical($1,$2)',[cost.id,f.actor]);
    assert.equal(n((await one('select * from sales_order_profitability where sales_order_id=$1',[so.id])).direct_cost_amount),0);
  });
  await test('COST-02 immediate posting is atomic and inactive actors are rejected',async()=>{
    const so=await f.sale(),sql="select * from create_posted_cost_charge(p_category=>'domestic_trucking',p_stage=>'fulfillment',p_amount=>50,p_allocations=>$1::jsonb,p_actor=>$2)";
    await rejects(sql,[json([{sales_order_id:so.id,amount:40}]),f.actor],'COST_CHARGE_NOT_FULLY_ALLOCATED');
    await db.query('update admin_users set is_active=false where id=$1',[f.actor]);
    await rejects(sql,[json([{sales_order_id:so.id,amount:50}]),f.actor],'COST_CHARGE_ACTOR_INVALID');
  });
  await test('COGS-01 fulfilled sale, actual bill and cost reconcile gross/contribution margin',async()=>{
    const so=await f.sale(),po=await f.purchase();await f.bill(po);await f.fulfill(so,po);const inv=await f.invoice(so);await f.cost(so);
    const sales=(await f.report('sales')).rows[0],invoice=(await f.report('invoices')).rows[0];
    assert.equal(n(sales.recognized_merchandise_cogs),250);assert.equal(n(sales.gross_margin),150);assert.equal(n(sales.contribution_margin),100);
    assert.equal(n(invoice.invoice_total),400);assert.equal(n(invoice.recognized_merchandise_cogs),250);assert.equal(n(invoice.gross_margin),150);
    assert.equal(n((await f.financial(inv)).balance_due),400);
  });
  await test('COGS-02 different cost currency leaves contribution unknown without FX',async()=>{
    const so=await f.sale(),po=await f.purchase();await f.bill(po);await f.fulfill(so,po);await f.cost(so,{currency:'EUR'});
    const p=await one('select * from sales_order_profitability where sales_order_id=$1',[so.id]);assert.equal(p.contribution_currency_comparable,false);assert.equal(p.contribution_margin,null);
  });
  await test('REP-01 cash report includes advance and refund without counting application again',async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,100);await f.apply(a,inv,50);await f.refund(a,20);await f.payment(inv,40);
    const po=await f.purchase();await f.supplierPayment(po,60);
    const r=await f.report('cash');assert.equal(r.row_count,4);assert.equal(cashNet(r),60);
    assert.deepEqual(r.rows.map(x=>x.event_type).sort(),['customer_advance','customer_advance_refund','customer_collection','supplier_payment']);
    assert.equal(n((await f.financial(inv)).balance_due),310);
  });
  await test('REP-02 dashboard cash matches advance/refund ledger and report',async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,100);await f.apply(a,inv,50);await f.refund(a,20);await f.payment(inv,40);
    await f.supplierPayment(await f.purchase(),60);
    const activity=(await f.dashboard()).activity_by_currency.find(x=>x.currency==='USD');
    assert.equal(n(activity.cash_collected),140);assert.equal(n(activity.cash_paid),80);assert.equal(n(activity.net_cash_flow),60);
    assert.equal(n(activity.net_cash_flow),cashNet(await f.report('cash')));
  });
  await test('REP-03 AR/AP snapshots reconcile current balances and partial overdue',async()=>{
    const so=await f.sale(),inv=await f.invoice(so);await f.payment(inv,40);
    const b=await f.bill(await f.purchase());await f.payBill(b,50);
    const ar=(await f.report('invoices')).rows[0],ap=(await f.report('supplier_bills')).rows[0];
    assert.equal(n(ar.balance_due),360);assert.equal(ar.overdue,true);assert.equal(n(ap.balance_due),200);assert.equal(ap.overdue,true);
    const roll=await f.dashboard({start_date:'2026-10-01',end_date:'2026-10-31'});
    assert.equal(roll.activity_by_currency.length,0);
    const balances=roll.balances_by_currency.find(x=>x.currency==='USD');assert.equal(n(balances.ar_balance),360);assert.equal(n(balances.ap_balance),200);
  });
  await test('REP-04 cash date filters use receipt/refund dates',async()=>{
    const so=await f.sale(),a=await f.advance(so,100,'2026-08-10');await f.refund(a,25,'2026-09-09');
    const september=await f.report('cash',{start_date:'2026-09-01',end_date:'2026-09-30'});assert.equal(september.row_count,1);assert.equal(cashNet(september),-25);
    const activity=(await f.dashboard({start_date:'2026-09-01',end_date:'2026-09-30'})).activity_by_currency.find(x=>x.currency==='USD');assert.equal(n(activity.net_cash_flow),-25);
  });
  await test('REP-05 currencies and cash customer/product/supplier filters remain separate',async()=>{
    const so=await f.sale(),other=await f.sale({currency:'EUR',clientId:f.clientB,lines:[{...f.baseLine,product_id:f.productB}]});
    await f.advance(so,100);await f.advance(other,200);await f.supplierPayment(await f.purchase(),30);
    assert.equal(cashNet(await f.report('cash',{currency:'EUR'})),200);
    assert.equal(cashNet(await f.report('cash',{client_id:f.client})),100);
    assert.equal(cashNet(await f.report('cash',{product_id:f.productB})),200);
    assert.equal(cashNet(await f.report('cash',{supplier_id:f.supplier})),-30);
    const roll=await f.dashboard();assert.equal(roll.balance_basis,'current_snapshot');
    assert.equal(n(roll.activity_by_currency.find(x=>x.currency==='USD').net_cash_flow),70);
    assert.equal(n(roll.activity_by_currency.find(x=>x.currency==='EUR').net_cash_flow),200);
  });
  await test('REP-06 invalid report filters fail explicitly',async()=>{
    await rejects("select executive_report_dataset('invoices',p_supplier_id=>$1)",[f.supplier],'REPORT_FILTER_NOT_APPLICABLE');
    await rejects("select executive_report_dataset('cash','2026-09-10','2026-09-01')",[],'REPORT_DATE_RANGE_INVALID');
    await rejects("select executive_report_dataset('unknown')",[],'REPORT_DATASET_INVALID');
  });
  await test('DB-01 cash migration is repeatable and preserves backend-only access',async()=>{
    const so=await f.sale();await f.advance(so,100);const before=await snapshot(),cash=await f.report('cash');
    await db.exec(fs.readFileSync('supabase/migrations/20260909185121_finance_cash_reconciliation.sql','utf8'));
    assert.deepEqual(await snapshot(),before);assert.deepEqual(await f.report('cash'),cash);
    for(const role of ['anon','authenticated']){
      const p=await one("select has_table_privilege($1,'public.executive_cash_movement_source','select') as allowed",[role]);assert.equal(p.allowed,false);
    }
    assert.equal((await one("select has_table_privilege('service_role','public.executive_cash_movement_source','select') as allowed")).allowed,true);
    const functions=await rows("select p.proname,has_function_privilege('anon',p.oid,'execute') as anon,has_function_privilege('authenticated',p.oid,'execute') as authenticated,has_function_privilege('service_role',p.oid,'execute') as backend from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('executive_report_dataset','executive_dashboard_rollup')");
    assert.equal(functions.length,2);for(const p of functions){assert.equal(p.anon,false);assert.equal(p.authenticated,false);assert.equal(p.backend,true);}
  });
  const residue=await snapshot();for(const [table,data] of Object.entries(residue))assert.equal(data.length,0,`${table}: no QA business residue`);
  console.log(`Finance acceptance: ${passed.length}/${passed.length+failures.length} scenarios; ${financeAcceptanceMigrations.length} migration sources; zero business residue.`);
}finally{await db.close();}
if(failures.length)process.exitCode=1;
