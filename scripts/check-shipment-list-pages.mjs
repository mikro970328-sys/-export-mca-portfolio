import assert from 'node:assert/strict';
import {readShipmentListPages} from '../api/_shipment-list-pages.js';

const nativeFetch=globalThis.fetch,previous={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
process.env.SUPABASE_URL='http://127.0.0.1:9999';process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-test-only';
try{
  for(const count of [0,1,500,1000,2005]){
    const records=Array.from({length:count},(_,i)=>({shipment_id:`synthetic-${i}`,capabilities:{actions:{edit:{allowed:true}}}})),requests=[];
    globalThis.fetch=async(input,options)=>{
      const url=new URL(input);assert.equal(url.origin,'http://127.0.0.1:9999');assert.equal(options.method,'GET');
      assert.equal(url.searchParams.get('order'),'shipment_id.asc');
      const offset=Number(url.searchParams.get('offset')),limit=Number(url.searchParams.get('limit'));
      requests.push(offset);return Response.json(records.slice(offset,offset+Math.min(1000,limit)));
    };
    const actual=await readShipmentListPages('shipment_action_capabilities','?select=shipment_id,capabilities&order=shipment_id.asc');
    assert.deepEqual(actual,records,'every record must survive the REST row cap');
    assert.equal(requests.length,Math.floor(count/500)+1,'small datasets keep one request');
  }
  let pages=0;
  globalThis.fetch=async()=>++pages===1?Response.json(Array.from({length:500},(_,i)=>({id:i}))):Response.json({code:'42501',message:'synthetic denied'},{status:403});
  await assert.rejects(readShipmentListPages('shipments','?select=*&order=created_at.desc,id.desc'),/synthetic denied/,'an incomplete list must never be returned as success');
  globalThis.fetch=async()=>Response.json(null);
  await assert.rejects(readShipmentListPages('shipments','?select=*&order=id.asc'),/RESPONSE_INVALID/);
  globalThis.fetch=async()=>Response.json(Array.from({length:500},(_,i)=>({id:i})));
  await assert.rejects(readShipmentListPages('shipments','?select=*&order=id.asc',{maxRows:501}),/VOLUME_LIMIT/);
  await assert.rejects(readShipmentListPages('shipments','?select=*'),/QUERY_INVALID/);
  await assert.rejects(readShipmentListPages('shipments','?select=*&order=id.asc&limit=1000'),/QUERY_INVALID/);
}finally{
  globalThis.fetch=nativeFetch;
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
console.log('Shipment list pages: full row/capability coverage, bounded reads, stable order and no partial-success responses passed.');
