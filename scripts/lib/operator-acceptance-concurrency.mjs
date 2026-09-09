import assert from 'node:assert/strict';
import { setTimeout as pause } from 'node:timers/promises';

// A has executed its real RPC and holds its transaction open. PostgreSQL must
// report that B is blocked by A before A commits. No timing-only race or mock DB.
export async function overlappingTransactions(db, first, second, {rollbackFirst=false}={}) {
  const a=await db.connect(), b=await db.connect();
  let task, result;
  try {
    assert.notEqual(a.processID,b.processID);
    await a.query('begin; set local role service_role');
    await b.query('begin; set local role service_role');
    const firstResult=await first(a);
    task=(async()=>{
      try { const value=await second(b); await b.query('commit'); return {value}; }
      catch(error) { await b.query('rollback'); return {error}; }
    })().then(value=>(result=value));
    const deadline=Date.now()+7000;
    let blocked=false;
    while(Date.now()<deadline && !result) {
      const {rows:[state]}=await db.query('select $1::int=any(pg_blocking_pids($2)) as blocked',[a.processID,b.processID]);
      if(state.blocked){blocked=true;break;}
      await pause(20);
    }
    assert.equal(blocked,true,'second real connection must wait for the first transaction');
    await a.query(rollbackFirst?'rollback':'commit');
    await task;
    return {first:firstResult,second:result};
  } finally {
    await a.query('rollback');
    if(task)await task;
    await b.query('rollback');
    a.release();b.release();
  }
}

