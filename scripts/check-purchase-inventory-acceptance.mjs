import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createPurchaseAcceptanceDb, purchaseAcceptanceMigrations } from './lib/purchase-acceptance-db.mjs';

const db = await createPurchaseAcceptanceDb();
const one = async (sql, params=[]) => (await db.query(sql,params)).rows[0];
const rows = async (sql, params=[]) => (await db.query(sql,params)).rows;
const number = value => Number(value);
const passed=[];
const failures=[];
const trackedTables=[
  'purchase_orders','purchase_order_items','purchase_receipt_allocations',
  'warehouse_receipts','warehouse_receipt_items','inventory_movements',
  'loads','load_items','load_allocations','supplier_bills','supplier_bill_items',
  'supplier_payments','supplier_payment_applications','sales_procurement_allocations'
];
async function snapshot() {
  const result={};
  for (const table of trackedTables) result[table]=await rows(`select * from public.${table} order by id`);
  return result;
}
async function rejectsWithoutWrites(sql,params,code) {
  const before=await snapshot();
  await db.exec('savepoint expected_failure');
  let error;
  try { await db.query(sql,params); } catch (caught) { error=caught; }
  await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');
  assert.ok(error,`Expected ${code}`);
  assert.ok(error.message.includes(code),`Expected ${code}; received ${error.message}`);
  assert.deepEqual(await snapshot(),before,`${code} must not leave partial writes`);
}
async function test(name,run) {
  await db.exec('begin');
  try { await run(); passed.push(name); console.log(`PASS ${name}`); }
  catch(error) { failures.push({name,error}); console.error(`FAIL ${name}: ${error.message}`); }
  finally { await db.exec('rollback'); }
}

