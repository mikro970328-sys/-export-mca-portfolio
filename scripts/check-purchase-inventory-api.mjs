import assert from 'node:assert/strict';
import { createPurchaseAcceptanceDb } from './lib/purchase-acceptance-db.mjs';
import { purchaseAcceptanceApi } from './lib/purchase-acceptance-api.mjs';

const db=await createPurchaseAcceptanceDb();
const one=async(sql,params=[]) => (await db.query(sql,params)).rows[0];
const api=purchaseAcceptanceApi(db);
const master={admin_id:'00000000-0000-4000-8000-000000000001',role:'master_admin',permissions:[]};
const reader={admin_id:'00000000-0000-4000-8000-000000000002',role:'admin',permissions:['procurement.read','warehouse.read']};
const receiver={...reader,admin_id:'00000000-0000-4000-8000-000000000003',permissions:['procurement.read','warehouse.read','warehouse.write']};
const failures=[];
let passed=0;
async function test(name,run) {
  await db.exec('begin');
  try { await run(); passed++; console.log(`PASS ${name}`); }
  catch(error){failures.push(name);console.error(`FAIL ${name}: ${error.message}`);}
  finally { await db.exec('rollback'); }
}
try {
  await db.query('insert into admin_users(id,username,role) values($1,$2,$3)',[master.admin_id,'QA master','master_admin']);
  const supplier=(await one("insert into suppliers(name) values('QA API supplier') returning id")).id;
  const warehouse=(await one("insert into warehouses(code,name,country) values('QA-API','QA warehouse','USA') returning id")).id;
  const product=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-API','QA boxes','cajas',10) returning id")).id;
  const body={action:'create_plan',supplier_id:supplier,warehouse_id:warehouse,lines:[{product_id:product,ordered_quantity:100,ordered_pallets:10,units_per_pallet:10,line_total:250}]};
  const post=(data,admin=master)=>api.request('purchases',{method:'POST',body:data,admin});
  async function purchase(){const result=await post(body);assert.equal(result.status,200,JSON.stringify(result.body));return result.body.order;}
  async function confirmed(){const po=await purchase();for(const action of ['issue','confirm'])assert.equal((await post({action,purchase_order_id:po.id})).status,200);return po;}
  const receiveBody=(po,flag=false)=>({action:'receive',warehouse_id:warehouse,allow_over_receipt:flag,lines:[{purchase_order_item_id:po.items[0].id,received_quantity:120,received_pallets:12,lot_number:'QA-API-LOT'}]});

  await test('API-01 unauthenticated and read-only mutations never reach SQL',async()=>{
    const before=api.calls.length;
    assert.equal((await api.request('purchases')).status,401);
    assert.equal((await post(body,reader)).status,403);
    assert.equal(api.calls.length,before);
  });
  await test('API-02 create, edit and response preserve exact pricing and line identity',async()=>{
    const po=await confirmed();
    assert.equal(Number(po.items[0].entered_line_total),250);
    const result=await post({...body,action:'replace_plan',purchase_order_id:po.id,lines:[{...body.lines[0],id:po.items[0].id,line_total:300}]});
    assert.equal(result.status,200);
    assert.equal(result.body.order.items[0].id,po.items[0].id);
    assert.equal(Number(result.body.order.items[0].entered_line_total),300);
  });
  await test('API-03 capabilities distinguish procurement from receiving permission',async()=>{
    const po=await confirmed();
    const read=(await api.request('purchases',{admin:reader,query:{id:po.id}})).body.order;
    assert.equal(read.capabilities.actions.edit.business_allowed,true);
    assert.equal(read.capabilities.actions.edit.allowed,false);
    assert.equal(read.capabilities.actions.receive_remaining.allowed,false);
    const recv=(await api.request('purchases',{admin:receiver,query:{id:po.id}})).body.order;
    assert.equal(recv.capabilities.actions.edit.allowed,false);
    assert.equal(recv.capabilities.actions.receive_remaining.allowed,true);
  });
  await test('API-04 ordinary excess is rejected and explicit boolean approval succeeds',async()=>{
    const po=await confirmed();
    const refused=await post(receiveBody(po));
    assert.equal(refused.status,409);
    assert.equal(refused.body.details.code,'PO_OVER_RECEIPT_REQUIRES_CONFIRMATION');
    assert.equal(Number((await one('select count(*) from warehouse_receipts')).count),0);
    assert.equal((await post(receiveBody(po,true))).status,200);
    const inventory=await api.request('inventory',{admin:master});
    assert.equal(inventory.status,200); assert.equal(inventory.body.inventory[0].physical_quantity,120);
    assert.equal(inventory.body.inventory[0].sources[0].lot_number,'QA-API-LOT');
  });
  await test('API-05 strings, numbers and objects cannot authorize excess receipt',async()=>{
    const po=await confirmed();
    const auditCount=api.audits.length;
    for(const flag of ['false','true',1,{},[]]) {
      const result=await post(receiveBody(po,flag));
      assert.equal(result.status,409,`Excess must require explicit boolean approval: ${JSON.stringify(flag)}`);
    }
    assert.equal(Number((await one('select count(*) from warehouse_receipts')).count),0);
    assert.equal(api.audits.length,auditCount);
  });
  await test('API-06 invalid currency returns a clear input error',async()=>{
    const result=await post({...body,currency:'US'});
    assert.equal(result.status,400); assert.equal(result.body.details.code,'PO_CURRENCY_INVALID');
  });
  await test('API-07 missing warehouse and stale line return clear input errors',async()=>{
    const po=await confirmed();
    const missing=await post({...receiveBody(po),warehouse_id:null});
    assert.equal(missing.status,400); assert.equal(missing.body.details.code,'WAREHOUSE_REQUIRED');
    const stale=await post({...receiveBody(po),lines:[{purchase_order_item_id:'00000000-0000-4000-8000-999999999999',received_quantity:1}]});
    assert.equal(stale.status,400); assert.equal(stale.body.details.code,'PO_ITEM_NOT_FOUND');
  });
  await test('API-08 inventory reconciles two lots, reservations and receipt cancellation',async()=>{
    const po=await confirmed();
    async function receive(quantity,pallets,lot) {
      const payload=receiveBody(po);
      payload.lines[0]={...payload.lines[0],received_quantity:quantity,received_pallets:pallets,lot_number:lot};
      const result=await post(payload);assert.equal(result.status,200);
      return result.body.receipt;
    }
    const a=await receive(40,4,'LOT-A');const b=await receive(60,6,'LOT-B');
    let result=await api.request('inventory',{admin:master});
    assert.equal(result.body.inventory[0].physical_quantity,100);
    assert.equal(result.body.inventory[0].source_count,2);
    const source=await one('select id from warehouse_receipt_items where receipt_id=$1',[a.id]);
    const load=await one('insert into loads(warehouse_id) values($1) returning id',[warehouse]);
    const item=await one("insert into load_items(load_id,product_id,planned_quantity,planned_pallets,unit) values($1,$2,30,3,'cajas') returning id",[load.id,product]);
    await db.query('insert into load_allocations(load_item_id,receipt_item_id,allocated_quantity,allocated_pallets) values($1,$2,30,3)',[item.id,source.id]);
    await db.query('select reserve_load($1)',[load.id]);
    result=await api.request('inventory',{admin:master});
    assert.equal(result.body.inventory[0].reserved_quantity,30);
    assert.equal(result.body.inventory[0].available_quantity,70);
    await db.query('select cancel_warehouse_receipt_canonical($1)',[b.id]);
    result=await api.request('inventory',{admin:master});
    assert.equal(result.body.inventory[0].physical_quantity,40);
    assert.equal(result.body.inventory[0].available_quantity,10);
    assert.equal(result.body.inventory[0].source_count,1);
    assert.equal(result.body.inventory[0].sources[0].lot_number,'LOT-A');
    assert.equal(result.body.totals.available_pallets,1);
  });
  console.log(`Purchase/inventory API acceptance: ${passed} passed, ${failures.length} failed (isolated SQL; auth and transport boundaries simulated).`);
  if(failures.length)process.exitCode=1;
} finally { await db.close(); }