export async function checkOperatorConcurrency({db,f,users,test}) {
  const {one,rows,json}=f;
  const n=Number;
  const rejected=(race,code)=>{
    assert.ok(race.second.error,`second operation must reject: ${code}`);
    assert.ok(race.second.error.message.includes(code),race.second.error.message);
  };
  const cash=(c,inv,amount)=>c.query('select * from register_invoice_payment($1,$2)',[inv.id,amount]);
  const apply=(c,a,inv,amount)=>c.query('select * from apply_customer_advance($1,$2,$3,null,$4)',[a.id,inv.id,amount,users.a.id]);
  const refund=(c,a,amount)=>c.query('select * from refund_customer_advance(p_customer_advance_id=>$1,p_amount=>$2,p_actor=>$3)',[a.id,amount,users.b.id]);
  const version=async scope=>n((await one('select version from erp_change_state where scope=$1',[scope])).version);

  await test('CON-01 overlapping customer collections cannot exceed an invoice',async()=>{
    const inv=await f.invoice(await f.sale());
    rejected(await overlappingTransactions(db,c=>cash(c,inv,300),c=>cash(c,inv,300)),'PAYMENT_EXCEEDS_BALANCE');
    assert.equal(n((await f.financial(inv)).paid_amount),300);
    assert.equal((await rows('select id from payments where invoice_id=$1',[inv.id])).length,1);
  });
  for (const advanceFirst of [true,false]) await test(`CON-0${advanceFirst?2:3} advance application and cash share the invoice lock`,async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,300);
    const ops=[c=>apply(c,a,inv,300),c=>cash(c,inv,300)];
    if(!advanceFirst)ops.reverse();
    rejected(await overlappingTransactions(db,...ops),advanceFirst?'PAYMENT_EXCEEDS_BALANCE':'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE');
    assert.equal(n((await f.financial(inv)).paid_amount),300);
    assert.equal(n((await f.advanceProgress(a)).available_amount),advanceFirst?0:300);
  });
  for (const refundFirst of [true,false]) await test(`CON-0${refundFirst?4:5} refund and application share the advance balance`,async()=>{
    const so=await f.sale(),inv=await f.invoice(so),a=await f.advance(so,300);
    const ops=[c=>refund(c,a,200),c=>apply(c,a,inv,200)];
    if(!refundFirst)ops.reverse();
    rejected(await overlappingTransactions(db,...ops),refundFirst?'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_AVAILABLE':'CUSTOMER_ADVANCE_REFUND_EXCEEDS_AVAILABLE');
    assert.equal(n((await f.advanceProgress(a)).available_amount),100);
    assert.equal(n((await f.financial(inv)).paid_amount),refundFirst?0:200);
  });
  await test('CON-06 two supplier bill payments cannot overpay or leave an orphan',async()=>{
    const b=await f.bill(await f.purchase());
    const pay=(c,actor)=>c.query('select * from pay_supplier_bill_canonical(p_supplier_bill_id=>$1,p_amount=>150,p_actor=>$2)',[b.id,actor]);
    rejected(await overlappingTransactions(db,c=>pay(c,users.a.id),c=>pay(c,users.b.id)),'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL');
    assert.equal(n((await f.ap(b)).paid_amount),150);
    assert.equal((await rows('select id from supplier_payments where purchase_order_id=$1',[b.purchase_order_id])).length,1);
  });
  await test('CON-07 simultaneous partial receipts respect the purchase quantity',async()=>{
    const po=await f.purchase();
    const receive=c=>c.query('select * from receive_purchase_order_lines($1,$2::jsonb)',[f.warehouse,json([{purchase_order_item_id:po.items[0].id,received_quantity:70,received_pallets:7}])]);
    rejected(await overlappingTransactions(db,receive,receive),'PO_OVER_RECEIPT_REQUIRES_CONFIRMATION');
    const p=await one('select * from purchase_order_item_progress where purchase_order_item_id=$1',[po.items[0].id]);
    assert.equal(n(p.received_quantity),70);assert.equal(n(p.remaining_quantity),30);
  });
  await test('CON-08 two loads cannot reserve the same remaining stock',async()=>{
    const po=await f.purchase();
    const wr=await one('select * from receive_purchase_order_lines($1,$2::jsonb)',[f.warehouse,json([{purchase_order_item_id:po.items[0].id,received_quantity:100,received_pallets:10}])]);
    const item=await one('select id from warehouse_receipt_items where receipt_id=$1',[wr.id]);
    const loads=[];
    for(let i=0;i<2;i++) {
      const load=await one('select * from create_load_plan($1,$2::jsonb)',[f.warehouse,json([{product_id:f.product,planned_quantity:70,planned_pallets:7,allocations:[{receipt_item_id:item.id,allocated_quantity:70,allocated_pallets:7}]}])]);
      loads.push(load);
    }
    const reserve=(c,i)=>c.query("select * from execute_load_action($1,'reserve',$2)",[loads[i].id,users[i?'b':'a'].id]);
    const race=await overlappingTransactions(db,c=>reserve(c,0),c=>reserve(c,1));
    assert.ok(race.second.error);assert.match(race.second.error.message,/INSUFFICIENT|EXCEEDS_AVAILABLE/);
    const balance=await one('select * from inventory_source_balances where receipt_item_id=$1',[item.id]);
    assert.equal(n(balance.reserved_quantity),70);assert.equal(n(balance.available_quantity),30);
    assert.equal((await one('select status from loads where id=$1',[loads[1].id])).status,'draft');
  });
  await test('CON-09 simultaneous draft invoices cannot duplicate sale quantity',async()=>{
    const so=await f.sale();
    const create=c=>c.query('select * from create_invoice_plan($1,$2::jsonb)',[so.id,json([{sales_order_item_id:so.items[0].id,quantity:60}])]);
    rejected(await overlappingTransactions(db,create,create),'INVOICE_QUANTITY_EXCEEDS_SALES_ORDER');
    assert.equal((await rows('select id from invoices where sales_order_id=$1',[so.id])).length,1);
  });
  await test('CON-10 reversing the same payment twice changes the ledger once',async()=>{
    const inv=await f.invoice(await f.sale()),p=await f.payment(inv,100);
    const reverse=c=>c.query("select * from reverse_invoice_payment($1,'QA reversal')",[p.id]);
    rejected(await overlappingTransactions(db,reverse,reverse),'PAYMENT_ALREADY_REVERSED');
    assert.equal(n((await f.financial(inv)).balance_due),400);
  });
  await test('CON-11 rollback releases a waiting writer without publishing phantom data',async()=>{
    const inv=await f.invoice(await f.sale()),before=await version('invoices');
    const race=await overlappingTransactions(db,async c=>{
      const value=await cash(c,inv,300);
      assert.equal(n((await f.financial(inv)).paid_amount),0,'other connection sees only committed data');
      assert.equal(await version('invoices'),before,'other connection sees only committed versions');
      return value;
    },c=>cash(c,inv,300),{rollbackFirst:true});
    assert.equal(race.second.error,undefined);
    assert.equal((await rows('select id from payments where invoice_id=$1',[inv.id])).length,1);
    assert.equal(n((await f.financial(inv)).paid_amount),300);
    assert.ok(await version('invoices')>before);
  });
  await test('CON-12 concurrent session revocations preserve both increments and audits',async()=>{
    const before=n((await one('select session_version from admin_users where id=$1',[users.b.id])).session_version);
    const revoke=c=>c.query("select * from revoke_admin_sessions($1,$2,'QA overlap')",[users.b.id,users.master.id]);
    const race=await overlappingTransactions(db,revoke,revoke);
    assert.equal(race.second.error,undefined);
    assert.equal(n((await one('select session_version from admin_users where id=$1',[users.b.id])).session_version),before+2);
    assert.equal((await rows("select id from audit_log where action='revoke_admin_sessions' and entity_id=$1",[users.b.id])).length,2);
  });
}
