import assert from 'node:assert/strict';
import { createSalesLogisticsAcceptanceDb } from './lib/sales-logistics-acceptance-db.mjs';
import { salesLogisticsAcceptanceApi } from './lib/sales-logistics-acceptance-api.mjs';

const db=await createSalesLogisticsAcceptanceDb(), api=salesLogisticsAcceptanceApi(db);
const one=async(sql,params=[]) => (await db.query(sql,params)).rows[0];
const master={admin_id:'00000000-0000-4000-8000-000000000011',role:'master_admin',permissions:[]};
const reader={admin_id:'00000000-0000-4000-8000-000000000012',role:'admin',permissions:['sales.read','logistics.read','documents.read']};
let passed=0; const failures=[];
const post=(name,body,admin=master)=>api.request(name,{method:'POST',body,admin});
const get=(name,query={},admin=master)=>api.request(name,{query,admin});
const success=result=>{assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
async function test(name,run) {
  await db.exec('begin');
  try {await run();passed++;console.log(`PASS ${name}`);}
  catch(error){failures.push(name);console.error(`FAIL ${name}: ${error.message}`);}
  finally {await db.exec('rollback');}
}
try {
  await db.query('insert into admin_users(id,username,role) values($1,$2,$3)',[master.admin_id,'QA API master','master_admin']);
  const supplier=(await one("insert into suppliers(name) values('QA API supplier') returning id")).id;
  const warehouse=(await one("insert into warehouses(code,name,country) values('QA-SL-API','QA warehouse','USA') returning id")).id;
  const product=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-SL-API','QA API boxes','cajas',10) returning id")).id;
  const client=(await one("insert into clients(name) values('QA API customer') returning id")).id;
  const line={product_id:product,ordered_quantity:100,ordered_pallets:10,units_per_pallet:10,unit_price:4};
  const body={action:'create_plan',client_id:client,lines:[line]};
  async function sale(confirmed=true) {
    const order=success(await post('sales-order-ux',body)).order;
    if(confirmed)success(await post('sales',{action:'confirm',sales_order_id:order.id}));
    return success(await get('sales',{id:order.id})).order;
  }
  async function stock() {
    const po=await one('select * from create_purchase_order_plan(p_supplier_id=>$1,p_lines=>$2::jsonb,p_warehouse_id=>$3)',[supplier,JSON.stringify([{...line,unit_cost:2.5}]),warehouse]);
    for(const action of ['issue','confirm'])await one('select * from transition_purchase_order($1,$2)',[po.id,action]);
    const item=await one('select * from purchase_order_items where purchase_order_id=$1',[po.id]);
    const wr=await one('select * from receive_purchase_order_lines($1,$2::jsonb)',[warehouse,JSON.stringify([{purchase_order_item_id:item.id,received_quantity:100,received_pallets:10,lot_number:'QA-API-LOT'}])]);
    return one('select * from warehouse_receipt_items where receipt_id=$1',[wr.id]);
  }
  const allocations=(wr,qty=100)=>[{receipt_item_id:wr.id,allocated_quantity:qty,allocated_pallets:qty/10}];
  const loadLines=(wr,qty=100)=>[{product_id:product,allocations:allocations(wr,qty)}];
  async function standalone(wr) {return success(await post('loads',{action:'create_plan',warehouse_id:warehouse,lines:loadLines(wr)})).load;}
  const loadAction=(load,action)=>post('loads',{load_id:load.id,action});

  await test('API-01 anonymous and read-only writes never reach SQL',async()=>{
    for(const name of ['sales','sales-order-ux','sales-loads','loads','direct-shipment-dispatch']) {
      const before=api.calls.length;
      assert.equal((await api.request(name,{method:'POST',body})).status,401);
      assert.equal((await post(name,body,reader)).status,403);
      assert.equal(api.calls.length,before);
    }
  });
  await test('API-02 active sales editor preserves exact totals on create, edit and pricing read',async()=>{
    const exact={...line,ordered_quantity:840,ordered_pallets:28,units_per_pallet:30,unit_price:1.190476,line_total:1000};
    const order=success(await post('sales-order-ux',{...body,lines:[exact]})).order;
    const pricing=success(await get('sales-order-ux',{mode:'pricing',sales_order_id:order.id}));
    assert.equal(Number(pricing.items[0].entered_line_total),1000);
    success(await post('sales-order-ux',{...body,action:'replace_plan',sales_order_id:order.id,lines:[{...exact,line_total:1200}]}));
    assert.equal(Number(success(await get('sales',{id:order.id})).order.items[0].progress.line_total),1200);
    const invalid=await post('sales-order-ux',{...body,action:'replace_plan',sales_order_id:order.id,lines:[{...exact,line_total:-1}]});
    assert.equal(invalid.status,400);
    assert.equal(Number(success(await get('sales-order-ux',{mode:'pricing',sales_order_id:order.id})).items[0].entered_line_total),1200);
  });
  await test('API-03 sales compatibility endpoint preserves exact totals too',async()=>{
    const order=success(await post('sales',{...body,lines:[{...line,ordered_quantity:840,ordered_pallets:28,units_per_pallet:30,unit_price:1.190476,line_total:1000}]})).order;
    assert.equal(Number(order.items[0].progress.line_total),1000);
    const edited=success(await post('sales',{...body,action:'replace_plan',sales_order_id:order.id,lines:[{...line,line_total:450}]})).order;
    assert.equal(Number(edited.items[0].progress.line_total),450);
    for(const line_total of [-1,'NaN','Infinity','invalid'])
      assert.equal((await post('sales',{...body,lines:[{...line,line_total}]})).status,400,`Invalid total ${line_total}`);
    const unitOnly=success(await post('sales',body)).order;
    assert.equal(Number(unitOnly.items[0].progress.line_total),400);
  });
  await test('API-04 sale, load, reservation, container and dispatch return updated state',async()=>{
    const so=await sale(),wr=await stock();
    const created=success(await post('sales-loads',{action:'create_load',sales_order_id:so.id,warehouse_id:warehouse,lines:[{sales_order_item_id:so.items[0].id,allocations:allocations(wr)}]}));
    const load=created.load;
    assert.equal(Number(created.order.items[0].progress.planned_quantity),100);
    assert.equal(success(await loadAction(load,'reserve')).load.status,'reserved');
    success(await loadAction(load,'start_loading')); success(await loadAction(load,'mark_loaded'));
    const blocked=await loadAction(load,'dispatch'); assert.equal(blocked.status,400); assert.match(blocked.body.error,/Asigna un contenedor/);
    const createdContainer=success(await post('loads',{action:'create_container',load_id:load.id,container_number:'qa api 001'}));
    assert.equal(createdContainer.load.shipment.container_number,'QA API 001');
    assert.equal(Number(createdContainer.load.shipment.quantity),100);
    assert.equal(success(await loadAction(load,'dispatch')).load.status,'dispatched');
    assert.equal(success(await get('sales',{id:so.id})).order.items[0].progress.is_fully_dispatched,true);
    const docs=success(await get('shipment-document-readiness',{shipment_id:createdContainer.shipment.id}));
    assert.equal(docs.readiness.document_status,'pending');
    assert.equal((await loadAction(load,'dispatch')).status,400);
    assert.equal(Number((await one("select count(*) as n from inventory_movements where movement_type='dispatch'")).n),1);
  });
  await test('API-05 read-only capabilities disable mutations and retain tracking access',async()=>{
    const so=await sale(),wr=await stock(),load=await standalone(wr);
    success(await post('loads',{action:'create_container',load_id:load.id,container_number:'QA API READ'}));
    const read=success(await get('loads',{id:load.id},reader)).load;
    assert.equal(read.capabilities.actions.reserve.business_allowed,true);
    assert.equal(read.capabilities.actions.reserve.allowed,false);
    assert.equal(read.capabilities.actions.reserve.reason,'PERMISSION_REQUIRED');
    assert.equal(read.capabilities.actions.view_tracking.allowed,true);
    assert.equal(success(await get('sales',{id:so.id},reader)).order.capabilities.actions.allocate_load.allowed,false);
  });
  await test('API-06 editing a draft load updates its linked container merchandise',async()=>{
    const wr=await stock(),load=await standalone(wr);
    const sh=success(await post('loads',{action:'create_container',load_id:load.id,container_number:'QA API EDIT'})).shipment;
    const edited=success(await post('loads',{action:'replace_plan',load_id:load.id,lines:loadLines(wr,40)})).load;
    assert.equal(Number(edited.items[0].planned_quantity),40);
    assert.equal(Number(edited.shipment.quantity),40,'Container must show the edited load quantity');
    assert.equal(Number((await one('select quantity from shipments where id=$1',[sh.id])).quantity),40);
    assert.equal(Number((await one('select physical_quantity from inventory_source_balances where receipt_item_id=$1',[wr.id])).physical_quantity),100);
  });
  await test('API-07 assigning an existing container derives merchandise from the load',async()=>{
    const wr=await stock(),load=await standalone(wr);
    const sh=await one("insert into shipments(container_number,product,quantity,quantity_unit) values('QA API EXISTING','Old description',7,'unidades') returning *");
    const linked=success(await post('loads',{action:'assign_existing_container',load_id:load.id,shipment_id:sh.id})).load;
    assert.equal(linked.shipment.product,'QA API boxes');
    assert.equal(Number(linked.shipment.quantity),100); assert.equal(linked.shipment.quantity_unit,'cajas');
    const before=await one('select * from shipments where id=$1',[sh.id]);
    const invalid=await post('loads',{action:'replace_plan',load_id:load.id,lines:[...loadLines(wr,20),{product_id:product,allocations:[]} ]});
    assert.equal(invalid.status,400);
    assert.deepEqual(await one('select * from shipments where id=$1',[sh.id]),before);
  });
  await test('API-08 overcommitting a sale returns a clear client error and leaves the first load intact',async()=>{
    const so=await sale(),wr=await stock();
    const payload=qty=>({action:'create_load',sales_order_id:so.id,warehouse_id:warehouse,lines:[{sales_order_item_id:so.items[0].id,allocations:allocations(wr,qty)}]});
    success(await post('sales-loads',payload(60)));
    const result=await post('sales-loads',payload(50));
    assert.equal(result.status,400,JSON.stringify(result.body));
    assert.match(result.body.error,/pendiente|asignad|Direct Ship/);
    assert.equal(Number((await one('select count(*) as n from loads')).n),1);
    assert.equal(Number(success(await get('sales',{id:so.id})).order.items[0].progress.unallocated_quantity),40);
  });
  await test('API-09 document lookup validates IDs and scopes each container',async()=>{
    const a=await one("insert into shipments(container_number) values('QA DOC A') returning *"), b=await one("insert into shipments(container_number,departure_date) values('QA DOC B','2026-09-09') returning *");
    assert.equal(success(await get('shipment-document-readiness',{shipment_id:a.id})).readiness.document_status,'not_required');
    assert.equal(success(await get('shipment-document-readiness',{shipment_id:b.id})).readiness.document_status,'pending');
    assert.equal((await get('shipment-document-readiness',{shipment_id:'bad'})).status,400);
    assert.equal((await get('shipment-document-readiness',{shipment_id:'11111111-1111-4111-8111-111111111111'})).status,404);
  });
  await test('API-10 sale-linked loads expose the existing structural lock and explain context conflicts',async()=>{
    const so=await sale(),wr=await stock();
    const load=success(await post('sales-loads',{action:'create_load',sales_order_id:so.id,warehouse_id:warehouse,lines:[{sales_order_item_id:so.items[0].id,allocations:allocations(wr)}]})).load;
    const current=success(await get('loads',{id:load.id})).load;
    assert.equal(current.capabilities.actions.edit.allowed,false);
    assert.equal(current.capabilities.actions.edit.reason,'LOAD_HAS_SALES_ALLOCATIONS');
    const edit=await post('loads',{action:'replace_plan',load_id:load.id,lines:loadLines(wr,40)});
    assert.equal(edit.status,400); assert.match(edit.body.error,/vinculada a una venta/);
    const sh=await one("insert into shipments(container_number) values('QA WRONG CUSTOMER') returning *");
    const link=await post('loads',{action:'assign_existing_container',load_id:load.id,shipment_id:sh.id});
    assert.equal(link.status,400); assert.match(link.body.error,/cliente|importadora/);
    assert.equal(Number(success(await get('sales',{id:so.id})).order.items[0].progress.planned_quantity),100);
  });
  for(const table of ['sales_orders','purchase_orders','warehouse_receipts','loads','shipments','inventory_movements'])assert.equal(Number((await one(`select count(*) as n from ${table}`)).n),0,`${table}: no business residue`);
  console.log(`Sales/logistics API acceptance: ${passed} passed, ${failures.length} failed; real handlers and SQL, simulated auth/transport/audit.`);
  if(failures.length)process.exitCode=1;
} finally {await db.close();}
