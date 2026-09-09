import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createSalesLogisticsAcceptanceDb, salesLogisticsAcceptanceMigrations } from './lib/sales-logistics-acceptance-db.mjs';

const db = await createSalesLogisticsAcceptanceDb();
const rows = async (sql, params=[]) => (await db.query(sql,params)).rows;
const one = async (sql, params=[]) => (await rows(sql,params))[0];
const n = Number;
const passed=[], failures=[];
const tables=['sales_orders','sales_order_items','sales_fulfillment_allocations',
  'purchase_orders','purchase_order_items','purchase_receipt_allocations','warehouse_receipts',
  'warehouse_receipt_items','inventory_movements','loads','load_items','load_allocations',
  'sales_supply_plan_lines','sales_procurement_allocations','direct_shipment_allocations',
  'direct_shipment_dispatches','shipments','shipment_history','documents','customer_advances'];
async function snapshot() {
  const result={};
  for(const table of tables) result[table]=await rows(`select to_jsonb(t) as row from ${table} t order by to_jsonb(t)::text`);
  return result;
}
async function rejects(sql,params,code) {
  const before=await snapshot();
  await db.exec('savepoint expected_failure');
  let error;
  try { await db.query(sql,params); } catch(caught) { error=caught; }
  await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure');
  assert.ok(error,`Expected rejection: ${code}`);
  assert.ok(error.message.includes(code),`Expected ${code}; received ${error.message}`);
  assert.deepEqual(await snapshot(),before,`${code}: no partial business writes`);
}
async function test(name,run) {
  await db.exec('begin');
  try { await run(); passed.push(name); console.log(`PASS ${name}`); }
  catch(error) { failures.push(name); console.error(`FAIL ${name}: ${error.message}`); }
  finally { await db.exec('rollback'); }
}

