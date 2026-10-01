import fs from 'node:fs';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {applyOperatorAcceptanceSchema} from './lib/operator-acceptance-db.mjs';
import {applyTrackingWorkflowAcceptanceSchema} from './lib/tracking-workflow-acceptance-db.mjs';
import {operatorFixture} from './lib/operator-acceptance-fixture.mjs';
import handler from '../api/sales-direct-operation.js';
import {createToken} from '../api/_lib.js';

const db=new PGlite({extensions:{pgcrypto}}),read=path=>fs.readFileSync(path,'utf8');
const one=async(sql,args=[])=>(await db.query(sql,args)).rows[0];
try {
  await db.waitReady;
  await applyOperatorAcceptanceSchema(db);
  await db.exec(read('supabase/workers.sql'));
  await db.exec('alter table workers add column position text');
  await db.exec('create table commercial_publications(id uuid primary key default gen_random_uuid(),assigned_admin_id uuid references admin_users(id) on delete set null,created_by uuid references admin_users(id) on delete set null)');
  await applyTrackingWorkflowAcceptanceSchema(db);
  await db.exec(read('supabase/migrations/20260831005100_p17_admin_worker_atomic_audit.sql'));
  const {f,users}=await operatorFixture(db);
  const accountMigration=fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_admin_account_deletion.sql'));
  await db.exec(read('supabase/migrations/'+accountMigration));
  const migration=fs.existsSync('docs/direct-operation.pending.sql')?'docs/direct-operation.pending.sql':'supabase/migrations/'+fs.readdirSync('supabase/migrations').find(f=>f.endsWith('_sales_direct_operation.sql'));
  const operationSql=read(migration);
  await db.exec(operationSql.slice(0,operationSql.indexOf('-- Estimates remain separate')));
  const save=async(payload,id=randomUUID(),actor=users.master.id)=>{
    await db.exec('set role service_role');
    try{return (await one('select public.save_sales_direct_operation($1::jsonb,$2,$3) as result',[JSON.stringify(payload),actor,id])).result;}
    finally{await db.exec('reset role');}
  };
  const sale=await f.sale({lines:[{product_id:f.product,ordered_quantity:2730,ordered_pallets:21,units_per_pallet:130,line_total:18994}]});
  const payload={sales_order_id:sale.id,supplier_id:f.supplier,supplier_reference:'PO12567',container_number:'QA-DIRECT-001',lines:[{sales_order_item_id:sale.items[0].id,total:'13000.01'}]};
  const invoice=await f.invoice(sale);await f.payment(invoice,18994);
  const requestId=randomUUID(),result=await save(payload,requestId);
  assert.equal(result.container_number,'QA-DIRECT-001');
  assert.equal(result.supplier_reference,'PO12567');
  const purchase=await one('select * from purchase_order_items where purchase_order_id=$1',[result.purchase_order_id]);
  assert.equal(Number(purchase.ordered_quantity),2730);
  assert.equal(Number(purchase.ordered_pallets),21);
  assert.equal(Number(purchase.entered_line_total),13000.01);
  assert.equal((await one('select count(*)::int as n from supplier_bills')).n,0);
  assert.equal((await one('select count(*)::int as n from warehouse_receipts')).n,0);
  assert.deepEqual(await save(payload,requestId),result);
  assert.equal((await one('select count(*)::int as n from purchase_orders where id=$1',[result.purchase_order_id])).n,1);
  await assert.rejects(save({...payload,container_number:'QA-DIRECT-CHANGED'},requestId),/RETRY_CONFLICT/);
  const supplierBill=await save({sales_order_id:sale.id,purchase_order_id:result.purchase_order_id,supplier_invoice_number:'SUP-001',lines:[]});
  const bill=await one('select * from supplier_bills where id=$1',[supplierBill.supplier_bill_id]);
  assert.equal(bill.status,'posted');
  assert.equal((await one('select count(*)::int as n from supplier_payments')).n,0);
  const ap=await one('select * from supplier_bill_financial_progress where supplier_bill_id=$1',[bill.id]);
  assert.equal(Number(ap.balance_due),13000.01);assert.equal(ap.payment_status,'unpaid');
  const ar=await one('select * from invoice_financial_progress where invoice_id=$1',[invoice.id]);
  assert.equal(Number(ar.balance_due),0);assert.equal(ar.payment_status,'paid');
  const operation=await one('select * from sales_order_direct_operation_summary where sales_order_id=$1',[sale.id]);
  assert.equal(Number(operation.direct_purchase_amount),13000.01);
  assert.equal(Number(operation.direct_pending_purchase_quantity),0);
  const before=(await one('select count(*)::int as n from shipments')).n;
  await assert.rejects(save({sales_order_id:sale.id,purchase_order_id:result.purchase_order_id,container_number:'QA-EMPTY',lines:[]}),/CONTAINER_CONFLICT/);
  assert.equal((await one('select count(*)::int as n from shipments')).n,before);
  const other=await f.sale({lines:[{product_id:f.product,ordered_quantity:20,ordered_pallets:2,line_total:40}]});
  const otherPayload={sales_order_id:other.id,supplier_id:f.supplier,container_number:'QA-DIRECT-001',lines:[{sales_order_item_id:other.items[0].id,total:'20.00'}]};
  const poBefore=(await one('select count(*)::int as n from purchase_orders')).n;
  await assert.rejects(save(otherPayload),/CONTAINER_CONFLICT/);
  assert.equal((await one('select count(*)::int as n from purchase_orders')).n,poBefore);
  await assert.rejects(save({...otherPayload,container_number:'QA-OTHER',lines:[]}),/PRICES_REQUIRED/);
  assert.equal((await one('select count(*)::int as n from purchase_orders')).n,poBefore);
  const draft=await f.sale({confirmed:false});
  await assert.rejects(save({sales_order_id:draft.id,supplier_id:f.supplier,lines:[]}),/PRICES_REQUIRED/);
  assert.equal((await one('select status from sales_orders where id=$1',[draft.id])).status,'draft','Failed operations roll back sale confirmation too');
  const mixed=await f.sale();
  await db.query("insert into sales_supply_plan_lines(sales_order_item_id,supply_method,warehouse_id,planned_quantity,planned_pallets,created_by) values($1,'inventory',$2,50,5,$3)",[mixed.items[0].id,f.warehouse,users.master.id]);
  const mixedResult=await save({sales_order_id:mixed.id,supplier_id:f.supplier,lines:[{sales_order_item_id:mixed.items[0].id,total:'125.01'}]});
  const mixedItem=await one('select * from purchase_order_items where purchase_order_id=$1',[mixedResult.purchase_order_id]);
  assert.equal(Number(mixedItem.ordered_quantity),50);assert.equal(Number(mixedItem.ordered_pallets),5);
  const repeated=await f.sale({lines:[{product_id:f.product,ordered_quantity:20,ordered_pallets:2,units_per_pallet:10,line_total:80},{product_id:f.product,ordered_quantity:30,ordered_pallets:3,units_per_pallet:10,line_total:120}]});
  const repeatedResult=await save({sales_order_id:repeated.id,supplier_id:f.supplier,lines:repeated.items.map((item,index)=>({sales_order_item_id:item.id,total:index?'52.87':'41.04'}))});
  assert.equal(Number((await one('select direct_purchase_amount from sales_order_direct_operation_summary where sales_order_id=$1',[repeated.id])).direct_purchase_amount),93.91);
  assert.equal((await one('select count(*)::int as n from purchase_order_items where purchase_order_id=$1',[repeatedResult.purchase_order_id])).n,2);
  await db.query('update admin_users set is_active=false where id=$1',[users.b.id]);
  await assert.rejects(save({sales_order_id:draft.id,supplier_id:f.supplier,lines:[]},randomUUID(),users.b.id),/PERMISSION/);
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role);
    await assert.rejects(db.query('select public.save_sales_direct_operation($1::jsonb,$2,$3)',[JSON.stringify(payload),users.master.id,randomUUID()]),/permission denied/);
    await db.exec('reset role');
  }
  // Run the real HTTP handler against the same canonical DB function.
  process.env.JWT_SECRET='qa-direct-operation-secret-0123456789';
  process.env.SUPABASE_URL='https://qa-direct-operation.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='qa-only';
  const nativeFetch=globalThis.fetch,calls=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);assert.equal(url.hostname,'qa-direct-operation.invalid');
    let data;
    if(url.pathname==='/rest/v1/admin_users')data=(await db.query('select id,full_name,username,role,is_active,access_role_id,session_version from admin_users where id=$1',[url.searchParams.get('id').slice(3)])).rows;
    else if(url.pathname==='/rest/v1/admin_effective_permissions')data=[];
    else if(url.pathname==='/rest/v1/suppliers')data=(await db.query('select id,name from suppliers where active')).rows;
    else if(url.pathname==='/rest/v1/rpc/save_sales_direct_operation'){
      const body=JSON.parse(options.body);calls.push(body);
      try{data=await save(body.p_payload,body.p_request_id,body.p_actor);}catch(error){return new Response(JSON.stringify({message:error.message}),{status:400});}
    }else throw Error('Unexpected isolated request '+url.pathname);
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
  try{
    const token=createToken({admin:true,admin_id:users.master.id,username:users.master.username,role:users.master.role,session_version:users.master.session_version});
    const call=async(method,body)=>{const res={statusCode:0,setHeader(){},end(value){this.body=JSON.parse(value);}};await handler({method,query:{},headers:{authorization:'Bearer '+token},body},res);return res;};
    assert.equal((await call('GET',{})).body.write_access,true);
    const apiPayload={sales_order_id:draft.id,supplier_id:f.supplier,request_id:randomUUID(),lines:[{sales_order_item_id:draft.items[0].id,total:'114.33'}],p_actor:users.b.id};
    const apiResult=await call('POST',apiPayload);
    assert.equal(apiResult.statusCode,200);assert.ok(apiResult.body.operation.purchase_order_id);
    assert.equal(calls.at(-1).p_actor,users.master.id,'HTTP ignores forged actor input');
    assert.equal(calls.at(-1).p_payload.p_actor,undefined);
    const count=calls.length;
    assert.equal((await call('POST',{...apiPayload,request_id:randomUUID(),lines:[{sales_order_item_id:draft.items[0].id,total:'1.234'}]})).statusCode,400);
    assert.equal(calls.length,count,'Invalid precision is rejected before RPC');
  }finally{globalThis.fetch=nativeFetch;}
  console.log('Direct operation: exact purchase costs, inherited pallets, linked container, idempotent retries, unpaid supplier invoice, conflict rollback and server-only access passed.');
}catch(error){console.error('Direct operation QA failed:',error.message,error.detail||'');process.exitCode=1;}
finally{await db.close();}