try {
  const supplier=(await one("insert into suppliers(name,country) values('QA supplier A','USA') returning id")).id;
  const supplierB=(await one("insert into suppliers(name,country) values('QA supplier B','USA') returning id")).id;
  const warehouse=(await one("insert into warehouses(code,name,country) values('QA-A','QA warehouse A','USA') returning id")).id;
  const warehouseB=(await one("insert into warehouses(code,name,country) values('QA-B','QA warehouse B','USA') returning id")).id;
  const product=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-A','QA boxes','cajas',10) returning id")).id;
  const productB=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-B','QA sacks','sacos',10) returning id")).id;
  const client=(await one("insert into clients(name) values('QA client') returning id")).id;
  const baseLine={product_id:product,ordered_quantity:100,ordered_pallets:10,units_per_pallet:10,unit_cost:2.5};
  const createSql='select * from create_purchase_order_plan(p_supplier_id=>$1,p_lines=>$2::jsonb,p_warehouse_id=>$3)';
  const revisionSql='select * from replace_purchase_order_plan(p_purchase_order_id=>$1,p_supplier_id=>$2,p_lines=>$3::jsonb,p_warehouse_id=>$4,p_currency=>$5)';
  const receiveSql='select * from receive_purchase_order_lines(p_warehouse_id=>$1,p_lines=>$2::jsonb,p_allow_over_receipt=>$3)';
  const transitionSql='select * from transition_purchase_order($1,$2)';
  const cancelReceiptSql='select * from cancel_warehouse_receipt_canonical($1)';
  const getItems=id=>rows('select * from purchase_order_items where purchase_order_id=$1 order by id',[id]);
  const state=async id=>(await one('select purchase_order_action_state($1) as state',[id])).state;
  const progress=id=>one('select * from purchase_order_progress where purchase_order_id=$1',[id]);
  const itemProgress=id=>one('select * from purchase_order_item_progress where purchase_order_item_id=$1',[id]);
  const balance=id=>one('select * from inventory_source_balances where receipt_item_id=$1',[id]);
  const transition=(po,action)=>one(transitionSql,[po.id,action]);
  async function purchase({lines=[baseLine],supplierId=supplier,warehouseId=warehouse,confirmed=false}={}) {
    const po=await one(createSql,[supplierId,JSON.stringify(lines),warehouseId]);
    if(confirmed) { await transition(po,'issue'); await transition(po,'confirm'); }
    return {...po,items:await getItems(po.id)};
  }
  const revisionLines=po=>po.items.map(item=>({id:item.id,product_id:item.product_id,ordered_quantity:item.ordered_quantity,ordered_pallets:item.ordered_pallets,units_per_pallet:item.units_per_pallet,unit_cost:item.unit_cost,line_total:item.entered_line_total}));
  const revisionParams=(po,lines=revisionLines(po),dest=po.warehouse_id,currency=po.currency,supplierId=po.supplier_id)=>[po.id,supplierId,JSON.stringify(lines),dest,currency];
  const receiptLine=(item,quantity=40,pallets=4,extra={})=>({purchase_order_item_id:item.id,received_quantity:quantity,received_pallets:pallets,lot_number:'QA-LOT-A',...extra});
  async function receive(po,quantity=40,pallets=4,extra={}) {
    const receipt=await one(receiveSql,[po.warehouse_id,JSON.stringify([receiptLine(po.items[0],quantity,pallets,extra)]),false]);
    return {...receipt,items:await rows('select * from warehouse_receipt_items where receipt_id=$1',[receipt.id])};
  }
  async function supply(po,method='purchase_direct') {
    const so=await one('select * from create_sales_order_plan(p_client_id=>$1,p_lines=>$2::jsonb)',[client,JSON.stringify([{product_id:product,ordered_quantity:100,ordered_pallets:10,unit_price:4}])]);
    await one('select * from transition_sales_order($1,$2)',[so.id,'confirm']);
    const item=await one('select * from sales_order_items where sales_order_id=$1',[so.id]);
    const plan=await one('insert into sales_supply_plan_lines(sales_order_item_id,supply_method,warehouse_id,planned_quantity,planned_pallets) values($1,$2,$3,100,10) returning *',[item.id,method,method==='purchase_direct'?null:warehouse]);
    const allocation=await one('insert into sales_procurement_allocations(supply_plan_line_id,purchase_order_item_id,allocated_sales_quantity,allocated_sales_pallets,allocated_purchase_quantity,allocated_purchase_pallets) values($1,$2,100,10,100,10) returning *',[plan.id,po.items[0].id]);
    return {so,item,plan,allocation};
  }

  await test('PO-01 purchase and exact line total do not create stock',async()=>{
    const po=await purchase({lines:[{...baseLine,ordered_quantity:840,ordered_pallets:28,units_per_pallet:30,unit_cost:null,line_total:1000}]});
    assert.equal(po.status,'draft');
    assert.equal(number(po.items[0].entered_line_total),1000);
    assert.ok(Math.abs(number(po.items[0].unit_cost)-1000/840)<1e-12);
    assert.equal(number((await one('select sum(coalesce(entered_line_total,ordered_quantity*unit_cost)) as total from purchase_order_items where purchase_order_id=$1',[po.id])).total),1000);
    assert.equal((await rows('select * from inventory_source_balances')).length,0);
    assert.equal((await rows('select * from warehouse_receipts')).length,0);
  });
  await test('PO-02 invalid lines roll back the entire purchase',async()=>{
    for(const [line,code] of [[{...baseLine,ordered_quantity:-1},'PO_QUANTITY_INVALID'],[{...baseLine,ordered_quantity:99},'PO_QUANTITY_PALLET_MISMATCH'],[{...baseLine,line_total:-1},'PO_LINE_TOTAL_INVALID']])
      await rejectsWithoutWrites(createSql,[supplier,JSON.stringify([baseLine,line]),warehouse],code);
  });
  await test('PO-03 inactive masters and invalid status transitions are blocked',async()=>{
    await db.query('update products set active=false where id=$1',[product]);
    await rejectsWithoutWrites(createSql,[supplier,JSON.stringify([baseLine]),warehouse],'PO_PRODUCT_INACTIVE');
    await db.query('update products set active=true where id=$1',[product]);
    const po=await purchase();
    await rejectsWithoutWrites(transitionSql,[po.id,'confirm'],'PO_NOT_ISSUED');
    await rejectsWithoutWrites(receiveSql,[warehouse,JSON.stringify([receiptLine(po.items[0])]),false],'PO_NOT_RECEIVABLE');
    await transition(po,'issue'); await transition(po,'confirm');
    assert.equal((await state(po.id)).commercial_status,'confirmed');
    await rejectsWithoutWrites(transitionSql,[po.id,'issue'],'PO_NOT_DRAFT');
  });
  await test('PO-04 draft revision is atomic and can change product and destination',async()=>{
    const po=await purchase();
    await rejectsWithoutWrites(revisionSql,revisionParams(po,[{...baseLine,ordered_quantity:-1}],warehouseB),'PO_QUANTITY_INVALID');
    await one(revisionSql,revisionParams(po,[{...baseLine,product_id:productB}],null,'EUR',supplierB));
    const edited=await one('select * from purchase_orders where id=$1',[po.id]);
    assert.equal(edited.warehouse_id,null); assert.equal(edited.supplier_id,supplierB);
    assert.equal((await getItems(po.id))[0].product_id,productB);
    assert.equal((await getItems(po.id))[0].currency,'EUR');
  });
  await test('WR-01 partial receipt creates one physical source and preserves lot and cost',async()=>{
    const po=await purchase({confirmed:true});
    const wr=await receive(po,0,4,{net_weight_kg:80,gross_weight_kg:90});
    assert.equal(number(wr.items[0].quantity),40); assert.equal(wr.items[0].lot_number,'QA-LOT-A');
    assert.equal(number(wr.items[0].unit_cost),2.5);
    assert.equal(number((await balance(wr.items[0].id)).physical_quantity),40);
    const ip=await itemProgress(po.items[0].id);
    assert.equal(ip.receipt_status,'partial'); assert.equal(number(ip.remaining_quantity),60);
    assert.equal((await rows('select * from inventory_traceability where receipt_id=$1',[wr.id])).length,1);
  });
  await test('WR-02 invalid later line leaves no header, items or allocations',async()=>{
    const po=await purchase({confirmed:true});
    await rejectsWithoutWrites(receiveSql,[warehouse,JSON.stringify([receiptLine(po.items[0],20,2),receiptLine(po.items[0],10,1,{net_weight_kg:20,gross_weight_kg:10})]),false],'WR_GROSS_WEIGHT_LT_NET');
    await rejectsWithoutWrites(receiveSql,[warehouse,JSON.stringify([receiptLine(po.items[0],19,2)]),false],'WR_QUANTITY_PALLET_MISMATCH');
  });
  await test('WR-03 warehouse and supplier mixing are rejected atomically',async()=>{
    const a=await purchase({confirmed:true});
    const b=await purchase({confirmed:true,supplierId:supplierB});
    await rejectsWithoutWrites(receiveSql,[warehouseB,JSON.stringify([receiptLine(a.items[0])]),false],'PO_WR_WAREHOUSE_MISMATCH');
    await rejectsWithoutWrites(receiveSql,[warehouse,JSON.stringify([receiptLine(a.items[0]),receiptLine(b.items[0])]),false],'PO_RECEIPT_MULTIPLE_SUPPLIERS');
  });
  await test('WR-04 one supplier can receive two purchases in one traceable WR',async()=>{
    const a=await purchase({confirmed:true}); const b=await purchase({confirmed:true});
    const wr=await one(receiveSql,[warehouse,JSON.stringify([receiptLine(a.items[0],100,10),receiptLine(b.items[0],100,10,{lot_number:'QA-LOT-B'})]),false]);
    assert.ok(wr.reference_number.includes(a.po_number)); assert.ok(wr.reference_number.includes(b.po_number));
    assert.equal((await rows('select * from warehouse_receipt_items where receipt_id=$1',[wr.id])).length,2);
    assert.equal((await progress(a.id)).receipt_status,'received'); assert.equal((await progress(b.id)).receipt_status,'received');
    assert.equal(number((await one('select sum(physical_quantity) as quantity from inventory_source_balances')).quantity),200);
  });
  await test('WR-05 excess requires confirmation including repeated lines in one request',async()=>{
    const po=await purchase({confirmed:true});
    const lines=JSON.stringify([receiptLine(po.items[0],60,6),receiptLine(po.items[0],60,6)]);
    await rejectsWithoutWrites(receiveSql,[warehouse,lines,false],'PO_OVER_RECEIPT_REQUIRES_CONFIRMATION');
    await one(receiveSql,[warehouse,lines,true]);
    const ip=await itemProgress(po.items[0].id);
    assert.equal(number(ip.received_quantity),120); assert.equal(number(ip.excess_quantity),20);
    assert.equal(ip.has_excess,true);
    await rejectsWithoutWrites(receiveSql,[warehouse,JSON.stringify([receiptLine(po.items[0],10,1)]),false],'PO_ALREADY_FULLY_RECEIVED');
    await one(receiveSql,[warehouse,JSON.stringify([receiptLine(po.items[0],10,1)]),true]);
    assert.equal(number((await itemProgress(po.items[0].id)).received_quantity),130);
  });
  await test('PO-05 confirmed corrections preserve receipt history and committed quantities',async()=>{
    const po=await purchase({confirmed:true}); const wr=await receive(po);
    const revised=revisionLines(po).map(l=>({...l,ordered_quantity:120,ordered_pallets:12,unit_cost:3}));
    await one(revisionSql,revisionParams(po,revised));
    assert.equal((await getItems(po.id))[0].id,po.items[0].id);
    assert.equal(number((await one('select unit_cost from warehouse_receipt_items where id=$1',[wr.items[0].id])).unit_cost),2.5);
    await rejectsWithoutWrites(revisionSql,revisionParams(po,[{...revised[0],ordered_quantity:30,ordered_pallets:3}]),'PO_QUANTITY_BELOW_COMMITTED');
    await rejectsWithoutWrites(revisionSql,revisionParams(po,[{...revised[0],ordered_pallets:6,units_per_pallet:20}]),'PO_RECEIVED_MEASURE_LOCKED');
    await rejectsWithoutWrites(revisionSql,revisionParams(po,revised,warehouseB),'PO_DESTINATION_LOCKED');
    await rejectsWithoutWrites(revisionSql,revisionParams(po,revised,warehouse,'EUR'),'PO_CONFIRMED_CURRENCY_LOCKED');
    await rejectsWithoutWrites(revisionSql,revisionParams(po,revised,warehouse,'USD',supplierB),'PO_CONFIRMED_SUPPLIER_LOCKED');
    await rejectsWithoutWrites(revisionSql,revisionParams(po,[{...revised[0],product_id:productB}]),'PO_CONFIRMED_STRUCTURE_LOCKED');
    assert.equal(number((await itemProgress(po.items[0].id)).remaining_quantity),80);
  });
  await test('WR-06 cancellation removes stock, reopens pending quantity and preserves links',async()=>{
    const po=await purchase({confirmed:true}); const wr=await receive(po,100,10);
    await rejectsWithoutWrites(transitionSql,[po.id,'cancel'],'PO_HAS_ACTIVE_RECEIPTS');
    await one(cancelReceiptSql,[wr.id]);
    assert.equal((await rows('select * from inventory_source_balances')).length,0);
    assert.equal(number((await itemProgress(po.items[0].id)).remaining_quantity),100);
    assert.equal((await rows('select * from purchase_receipt_allocations')).length,1);
    await rejectsWithoutWrites(cancelReceiptSql,[wr.id],'WR_NOT_RECEIVED');
    await transition(po,'cancel');
    assert.equal((await state(po.id)).commercial_status,'cancelled');
    await rejectsWithoutWrites(revisionSql,revisionParams(po),'PO_NOT_EDITABLE');
  });
  await test('WR-07 active load and reservation history protect the source receipt',async()=>{
    const po=await purchase({confirmed:true}); const wr=await receive(po,100,10);
    const load=await one('insert into loads(warehouse_id) values($1) returning *',[warehouse]);
    const li=await one('insert into load_items(load_id,product_id,planned_quantity,planned_pallets,unit) values($1,$2,40,4,$3) returning *',[load.id,product,'cajas']);
    await one('insert into load_allocations(load_item_id,receipt_item_id,allocated_quantity,allocated_pallets) values($1,$2,40,4) returning *',[li.id,wr.items[0].id]);
    await rejectsWithoutWrites(cancelReceiptSql,[wr.id],'WR_ASSIGNED_TO_LOAD');
    await one('select * from reserve_load($1)',[load.id]);
    assert.equal(number((await balance(wr.items[0].id)).physical_quantity),100);
    assert.equal(number((await balance(wr.items[0].id)).reserved_quantity),40);
    await one('select * from release_load($1)',[load.id]);
    assert.equal(number((await balance(wr.items[0].id)).reserved_quantity),0);
    await rejectsWithoutWrites(cancelReceiptSql,[wr.id],'WR_HAS_INVENTORY_HISTORY');
  });
  await test('DS-01 Direct Ship never receives into warehouse or creates own stock',async()=>{
    const po=await purchase({confirmed:true,warehouseId:null});
    assert.equal((await state(po.id)).actions.receive_remaining.reason,'PO_DIRECT_SHIP_NO_WR');
    await rejectsWithoutWrites(receiveSql,[warehouse,JSON.stringify([receiptLine(po.items[0])]),false],'PO_DIRECT_SHIP_NO_WR');
    assert.equal((await rows('select * from inventory_source_balances')).length,0);
  });
  await test('DS-02 cancellation releases sales links before any container is assigned',async()=>{
    const po=await purchase({confirmed:true,warehouseId:null}); const linked=await supply(po);
    assert.equal((await state(po.id)).actions.cancel.releases_sales_links,true);
    await rejectsWithoutWrites(revisionSql,revisionParams(po,revisionLines(po),warehouse),'PO_DESTINATION_LOCKED');
    await transition(po,'cancel');
    assert.equal((await rows('select * from sales_procurement_allocations')).length,0);
    assert.equal((await one('select status from sales_orders where id=$1',[linked.so.id])).status,'confirmed');
    assert.equal((await rows('select * from inventory_source_balances')).length,0);
  });
  await test('DS-03 assigned Direct Ship container blocks purchase cancellation',async()=>{
    const po=await purchase({confirmed:true,warehouseId:null}); const linked=await supply(po);
    const shipment=await one("insert into shipments(container_number,client_id) values('QAAA1234567',$1) returning *",[client]);
    await one('insert into direct_shipment_allocations(sales_procurement_allocation_id,shipment_id,allocated_sales_quantity,allocated_sales_pallets,allocated_purchase_quantity,allocated_purchase_pallets) values($1,$2,100,10,100,10) returning *',[linked.allocation.id,shipment.id]);
    await rejectsWithoutWrites(transitionSql,[po.id,'cancel'],'PO_HAS_DIRECT_SHIPMENTS');
    assert.equal((await state(po.id)).actions.cancel.allowed,false);
    assert.equal((await rows('select * from inventory_source_balances')).length,0);
  });
  await test('AP-01 purchase cancellation preserves bills, payments and supplier balance',async()=>{
    const po=await purchase({confirmed:true});
    const bill=await one('select * from create_supplier_bill_plan($1,$2::jsonb,$3)',[po.id,JSON.stringify([{purchase_order_item_id:po.items[0].id,billed_quantity:60,line_total:150}]),'QA-AP-01']);
    await one('select * from transition_supplier_bill($1,$2)',[bill.id,'post']);
    const payment=await one('select * from register_supplier_payment($1,$2)',[po.id,40]);
    await one('select * from replace_supplier_payment_applications($1,$2::jsonb)',[payment.id,JSON.stringify([{supplier_bill_id:bill.id,amount:40}])]);
    await rejectsWithoutWrites(revisionSql,revisionParams(po,[{...revisionLines(po)[0],ordered_quantity:50,ordered_pallets:5}]),'PO_QUANTITY_BELOW_COMMITTED');
    const before=await one('select * from supplier_bill_financial_progress where supplier_bill_id=$1',[bill.id]);
    assert.equal(number(before.bill_total),150); assert.equal(number(before.balance_due),110);
    await transition(po,'cancel');
    assert.deepEqual(await one('select * from supplier_bill_financial_progress where supplier_bill_id=$1',[bill.id]),before);
    assert.equal((await one('select status from supplier_payments where id=$1',[payment.id])).status,'posted');
  });
  await test('PO-06 closed purchases reject subsequent revisions and receipts',async()=>{
    const po=await purchase({confirmed:true}); await transition(po,'close');
    await rejectsWithoutWrites(revisionSql,revisionParams(po),'PO_NOT_EDITABLE');
    await rejectsWithoutWrites(receiveSql,[warehouse,JSON.stringify([receiptLine(po.items[0])]),false],'PO_NOT_RECEIVABLE');
    await rejectsWithoutWrites(transitionSql,[po.id,'cancel'],'PO_CANNOT_CANCEL');
  });

  for(const file of ['ux5_purchase_order_actions.sql','ux5_warehouse_receipt_actions.sql']) {
    try {
      const results=await db.exec(fs.readFileSync(`supabase/tests/${file}`,'utf8'));
      assert.ok(Object.values(results.at(-1).rows[0]).every(value=>number(value)===0),'Legacy fixture must leave zero residue');
      passed.push(file); console.log(`PASS ${file}`);
    } catch(error) {
      await db.exec('rollback'); failures.push({name:file,error}); console.error(`FAIL ${file}: ${error.message}`);
    }
  }
  for(const table of trackedTables) assert.equal((await rows(`select * from ${table}`)).length,0,`${table}: all business fixtures rolled back`);
  console.log(`Purchase/inventory acceptance: ${passed.length} passed, ${failures.length} failed; ${purchaseAcceptanceMigrations.length} real migrations; no network or production writes.`);
  if(failures.length) process.exitCode=1;
} finally {
  await db.close();
}