try {
  const supplier=(await one("insert into suppliers(name,country) values('QA supplier','USA') returning id")).id;
  const warehouse=(await one("insert into warehouses(code,name,country) values('QA-SL-A','QA origin','USA') returning id")).id;
  const warehouseB=(await one("insert into warehouses(code,name,country) values('QA-SL-B','QA other origin','USA') returning id")).id;
  const product=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-SL-A','QA boxes','cajas',10) returning id")).id;
  const productB=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-SL-B','QA other boxes','cajas',10) returning id")).id;
  const client=(await one("insert into clients(name) values('QA customer A') returning id")).id;
  const clientB=(await one("insert into clients(name) values('QA customer B') returning id")).id;
  const importer=(await one("insert into importers(name) values('QA importer') returning id")).id;
  await db.query('insert into client_importers(client_id,importer_id) values($1,$2)',[client,importer]);
  const baseLine={product_id:product,ordered_quantity:100,ordered_pallets:10,units_per_pallet:10,unit_price:4};
  const saleSql='select * from create_sales_order_plan(p_client_id=>$1,p_lines=>$2::jsonb,p_importer_id=>$3)';
  const transitionSql='select * from transition_sales_order($1,$2)';
  const salesLoadSql='select * from create_load_from_sales_order($1,$2,$3::jsonb)';
  const loadSql='select * from create_load_plan($1,$2::jsonb)';
  const actionSql='select * from execute_load_action($1,$2)';
  const containerSql='select * from create_load_shipment_canonical(p_load_id=>$1,p_container_number=>$2,p_client_id=>$3,p_importer_id=>$4)';
  const planSql="insert into sales_supply_plan_lines(sales_order_item_id,supply_method,planned_quantity,planned_pallets) values($1,'purchase_direct',$2,$3) returning *";
  const directAllocationSql='insert into direct_shipment_allocations(sales_procurement_allocation_id,shipment_id,allocated_sales_quantity,allocated_sales_pallets,allocated_purchase_quantity,allocated_purchase_pallets) values($1,$2,$3,$4,$3,$4) returning *';
  const dispatchDirectSql='select * from mark_direct_shipment_dispatched($1)';
  const docSql="select * from create_shipment_customs_document($1,$2,$3,$4,'erp-documents',$5,'application/pdf',100,null,null,'QA')";
  const deleteDocSql="select * from soft_delete_shipment_customs_document($1,null,'QA')";
  const progress=id=>one('select * from sales_order_item_progress where sales_order_item_id=$1',[id]);
  const balance=id=>one('select * from inventory_source_balances where receipt_item_id=$1',[id]);
  const readiness=id=>one('select * from shipment_customs_document_readiness where shipment_id=$1',[id]);
  const saleState=async id=>(await one('select sales_order_action_state($1) as state',[id])).state;
  const loadState=async id=>(await one('select load_action_state($1) as state',[id])).state;
  async function sale({lines=[baseLine],confirmed=true,clientId=client,importerId=importer}={}) {
    const so=await one(saleSql,[clientId,JSON.stringify(lines),importerId]);
    if(confirmed) await one(transitionSql,[so.id,'confirm']);
    return {...so,items:await rows('select * from sales_order_items where sales_order_id=$1 order by id',[so.id])};
  }
  async function purchase({direct=false,productId=product}={}) {
    const po=await one('select * from create_purchase_order_plan(p_supplier_id=>$1,p_lines=>$2::jsonb,p_warehouse_id=>$3)',
      [supplier,JSON.stringify([{...baseLine,product_id:productId,unit_cost:2.5}]),direct?null:warehouse]);
    await one('select * from transition_purchase_order($1,$2)',[po.id,'issue']);
    await one('select * from transition_purchase_order($1,$2)',[po.id,'confirm']);
    return {...po,item:await one('select * from purchase_order_items where purchase_order_id=$1',[po.id])};
  }
  async function stock(productId=product) {
    const po=await purchase({productId});
    const wr=await one('select * from receive_purchase_order_lines($1,$2::jsonb)',[warehouse,JSON.stringify([{purchase_order_item_id:po.item.id,received_quantity:100,received_pallets:10,lot_number:'QA-SL-LOT'}])]);
    return {...wr,item:await one('select * from warehouse_receipt_items where receipt_id=$1',[wr.id])};
  }
  const allocation=(wr,quantity=100)=>({receipt_item_id:wr.item.id,allocated_quantity:quantity,allocated_pallets:quantity/10});
  const salesLines=(so,wr,quantity=100)=>[{sales_order_item_id:so.items[0].id,allocations:[allocation(wr,quantity)]}];
  const loadLines=(wr,quantity=100)=>[{product_id:wr.item.product_id,allocations:[allocation(wr,quantity)]}];
  const salesLoad=(so,wr,quantity=100)=>one(salesLoadSql,[so.id,warehouse,JSON.stringify(salesLines(so,wr,quantity))]);
  const action=(load,kind)=>one(actionSql,[load.id,kind]);
  let containerSequence=0;
  const reference=()=>`QA-SL-${++containerSequence}`;
  const shipment=()=>one('insert into shipments(container_number,client_id,importer_id) values($1,$2,$3) returning *',[reference(),client,importer]);
  const container=load=>one(containerSql,[load.id,reference(),null,null]);
  const document=(sh,type='Packing List Cuba')=>one(docSql,[sh.id,client,type,'qa.pdf',`qa/${reference()}.pdf`]);
  async function loaded(load) { for(const kind of ['reserve','start_loading','mark_loaded']) await action(load,kind); }
  async function direct(so,quantity=100) {
    const po=await purchase({direct:true});
    const plan=await one(planSql,[so.items[0].id,quantity,quantity/10]);
    const procurement=await one('insert into sales_procurement_allocations(supply_plan_line_id,purchase_order_item_id,allocated_sales_quantity,allocated_sales_pallets,allocated_purchase_quantity,allocated_purchase_pallets) values($1,$2,$3,$4,$3,$4) returning *',[plan.id,po.item.id,quantity,quantity/10]);
    const sh=await shipment();
    const allocation=await one(directAllocationSql,[procurement.id,sh.id,quantity,quantity/10]);
    return {po,plan,procurement,sh,allocation};
  }

  await test('SO-01 draft sale preserves exact total and creates no stock',async()=>{
    const so=await sale({confirmed:false,lines:[{...baseLine,ordered_quantity:840,ordered_pallets:28,units_per_pallet:30,line_total:1000}]});
    assert.equal(n((await progress(so.items[0].id)).line_total),1000);
    assert.ok(Math.abs(n(so.items[0].unit_price)-1000/840)<1e-12);
    assert.equal((await rows('select * from inventory_source_balances')).length,0);
    assert.equal((await saleState(so.id)).actions.confirm.allowed,true);
  });
  await test('SO-02 a bad later line rolls back creation and draft replacement',async()=>{
    const invalid=[baseLine,{...baseLine,unit_price:-1}];
    await rejects(saleSql,[client,JSON.stringify(invalid),importer],'SO_UNIT_PRICE_INVALID');
    const so=await sale({confirmed:false});
    await rejects('select * from replace_sales_order_plan(p_sales_order_id=>$1,p_client_id=>$2,p_lines=>$3::jsonb,p_importer_id=>$4)',[so.id,client,JSON.stringify(invalid),importer],'SO_UNIT_PRICE_INVALID');
    await one('select * from replace_sales_order_plan(p_sales_order_id=>$1,p_client_id=>$2,p_lines=>$3::jsonb,p_importer_id=>$4)',[so.id,client,JSON.stringify([{...baseLine,line_total:425}]),importer]);
    assert.equal(n((await one('select line_total from sales_order_item_progress where sales_order_id=$1',[so.id])).line_total),425);
  });
  await test('SO-03 confirmation locks editing and rechecks active customer',async()=>{
    const so=await sale({confirmed:false});
    await db.query('update clients set active=false where id=$1',[client]);
    await rejects(transitionSql,[so.id,'confirm'],'SO_CLIENT_INACTIVE');
    await db.query('update clients set active=true where id=$1',[client]);
    await one(transitionSql,[so.id,'confirm']);
    await rejects('select * from replace_sales_order_plan($1,$2,$3::jsonb)',[so.id,client,JSON.stringify([baseLine])],'SO_NOT_DRAFT');
    await rejects(transitionSql,[so.id,'close'],'SO_NOT_FULLY_DISPATCHED');
  });
  await test('LD-01 sale load carries customer, importer, source lot and quantities',async()=>{
    const so=await sale(), wr=await stock(), load=await salesLoad(so,wr,40);
    assert.equal(load.client_id,client); assert.equal(load.importer_id,importer);
    const trace=await one('select * from sales_order_workspace_logistics where sales_order_id=$1',[so.id]);
    assert.deepEqual(trace.warehouse_receipt_ids,[wr.id]); assert.equal(n(trace.allocated_quantity),40);
    assert.equal(n((await balance(wr.item.id)).reserved_quantity),0);
    assert.equal(n((await progress(so.items[0].id)).planned_quantity),40);
    await rejects(transitionSql,[so.id,'cancel'],'SO_HAS_ACTIVE_LOAD_ALLOCATIONS');
  });
  await test('LD-02 wrong product, wrong warehouse and duplicate sale lines leave no load',async()=>{
    const so=await sale(), wr=await stock(), other=await stock(productB);
    await rejects(salesLoadSql,[so.id,warehouse,JSON.stringify(salesLines(so,other))],'LOAD_ALLOCATION_PRODUCT_MISMATCH');
    await rejects(salesLoadSql,[so.id,warehouseB,JSON.stringify(salesLines(so,wr))],'LOAD_ALLOCATION_WAREHOUSE_MISMATCH');
    const line=salesLines(so,wr)[0];
    await rejects(salesLoadSql,[so.id,warehouse,JSON.stringify([line,line])],'SO_LOAD_DUPLICATE_SALES_ITEM');
  });
  await test('LD-03 a second load cannot overcommit the sale',async()=>{
    const so=await sale(), wr=await stock(); await salesLoad(so,wr,60);
    await rejects(salesLoadSql,[so.id,warehouse,JSON.stringify(salesLines(so,wr,50))],'SO_ALLOCATION_CONFLICTS_WITH_DIRECT_SUPPLY');
    assert.equal(n((await progress(so.items[0].id)).unallocated_quantity),40);
  });
  await test('LD-04 reserve, release and cancel preserve physical stock and release availability',async()=>{
    const so=await sale(), wr=await stock(), load=await salesLoad(so,wr,40);
    await action(load,'reserve');
    let b=await balance(wr.item.id); assert.equal(n(b.physical_quantity),100); assert.equal(n(b.reserved_quantity),40);
    await rejects(actionSql,[load.id,'reserve'],'LOAD_NOT_DRAFT');
    await action(load,'release'); assert.equal(n((await balance(wr.item.id)).reserved_quantity),0);
    await action(load,'reserve'); await action(load,'cancel');
    b=await balance(wr.item.id); assert.equal(n(b.physical_quantity),100); assert.equal(n(b.reserved_quantity),0);
    assert.equal(n((await progress(so.items[0].id)).unallocated_quantity),100);
    await one(transitionSql,[so.id,'cancel']);
  });
  await test('LD-05 two loads compete for availability without allowing negative stock',async()=>{
    const a=await sale(), b=await sale(), wr=await stock();
    const la=await salesLoad(a,wr,60), lb=await salesLoad(b,wr,60);
    await action(la,'reserve');
    await rejects(actionSql,[lb.id,'reserve'],'INSUFFICIENT_WR_AVAILABLE_BALANCE');
    await action(la,'release'); await action(lb,'reserve');
    assert.equal(n((await balance(wr.item.id)).reserved_quantity),60);
  });
  await test('LD-06 loading can precede container assignment; dispatch requires a container',async()=>{
    const so=await sale(), wr=await stock(), load=await salesLoad(so,wr);
    await loaded(load);
    assert.equal((await loadState(load.id)).status,'loaded');
    await rejects(actionSql,[load.id,'dispatch'],'LOAD_HAS_NO_CONTAINER');
    await rejects(actionSql,[load.id,'cancel'],'LOAD_CANNOT_BE_CANCELLED');
    await rejects(actionSql,[load.id,'release'],'LOAD_NOT_RESERVED');
    assert.equal(n((await balance(wr.item.id)).physical_quantity),100);
  });
  await test('LD-07 dispatch moves stock once, fulfills the sale and makes the load final',async()=>{
    const so=await sale(), wr=await stock(), load=await salesLoad(so,wr), sh=await container(load);
    assert.equal(sh.client_id,client); assert.equal(sh.importer_id,importer);
    assert.equal(sh.product,'QA boxes'); assert.equal(n(sh.quantity),100); assert.equal(sh.quantity_unit,'cajas');
    await loaded(load); await action(load,'dispatch');
    const b=await balance(wr.item.id); assert.equal(n(b.physical_quantity),0); assert.equal(n(b.reserved_quantity),0);
    assert.equal((await progress(so.items[0].id)).is_fully_dispatched,true);
    await rejects(actionSql,[load.id,'dispatch'],'LOAD_NOT_LOADED');
    await rejects(actionSql,[load.id,'unassign_container'],'LOAD_SHIPMENT_LOCKED_BY_STATUS');
    assert.equal((await readiness(sh.id)).document_status,'pending');
    await one(transitionSql,[so.id,'close']); assert.equal((await saleState(so.id)).commercial_status,'closed');
    assert.equal((await rows("select * from inventory_movements where movement_type='dispatch'")).length,1);
  });
  await test('LD-08 partial dispatch leaves the remaining sale open',async()=>{
    const so=await sale(), wr=await stock(), load=await salesLoad(so,wr,40);
    await container(load); await loaded(load); await action(load,'dispatch');
    const p=await progress(so.items[0].id); assert.equal(n(p.dispatched_quantity),40); assert.equal(n(p.remaining_to_dispatch_quantity),60);
    await rejects(transitionSql,[so.id,'close'],'SO_NOT_FULLY_DISPATCHED');
    assert.equal(n((await balance(wr.item.id)).physical_quantity),60);
  });
  await test('CT-01 container normalization and customer mismatch guards',async()=>{
    const so=await sale(), wr=await stock(), load=await salesLoad(so,wr);
    await rejects(containerSql,[load.id,'QA CUSTOMER',clientB,null],'LOAD_SHIPMENT_CLIENT_MISMATCH');
    await rejects(containerSql,[load.id,'!invalid',null,null],'CONTAINER_REFERENCE_INVALID');
    const sh=await one(containerSql,[load.id,'  abcd1234567  ',null,null]);
    assert.equal(sh.container_number,'ABCD1234567'); assert.equal(sh.shipsgo_status,'pending');
    await rejects(containerSql,[load.id,'QA SECOND',null,null],'LOAD_ALREADY_HAS_CONTAINER');
    await rejects('update shipments set delivered_at=now() where id=$1',[sh.id],'LOAD_NOT_DISPATCHED');
    await rejects('update shipments set quantity=1 where id=$1',[sh.id],'LOAD_SHIPMENT_MERCHANDISE_DERIVED');
  });
  await test('CT-02 an inactive container cannot be assigned',async()=>{
    const wr=await stock(), load=await one(loadSql,[warehouse,JSON.stringify(loadLines(wr))]), sh=await shipment();
    await db.query('update shipments set active=false where id=$1',[sh.id]);
    await rejects('select * from assign_load_shipment_canonical($1,$2)',[load.id,sh.id],'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD');
  });
  await test('SO-04 existing standalone load links once and inherits the sale context',async()=>{
    const so=await sale(), wr=await stock(), load=await one(loadSql,[warehouse,JSON.stringify(loadLines(wr))]);
    assert.equal((await rows('select * from sales_order_linkable_existing_loads($1)',[so.id])).length,1);
    await one('select * from link_existing_load_to_sales_order($1,$2)',[so.id,load.id]);
    assert.equal((await one('select client_id from loads where id=$1',[load.id])).client_id,client);
    assert.equal(n((await progress(so.items[0].id)).planned_quantity),100);
    await rejects('select * from link_existing_load_to_sales_order($1,$2)',[so.id,load.id],'SO_NO_UNALLOCATED_FULFILLMENT');
  });
  await test('SO-05 a posted advance blocks cancellation; reversing it restores the action',async()=>{
    const so=await sale();
    const advance=await one('select * from register_customer_advance($1,$2)',[so.id,50]);
    await rejects(transitionSql,[so.id,'cancel'],'SO_HAS_ACTIVE_CUSTOMER_ADVANCE');
    await one('select * from reverse_customer_advance($1,$2)',[advance.id,'QA reversal']);
    await one(transitionSql,[so.id,'cancel']);
    assert.equal((await one('select status from customer_advances where id=$1',[advance.id])).status,'reversed');
  });
  await test('DS-01 Direct Ship dispatch fulfills the sale with no warehouse stock',async()=>{
    const so=await sale(), ds=await direct(so);
    assert.equal((await readiness(ds.sh.id)).document_status,'not_required');
    await one(dispatchDirectSql,[ds.sh.id]);
    assert.equal((await progress(so.items[0].id)).is_fully_dispatched,true);
    assert.equal((await readiness(ds.sh.id)).document_status,'pending');
    assert.equal((await rows('select * from warehouse_receipts')).length,0);
    assert.equal((await rows('select * from inventory_movements')).length,0);
    assert.equal((await rows("select * from shipment_history where event_type='direct_shipment_dispatched'")).length,1);
    await one(transitionSql,[so.id,'close']);
  });
  await test('DS-02 dispatched Direct Ship cannot dispatch twice or change allocations',async()=>{
    const so=await sale(), ds=await direct(so); await one(dispatchDirectSql,[ds.sh.id]);
    await rejects(dispatchDirectSql,[ds.sh.id],'DIRECT_SHIPMENT_ALREADY_DISPATCHED');
    await rejects('delete from direct_shipment_allocations where id=$1',[ds.allocation.id],'DIRECT_SHIPMENT_ALREADY_DISPATCHED');
    await rejects('update direct_shipment_allocations set allocated_sales_quantity=90 where id=$1',[ds.allocation.id],'DIRECT_SHIPMENT_ALREADY_DISPATCHED');
  });
  await test('DS-03 direct supply and warehouse loads cannot overcommit in either order',async()=>{
    const so=await sale(), wr=await stock(); await salesLoad(so,wr,60);
    await rejects(planSql,[so.items[0].id,50,5],'SUPPLY_DIRECT_CONFLICTS_WITH_LOAD');
    const soB=await sale(); await one(planSql,[soB.items[0].id,60,6]);
    await rejects(salesLoadSql,[soB.id,warehouse,JSON.stringify(salesLines(soB,wr,50))],'SO_ALLOCATION_CONFLICTS_WITH_DIRECT_SUPPLY');
  });
  await test('DS-04 empty containers cannot dispatch as Direct Ship',async()=>{
    const sh=await shipment();
    await rejects(dispatchDirectSql,[sh.id],'DIRECT_SHIPMENT_HAS_NO_ALLOCATIONS');
  });
  await test('DOC-01 official current documents resolve pending customs requirements',async()=>{
    const sh=await shipment(); await db.query("update shipments set departure_date='2026-09-09' where id=$1",[sh.id]);
    assert.deepEqual((await readiness(sh.id)).missing_documents,['Packing List Cuba','Commercial Invoice Cuba']);
    await document(sh); assert.deepEqual((await readiness(sh.id)).missing_documents,['Commercial Invoice Cuba']);
    await document(sh,'Factura Comercial Cuba');
    const state=await readiness(sh.id); assert.equal(state.document_status,'ready'); assert.equal(n(state.current_official_document_count),2);
  });
  await test('DOC-02 replacing a document preserves its history and only one current version',async()=>{
    const sh=await shipment(), v1=await document(sh), v2=await document(sh);
    assert.equal(v1.document_version,1); assert.equal(v2.document_version,2);
    const old=await one('select * from documents where id=$1',[v1.document_id]);
    assert.ok(old.superseded_at); assert.equal(old.superseded_by_document_id,v2.document_id);
    assert.equal(n((await readiness(sh.id)).current_official_document_count),1);
    await rejects(deleteDocSql,[v1.document_id],'CUBA_DOCUMENT_HISTORICAL_DELETE_FORBIDDEN');
  });
  await test('DOC-03 deleting the current version restores pending status without reviving history',async()=>{
    const sh=await shipment(); await db.query("update shipments set departure_date='2026-09-09' where id=$1",[sh.id]);
    await document(sh); const v2=await document(sh); await document(sh,'Commercial Invoice Cuba');
    await one(deleteDocSql,[v2.document_id]);
    assert.equal((await readiness(sh.id)).document_status,'pending');
    assert.equal((await readiness(sh.id)).has_packing_list_cuba,false);
    await rejects(deleteDocSql,[v2.document_id],'CUBA_DOCUMENT_ALREADY_DELETED');
    const v3=await document(sh); assert.equal(v3.document_version,3);
    assert.equal((await readiness(sh.id)).document_status,'ready');
    assert.equal((await rows('select * from documents where shipment_id=$1',[sh.id])).length,4);
  });
  await test('DOC-04 generic and generated documents do not replace official Cuba documents',async()=>{
    const so=await sale(), wr=await stock(), load=await salesLoad(so,wr), sh=await container(load);
    await loaded(load); await action(load,'dispatch');
    await db.query("insert into documents(shipment_id,client_id,document_type,file_name,storage_path) values($1,$2,'Commercial Invoice','generic.pdf','qa/generic.pdf')",[sh.id,client]);
    const generated=await one("insert into documents(load_id,shipment_id,client_id,document_type,file_name,storage_path,generated,source_type,source_id,content_sha256,generated_at) values($1,$2,$3,'Packing List','generated.pdf','qa/generated.pdf',true,'load',$1,repeat('a',64),now()) returning *",[load.id,sh.id,client]);
    assert.deepEqual((await readiness(sh.id)).missing_documents,['Packing List Cuba','Commercial Invoice Cuba']);
    await rejects(deleteDocSql,[generated.id],'CUBA_DOCUMENT_GENERATED_DELETE_FORBIDDEN');
    const expediente=await rows('select * from load_expediente_documents where load_id=$1 and document_id=$2',[load.id,generated.id]);
    assert.equal(expediente.length,1,'A document linked to load and shipment appears only once');
  });
  await test('DOC-05 failed replacement keeps the current document intact',async()=>{
    const sh=await shipment(), doc=await document(sh);
    await rejects(docSql,[sh.id,client,'Packing List Cuba','','qa/invalid.pdf'],'CUBA_DOCUMENT_FILE_REQUIRED');
    // The insert fails after the function supersedes v1. The RPC must roll back both writes.
    await rejects(docSql,[sh.id,'11111111-1111-4111-8111-111111111111','Packing List Cuba','bad.pdf','qa/bad.pdf'],'documents_client_id_fkey');
    assert.equal((await one('select superseded_at from documents where id=$1',[doc.document_id])).superseded_at,null);
  });

  // Existing canonical load fixture also executes against stock produced by real receiving RPCs.
  await test('LD-09 existing UX5 load lifecycle fixture runs with zero residue',async()=>{
    await stock();
    const source=fs.readFileSync('supabase/tests/ux5_load_actions.sql','utf8');
    // Keep the fixture's DO assertions; replace its outer transaction with a savepoint
    // so this test's source receipt also rolls back when the scenario finishes.
    const result=await db.exec(source.replace(/^begin;/,'savepoint legacy_load_fixture;').replace('\nrollback;','\nrollback to savepoint legacy_load_fixture; release savepoint legacy_load_fixture;'));
    assert.ok(Object.values(result.at(-1).rows[0]).every(value=>n(value)===0));
  });
  await test('LD-10 draft replacement deletes children first and updates the container atomically',async()=>{
    const wr=await stock(),load=await one(loadSql,[warehouse,JSON.stringify(loadLines(wr))]),sh=await container(load);
    const oldItem=await one('select id from load_items where load_id=$1',[load.id]);
    await one('select * from replace_load_plan_canonical($1,$2::jsonb)',[load.id,JSON.stringify(loadLines(wr,40))]);
    assert.equal((await rows('select * from load_items where id=$1',[oldItem.id])).length,0);
    assert.equal((await rows('select * from load_allocations')).length,1);
    assert.equal(n((await one('select quantity from shipments where id=$1',[sh.id])).quantity),40);
    assert.equal(n((await balance(wr.item.id)).physical_quantity),100);
    const invalid=[...loadLines(wr,20),{product_id:product,allocations:[]}];
    await rejects('select * from replace_load_plan_canonical($1,$2::jsonb)',[load.id,JSON.stringify(invalid)],'LOAD_ALLOCATIONS_REQUIRED');
    assert.equal(n((await one('select quantity from shipments where id=$1',[sh.id])).quantity),40);
    await action(load,'reserve');
    await rejects('select * from replace_load_plan_canonical($1,$2::jsonb)',[load.id,JSON.stringify(loadLines(wr,20))],'LOAD_NOT_DRAFT');
  });
  await test('LD-11 replacement preserves existing sales allocations when deletion is forbidden',async()=>{
    const so=await sale(),wr=await stock(),load=await salesLoad(so,wr);
    assert.equal((await loadState(load.id)).actions.edit.allowed,false);
    await rejects('select * from replace_load_plan_canonical($1,$2::jsonb)',[load.id,JSON.stringify(loadLines(wr,40))],'LOAD_HAS_SALES_ALLOCATIONS');
    await rejects('select * from replace_load_plan($1,$2::jsonb)',[load.id,JSON.stringify(loadLines(wr,40))],'LOAD_HAS_SALES_ALLOCATIONS');
    assert.equal(n((await progress(so.items[0].id)).planned_quantity),100);
    assert.equal((await rows('select * from load_allocations')).length,1);
  });
  await test('CT-03 existing-container assignment derives merchandise and preserves context guards',async()=>{
    const so=await sale(),wr=await stock(),load=await salesLoad(so,wr),sh=await shipment();
    await db.query('update shipments set client_id=$1 where id=$2',[clientB,sh.id]);
    await rejects('select * from assign_load_shipment_canonical($1,$2)',[load.id,sh.id],'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH');
    await db.query('update shipments set client_id=$1 where id=$2',[client,sh.id]);
    await one('select * from assign_load_shipment_canonical($1,$2)',[load.id,sh.id]);
    const linked=await one('select * from shipments where id=$1',[sh.id]);
    assert.equal(linked.product,'QA boxes'); assert.equal(n(linked.quantity),100);
    assert.equal(linked.client_id,client); assert.equal(linked.importer_id,importer);
  });
  await test('DB-01 repeated migration preserves backend-only execution privileges',async()=>{
    await db.exec(fs.readFileSync('supabase/migrations/20260909175528_load_plan_container_consistency.sql','utf8'));
    for(const fn of ['replace_load_plan(uuid,jsonb,timestamptz,text)','assign_load_shipment(uuid,uuid)','load_action_state(uuid)']) {
      const privileges=await one("select has_function_privilege('anon',$1,'execute') anon,has_function_privilege('authenticated',$1,'execute') authenticated,has_function_privilege('service_role',$1,'execute') backend",[fn]);
      assert.deepEqual(privileges,{anon:false,authenticated:false,backend:true});
    }
  });
  for(const table of tables) assert.equal((await rows(`select * from ${table}`)).length,0,`${table}: no business residue`);
  console.log(`Sales/logistics acceptance: ${passed.length} passed, ${failures.length} failed; ${salesLogisticsAcceptanceMigrations.length} real migrations; no network or production writes.`);
  if(failures.length) process.exitCode=1;
} finally { await db.close(); }
