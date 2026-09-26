import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

const db=new PGlite();
const migration=await readFile('supabase/migrations/20260926190500_container_profitability.sql','utf8');
const ids={
  operation:'10000000-0000-4000-8000-000000000001',
  shipmentA:'20000000-0000-4000-8000-000000000001',
  shipmentB:'20000000-0000-4000-8000-000000000002',
  shipmentEmpty:'20000000-0000-4000-8000-000000000003',
  orderA:'30000000-0000-4000-8000-000000000001',
  orderB:'30000000-0000-4000-8000-000000000002',
  itemA:'40000000-0000-4000-8000-000000000001',
  itemB:'40000000-0000-4000-8000-000000000002',
  loadA:'50000000-0000-4000-8000-000000000001',
  loadB:'50000000-0000-4000-8000-000000000002',
  loadItemA:'60000000-0000-4000-8000-000000000001',
  loadItemB:'60000000-0000-4000-8000-000000000002',
  allocationA:'70000000-0000-4000-8000-000000000001',
  allocationB:'70000000-0000-4000-8000-000000000002',
  planB:'80000000-0000-4000-8000-000000000001',
  procurementB:'90000000-0000-4000-8000-000000000001',
  poItemB:'a0000000-0000-4000-8000-000000000001',
  expenseLoad:'b0000000-0000-4000-8000-000000000001',
  expenseShipment:'b0000000-0000-4000-8000-000000000002'
};

try{
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.shipments(id uuid primary key,container_number text,operation_id uuid);
    create table public.sales_orders(id uuid primary key,currency text not null);
    create table public.sales_order_items(id uuid primary key,sales_order_id uuid,ordered_quantity numeric,unit_price numeric,entered_line_total numeric);
    create table public.loads(id uuid primary key,shipment_id uuid,status text);
    create table public.load_items(id uuid primary key,load_id uuid);
    create table public.sales_fulfillment_allocations(id uuid primary key,load_item_id uuid,sales_order_item_id uuid,allocated_quantity numeric);
    create table public.load_item_merchandise_cogs(load_item_id uuid,currency text,recognized_unit_cogs numeric,cost_coverage text);
    create table public.direct_shipment_effective_allocations(id uuid primary key,shipment_id uuid,sales_procurement_allocation_id uuid,allocated_sales_quantity numeric,allocated_purchase_quantity numeric);
    create table public.sales_procurement_allocations(id uuid primary key,supply_plan_line_id uuid,purchase_order_item_id uuid);
    create table public.sales_supply_plan_lines(id uuid primary key,sales_order_item_id uuid);
    create table public.purchase_order_item_merchandise_cost_basis(purchase_order_item_id uuid,currency text,recognized_unit_cost numeric,cost_coverage text);
    create table public.posted_cost_charge_traceability(cost_charge_id uuid,target_type text,shipment_id uuid,load_id uuid,currency text,allocated_amount numeric);
  `);
  await db.exec(migration);
  await db.query(`insert into public.shipments(id,container_number,operation_id) values
    ($1,'CONT-UNO',$2),($3,'CONT-DOS',$2),($4,'CONT-SIN-VENTA',$2)`,[
      ids.shipmentA,ids.operation,ids.shipmentB,ids.shipmentEmpty
    ]);
  await db.query(`insert into public.sales_orders(id,currency) values($1,'USD'),($2,'USD')`,[ids.orderA,ids.orderB]);
  await db.query(`insert into public.sales_order_items(id,sales_order_id,ordered_quantity,unit_price,entered_line_total) values
    ($1,$2,10,0,200),($3,$4,3,0,300)`,[ids.itemA,ids.orderA,ids.itemB,ids.orderB]);
  await db.query(`insert into public.loads(id,shipment_id,status) values($1,$2,'dispatched'),($3,$4,'dispatched')`,[
    ids.loadA,ids.shipmentA,ids.loadB,ids.shipmentB
  ]);
  await db.query(`insert into public.load_items(id,load_id) values($1,$2),($3,$4)`,[
    ids.loadItemA,ids.loadA,ids.loadItemB,ids.loadB
  ]);
  await db.query(`insert into public.sales_fulfillment_allocations(id,load_item_id,sales_order_item_id,allocated_quantity) values
    ($1,$2,$3,6),($4,$5,$6,1)`,[
      ids.allocationA,ids.loadItemA,ids.itemA,ids.allocationB,ids.loadItemB,ids.itemB
    ]);
  await db.query(`insert into public.load_item_merchandise_cogs(load_item_id,currency,recognized_unit_cogs,cost_coverage) values
    ($1,'USD',10,'actual'),($2,'USD',20,'estimated')`,[ids.loadItemA,ids.loadItemB]);
  await db.query(`insert into public.sales_supply_plan_lines(id,sales_order_item_id) values($1,$2)`,[ids.planB,ids.itemB]);
  await db.query(`insert into public.sales_procurement_allocations(id,supply_plan_line_id,purchase_order_item_id) values($1,$2,$3)`,[ids.procurementB,ids.planB,ids.poItemB]);
  await db.query(`insert into public.direct_shipment_effective_allocations(id,shipment_id,sales_procurement_allocation_id,allocated_sales_quantity,allocated_purchase_quantity)
    values('d0000000-0000-4000-8000-000000000001',$1,$2,2,2)`,[ids.shipmentB,ids.procurementB]);
  await db.query(`insert into public.purchase_order_item_merchandise_cost_basis(purchase_order_item_id,currency,recognized_unit_cost,cost_coverage)
    values($1,'USD',60,'actual')`,[ids.poItemB]);
  await db.query(`insert into public.posted_cost_charge_traceability(cost_charge_id,target_type,shipment_id,load_id,currency,allocated_amount) values
    ($1,'load',$2,$3,'USD',15),($4,'shipment',$2,null,'USD',5),
    ('b0000000-0000-4000-8000-000000000003','load',$5,$6,'USD',20)`,[
      ids.expenseLoad,ids.shipmentA,ids.loadA,ids.expenseShipment,ids.shipmentB,ids.loadB
    ]);

  const one=async id=>(await db.query('select * from public.shipment_profitability where shipment_id=$1',[id])).rows[0];
  const first=await one(ids.shipmentA);
  assert.equal(Number(first.attributed_sales_revenue),120,'Exact agreed line total is prorated by the quantity assigned to this container');
  assert.equal(Number(first.recognized_merchandise_cogs),60,'COGS uses the container fulfillment quantity');
  assert.equal(Number(first.direct_cost_amount),20,'Container and load expenses are both included once');
  assert.equal(Number(first.contribution_margin),40,'Container contribution subtracts merchandise and explicitly assigned charges');
  assert.equal(first.profitability_status,'comparable');

  const second=await one(ids.shipmentB);
  assert.equal(Number(second.attributed_sales_revenue),300,'Load and Direct Ship sales totals are combined for the same container');
  assert.equal(Number(second.recognized_merchandise_cogs),140,'Load and Direct Ship merchandise cost are combined');
  assert.equal(Number(second.direct_cost_amount),20);
  assert.equal(Number(second.contribution_margin),140);
  assert.equal(second.merchandise_cost_coverage,'partial_actual','Estimated merchandise remains visible as a supported estimate');

  const empty=await one(ids.shipmentEmpty);
  assert.equal(empty.profitability_status,'no_sales_allocation');
  assert.equal(empty.contribution_margin,null,'A container without assigned sales is never reported as zero-profit');
  console.log('Container profitability: exact agreed totals, load and Direct Ship allocation, assigned expenses, and pending state passed.');
}finally{
  await db.close();
}
