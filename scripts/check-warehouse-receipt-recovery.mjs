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
} finally {
  globalThis.fetch=nativeFetch;
  if(api)await api.close();
  await db.end();
}
