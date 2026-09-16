import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createOperatorAcceptanceDb } from './lib/operator-acceptance-db.mjs';
import { operatorFixture } from './lib/operator-acceptance-fixture.mjs';
import { startBrowserAcceptanceServer } from '../e2e/isolated/server.mjs';

// Real handlers, current-session authorization, PostgREST and PostgreSQL on
// loopback only. The fault drops one HTTP confirmation after a committed receipt.
const db=await createOperatorAcceptanceDb();
let api;
const nativeFetch=globalThis.fetch;
try {
  const {f,users}=await operatorFixture(db);
  let drop=false,droppedId=null;
  api=await startBrowserAcceptanceServer({dropApiResponse:(req,url,body)=>{
    if(!drop||req.method!=='POST'||url.pathname!=='/api/warehouse')return false;
    let result;try{result=JSON.parse(String(body));}catch{return false;}
    if(!result.receipt?.id)return false;
    drop=false;droppedId=result.receipt.id;return true;
  }});
  const origins=new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
  globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(!origins.has(url.origin))throw Error('QA refuses external traffic');
    return nativeFetch(input,options);
  };
  await api.ready(db);
  const login=await api.request('login',{method:'POST',body:{username:users.master.username,password:users.master.password}});
  assert.equal(login.status,200);const token=login.body.token;
  const body={action:'create_receipt',registration_request_id:crypto.randomUUID(),
    warehouse_id:f.warehouse,supplier_id:f.supplier,received_at:'2026-09-16T12:00:00Z',
    reference_number:'QA-MANUAL-RECOVERY',truck_reference:'QA-TRUCK',notes:'Synthetic QA only',
    items:[{product_id:f.product,entry_mode:'units',quantity:12,unit_cost:2.5,currency:'USD'}]};
  drop=true;
  await assert.rejects(()=>api.request('warehouse',{method:'POST',token,body}),/fetch failed|socket|terminated/i);
  assert.ok(droppedId,'Fault must occur after the real handler returns a saved receipt');
  const retry=await api.request('warehouse',{method:'POST',token,body});
  assert.equal(retry.status,200,retry.body.error);
  const {rows:[snapshot]}=await db.query(`select
    (select count(*)::int from warehouse_receipts where reference_number='QA-MANUAL-RECOVERY') as receipts,
    (select count(*)::int from warehouse_receipt_items i join warehouse_receipts r on r.id=i.receipt_id where r.reference_number='QA-MANUAL-RECOVERY') as items,
    (select coalesce(sum(physical_quantity),0)::numeric from inventory_by_receipt where product_id=$1) as physical,
    (select count(*)::int from audit_log where action='warehouse_receipt_created') as audits`,[f.product]);
  console.log('Manual receipt lost-confirmation evidence: '+JSON.stringify(snapshot));
  assert.equal(snapshot.receipts,1,'Retry must return the original receipt instead of creating another header');
  assert.equal(snapshot.items,1,'Retry must not duplicate receipt lines');
  assert.equal(Number(snapshot.physical),12,'Inventory must count the delivery once');
  assert.equal(snapshot.audits,1,'Receipt and one audit must commit together');
  assert.equal(retry.body.receipt.id,droppedId);
  console.log('PASS manual receipt survives lost confirmation without duplicate stock (real isolated HTTP/SQL).');
  let checks=1;
  const counts=async()=> (await db.query(`select
    (select count(*)::int from warehouse_receipts) as receipts,
    (select count(*)::int from warehouse_receipt_items) as items,
    (select count(*)::int from audit_log where action='warehouse_receipt_created') as audits,
    (select coalesce(sum(physical_quantity),0)::numeric from inventory_by_receipt) as physical`)).rows[0];
  const send=(data,auth=token)=>api.request('warehouse',{method:'POST',token:auth,body:data});
  const next=(extra={})=>({...body,registration_request_id:crypto.randomUUID(),reference_number:'QA-'+crypto.randomUUID(),...extra});
  const unchanged=async(before)=>assert.deepEqual(await counts(),before);
  const expected=async(data,status,auth=token)=>{
    const before=await counts(),r=await send(data,auth);
    assert.equal(r.status,status,r.body.error);await unchanged(before);return r;
  };
  const concurrent=next();
  const concurrentBefore=await counts();
  const concurrentResponses=await Promise.all(Array.from({length:8},()=>send(concurrent)));
  concurrentResponses.forEach(r=>assert.equal(r.status,200,r.body.error));
  assert.equal(new Set(concurrentResponses.map(r=>r.body.receipt.id)).size,1);
  const concurrentAfter=await counts();
  assert.equal(concurrentAfter.receipts-concurrentBefore.receipts,1);
  assert.equal(concurrentAfter.items-concurrentBefore.items,1);
  assert.equal(concurrentAfter.audits-concurrentBefore.audits,1);
  assert.equal(Number(concurrentAfter.physical)-Number(concurrentBefore.physical),12);
  checks++;console.log('PASS eight concurrent requests count one delivery and audit');

  for(const change of [
    {warehouse_id:crypto.randomUUID()},{supplier_id:null},{reference_number:'changed'},
    {received_at:'2026-09-17T12:00:00Z'},{truck_reference:'changed'},
    {driver_name:'changed'},{notes:'changed'},
    {items:[{...body.items[0],quantity:13}]},{items:[{...body.items[0],unit_cost:3}]}
  ]){await expected({...body,...change},409);checks++;}
  console.log('PASS same request identity rejects changed business fields without writes');

  for(const [item,message] of [
    [{...body.items[0],quantity:-1},'Cantidad de la línea 2 inválido'],
    [{...body.items[0],quantity:'NaN'},'Cantidad de la línea 2 inválido'],
    [{...body.items[0],quantity:'Infinity'},'Cantidad de la línea 2 inválido'],
    [{...body.items[0],unit_cost:-1},'Costo inválido en línea 2'],
    [{...body.items[0],net_weight_kg:-1},'Peso neto inválido en línea 2'],
    [{...body.items[0],gross_weight_kg:'NaN'},'Peso bruto inválido en línea 2'],
    [{...body.items[0],product_id:crypto.randomUUID()},'El producto de la línea 2 no existe'],
    [{...body.items[0],entry_mode:'pallets',pallets:2,units_per_pallet:0},'Unidades por pallet inválidas en la línea 2']
  ]){
    const r=await expected(next({items:[body.items[0],item]}),400);
    assert.equal(r.body.error,message);checks++;
  }
  console.log('PASS late invalid lines roll back header, valid lines, stock and audit');

  await db.exec(`create function public.qa_fail_receipt_audit() returns trigger language plpgsql as $test$
    begin raise exception 'isolated receipt audit failure'; end; $test$;
    create trigger qa_fail_receipt_audit before insert on public.audit_log
    for each row when (new.action='warehouse_receipt_created') execute function public.qa_fail_receipt_audit();`);
  const auditFailure=next();
  try {await expected(auditFailure,500);checks++;}
  finally {await db.exec('drop trigger qa_fail_receipt_audit on public.audit_log; drop function public.qa_fail_receipt_audit();');}
  assert.equal((await send(auditFailure)).status,200);checks++;
  console.log('PASS audit failure rolls back all receipt state; the same request later succeeds');

  const palletRequest=next({items:[{product_id:f.product,entry_mode:'pallets',pallets:2,unit_cost:2.5,currency:'usd'}]});
  const pallet=await send(palletRequest);assert.equal(pallet.status,200,pallet.body.error);
  assert.equal(Number(pallet.body.receipt.items[0].quantity),20);
  assert.equal(Number(pallet.body.receipt.items[0].pallets),2);
  assert.equal(Number(pallet.body.receipt.items[0].units_per_pallet),10);
  assert.equal(pallet.body.receipt.items[0].unit,'cajas');checks++;
  await db.query('update products set default_units_per_pallet=99 where id=$1',[f.product]);
  await db.query('update suppliers set active=false where id=$1',[f.supplier]);
  try {
    const replay=await send(palletRequest);assert.equal(replay.status,200,replay.body.error);
    assert.equal(replay.body.receipt.id,pallet.body.receipt.id);
    assert.equal(Number(replay.body.receipt.items[0].quantity),20);checks++;
  }finally{
    await db.query('update products set default_units_per_pallet=10 where id=$1',[f.product]);
    await db.query('update suppliers set active=true where id=$1',[f.supplier]);
  }
  console.log('PASS pallets use catalogue defaults once; later catalogue changes do not prevent recovery');

  const role=async keys=>{
    const r=await api.request('access-control?resource=roles',{method:'PATCH',token,
      body:{id:users.a.access_role_id,permission_keys:keys}});
    assert.equal(r.status,200,r.body.error);
  };
  await role(['warehouse.read','warehouse.write']);
  const operatorLogin=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}});
  assert.equal(operatorLogin.status,200);const operatorToken=operatorLogin.body.token;
  await expected(body,409,operatorToken);checks++;
  const operatorRequest=next();assert.equal((await send(operatorRequest,operatorToken)).status,200);
  await role(['warehouse.read']);
  await expected(operatorRequest,403,operatorToken);
  await expected(next(),403,operatorToken);checks+=2;
  const originalPayload=(await db.query('select registration_request_payload from warehouse_receipts where registration_request_id=$1',[operatorRequest.registration_request_id])).rows[0].registration_request_payload.receipt;
  await assert.rejects(()=>db.query('select create_warehouse_receipt_canonical($1::jsonb,$2,$3)',[JSON.stringify(originalPayload),users.a.id,operatorRequest.registration_request_id]),/PERMISSION_REQUIRED/);checks++;
  await role(['warehouse.read','warehouse.write']);
  const loginAgain=await api.request('login',{method:'POST',body:{username:users.a.username,password:users.a.password}});
  assert.equal(loginAgain.status,200);
  const restoredBefore=await counts();assert.equal((await send(operatorRequest,loginAgain.body.token)).status,200);
  await unchanged(restoredBefore);checks++;
  console.log('PASS current authorization applies to replay; actor conflicts and revoked permission make no writes');

  const cancelled=await api.request('warehouse',{method:'PATCH',token,body:{action:'cancel_receipt',id:droppedId}});
  assert.equal(cancelled.status,200,cancelled.body.error);
  const afterCancel=await counts();
  const cancelReplay=await send(body);assert.equal(cancelReplay.status,200);
  assert.equal(cancelReplay.body.receipt.status,'cancelled');assert.equal(cancelReplay.body.receipt.id,droppedId);
  await unchanged(afterCancel);checks++;
  await assert.rejects(()=>db.query('update warehouse_receipts set registration_request_id=null,registration_request_payload=null where id=$1',[droppedId]),/WR_REQUEST_IDENTITY_IMMUTABLE/);
  await assert.rejects(()=>db.query('delete from warehouse_receipts where id=$1',[droppedId]),/WR_REQUEST_IDENTITY_IMMUTABLE/);
  await unchanged(afterCancel);checks++;
  console.log('PASS replay does not resurrect cancelled stock or erase request identity');

  const absentDate=next({received_at:null});
  const firstNoDate=await send(absentDate);const secondNoDate=await send(absentDate);
  assert.equal(firstNoDate.status,200);assert.equal(secondNoDate.status,200);
  assert.equal(secondNoDate.body.receipt.id,firstNoDate.body.receipt.id);
  assert.equal(secondNoDate.body.receipt.received_at,firstNoDate.body.receipt.received_at);checks++;
  const legacy=next();delete legacy.registration_request_id;
  assert.equal((await send(legacy)).status,200);checks++;
  await expected(next({registration_request_id:'bad'}),400);checks++;
  await expected(next({received_at:'bad'}),400);checks++;
  const privilege=(await db.query(`select
    has_function_privilege('anon','public.create_warehouse_receipt_canonical(jsonb,uuid,uuid)','execute') as anon,
    has_function_privilege('authenticated','public.create_warehouse_receipt_canonical(jsonb,uuid,uuid)','execute') as authenticated,
    has_function_privilege('service_role','public.create_warehouse_receipt_canonical(jsonb,uuid,uuid)','execute') as service`)).rows[0];
  assert.deepEqual(privilege,{anon:false,authenticated:false,service:true});checks++;
  console.log('Manual receipt recovery: '+checks+' checks passed (real isolated HTTP/PostgreSQL, no external traffic).');

} finally {
  globalThis.fetch=nativeFetch;
  if(api)await api.close();
  await db.end();
}
