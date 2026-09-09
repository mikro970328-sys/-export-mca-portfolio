// Real business RPCs shared by SQL and handler acceptance. No network or secrets.
export async function financeFixture(db, { actor: existingActor } = {}) {
  const rows=async(sql,params=[]) => (await db.query(sql,params)).rows;
  const one=async(sql,params=[]) => (await rows(sql,params))[0];
  const actor=existingActor || (await one("insert into admin_users(username,role) values('QA finance','master_admin') returning id")).id;
  const supplier=(await one("insert into suppliers(name,country) values('QA finance supplier','USA') returning id")).id;
  const warehouse=(await one("insert into warehouses(code,name,country) values('QA-FIN','QA finance','USA') returning id")).id;
  const product=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-FIN','QA finance boxes','cajas',10) returning id")).id;
  const productB=(await one("insert into products(sku,name,unit,default_units_per_pallet) values('QA-FIN-B','QA other boxes','cajas',10) returning id")).id;
  const client=(await one("insert into clients(name) values('QA finance customer') returning id")).id;
  const clientB=(await one("insert into clients(name) values('QA other customer') returning id")).id;
  const importer=(await one("insert into importers(name) values('QA finance importer') returning id")).id;
  await db.query('insert into client_importers(client_id,importer_id) values($1,$3),($2,$3)',[client,clientB,importer]);
  const baseLine={product_id:product,ordered_quantity:100,ordered_pallets:10,units_per_pallet:10,unit_price:4,unit_cost:2.5};
  const json=JSON.stringify;
  let sequence=0;
  async function sale({currency='USD',clientId=client,lines=[baseLine],confirmed=true}={}) {
    const so=await one('select * from create_sales_order_plan(p_client_id=>$1,p_lines=>$2::jsonb,p_currency=>$3,p_importer_id=>$4)',[clientId,json(lines),currency,importer]);
    if(confirmed)await one("select * from transition_sales_order($1,'confirm')",[so.id]);
    return {...so,items:await rows('select * from sales_order_items where sales_order_id=$1 order by id',[so.id])};
  }
  async function invoice(so,{quantity=so.items[0].ordered_quantity,issued=true,date='2026-09-01',due='2026-09-05',operation=null}={}) {
    const inv=await one('select * from create_invoice_plan($1,$2::jsonb,$3::date,$4::date,$5::uuid)',[so.id,json([{sales_order_item_id:so.items[0].id,quantity}]),date,due,operation]);
    return issued?one("select * from transition_invoice($1,'issue')",[inv.id]):inv;
  }
  const payment=(inv,amount,date='2026-09-09')=>one('select * from register_invoice_payment($1,$2,$3::date)',[inv.id,amount,date]);
  const advance=(so,amount,date='2026-09-09')=>one('select * from register_customer_advance(p_sales_order_id=>$1,p_amount=>$2,p_received_date=>$3::date,p_actor=>$4)',[so.id,amount,date,actor]);
  const apply=(a,inv,amount)=>one('select * from apply_customer_advance(p_customer_advance_id=>$1,p_invoice_id=>$2,p_amount=>$3,p_actor=>$4)',[a.id,inv.id,amount,actor]);
  const refund=(a,amount,date='2026-09-09')=>one('select * from refund_customer_advance(p_customer_advance_id=>$1,p_amount=>$2,p_refund_date=>$3::date,p_actor=>$4)',[a.id,amount,date,actor]);
  async function purchase({currency='USD',lines=[baseLine]}={}) {
    const po=await one('select * from create_purchase_order_plan(p_supplier_id=>$1,p_lines=>$2::jsonb,p_warehouse_id=>$3,p_currency=>$4)',[supplier,json(lines),warehouse,currency]);
    await one("select * from transition_purchase_order($1,'issue')",[po.id]);
    await one("select * from transition_purchase_order($1,'confirm')",[po.id]);
    return {...po,items:await rows('select * from purchase_order_items where purchase_order_id=$1 order by id',[po.id])};
  }
  async function bill(po,{total=250,quantity=100,posted=true,date='2026-09-01',due='2026-09-05'}={}) {
    const b=await one('select * from create_supplier_bill_plan(p_purchase_order_id=>$1,p_lines=>$2::jsonb,p_bill_date=>$3::date,p_due_date=>$4::date,p_actor=>$5,p_supplier_invoice_number=>$6)',[po.id,json([{purchase_order_item_id:po.items[0].id,billed_quantity:quantity,line_total:total}]),date,due,actor,`QA-FIN-BILL-${++sequence}`]);
    return posted?one("select * from transition_supplier_bill_canonical($1,'post',$2)",[b.id,actor]):b;
  }
  const supplierPayment=(po,amount,date='2026-09-09')=>one('select * from register_supplier_payment(p_purchase_order_id=>$1,p_amount=>$2,p_payment_date=>$3::date,p_actor=>$4)',[po.id,amount,date,actor]);
  const payBill=(b,amount)=>one('select * from pay_supplier_bill_canonical(p_supplier_bill_id=>$1,p_amount=>$2,p_actor=>$3)',[b.id,amount,actor]);
  const distribute=(p,applications)=>one('select * from replace_supplier_payment_applications_canonical($1,$2::jsonb,$3)',[p.id,json(applications),actor]);
  const cost=(so,{amount=50,allocated=amount,currency='USD',posted=true}={})=>one(`select * from ${posted?'create_posted_cost_charge':'create_cost_charge'}(p_category=>'domestic_trucking',p_stage=>'fulfillment',p_amount=>$1,p_currency=>$2,p_allocations=>$3::jsonb,p_actor=>$4)`,[amount,currency,json([{sales_order_id:so.id,amount:allocated,basis:'manual'}]),actor]);
  async function fulfill(so,po) {
    const wr=await one('select * from receive_purchase_order_lines($1,$2::jsonb)',[warehouse,json([{purchase_order_item_id:po.items[0].id,received_quantity:100,received_pallets:10}])]);
    const item=await one('select * from warehouse_receipt_items where receipt_id=$1',[wr.id]);
    const load=await one('select * from create_load_from_sales_order($1,$2,$3::jsonb)',[so.id,warehouse,json([{sales_order_item_id:so.items[0].id,allocations:[{receipt_item_id:item.id,allocated_quantity:100,allocated_pallets:10}]}])]);
    await one('select * from create_load_shipment_canonical(p_load_id=>$1,p_container_number=>$2)',[load.id,`QA-FIN-${++sequence}`]);
    for(const action of ['reserve','start_loading','mark_loaded','dispatch'])await one('select * from execute_load_action($1,$2)',[load.id,action]);
    return {wr,load};
  }
  const financial=inv=>one('select * from invoice_financial_progress where invoice_id=$1',[inv.id]);
  const advanceProgress=a=>one('select * from customer_advance_progress where customer_advance_id=$1',[a.id]);
  const ap=b=>one('select * from supplier_bill_financial_progress where supplier_bill_id=$1',[b.id]);
  const report=async(dataset,filters={}) => (await one(`select executive_report_dataset(p_dataset=>$1${Object.keys(filters).map((key,i)=>`,p_${key}=>$${i+2}`).join('')}) as data`,[dataset,...Object.values(filters)])).data;
  const dashboard=async(filters={})=>(await one(`select executive_dashboard_rollup(${Object.keys(filters).map((key,i)=>`p_${key}=>$${i+1}`).join(',')}) as data`,Object.values(filters))).data;
  return {rows,one,json,actor,supplier,warehouse,product,productB,client,clientB,importer,baseLine,sale,invoice,payment,advance,apply,refund,purchase,bill,supplierPayment,payBill,distribute,cost,fulfill,financial,advanceProgress,ap,report,dashboard};
}
