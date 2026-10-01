import assert from 'node:assert/strict';
import {loadShipmentActionCapabilities,loadShipmentActionCapabilityMap,maskShipmentActionCapabilities} from '../api/_shipment-actions.js';

const originalFetch=globalThis.fetch;
const previous={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY:process.env.SUPABASE_SERVICE_ROLE_KEY};
process.env.SUPABASE_URL='http://127.0.0.1:9999';
process.env.SUPABASE_SERVICE_ROLE_KEY='synthetic-only';
const raw={active:true,actions:{edit:{allowed:true,reason:null},view_info:{allowed:true,reason:null},
  view_documents:{allowed:true,reason:null},release:{allowed:false,reason:'SHIPMENT_ALREADY_RELEASED'}}};
for(const action of Object.values(raw.actions))Object.freeze(action);
Object.freeze(raw.actions);Object.freeze(raw);
const operator={admin_id:'synthetic-admin',role:'admin'},requests=[];
let granted=['logistics.read'],denied=false;
try{
  globalThis.fetch=async input=>{
    const url=new URL(input);assert.equal(url.origin,'http://127.0.0.1:9999');
    const table=url.pathname.split('/').at(-1);requests.push(table);
    if(table==='admin_effective_permissions'){
      assert.equal(url.searchParams.get('admin_user_id'),'eq.synthetic-admin');
      assert.equal(url.searchParams.get('permission_key'),'in.(logistics.read,logistics.write,documents.read)');
      return denied?Response.json({code:'42501',message:'synthetic permission denied'},{status:403})
        :Response.json(granted.map(permission_key=>({permission_key})));
    }
    assert.equal(table,'shipment_action_capabilities','unrelated team/account reads are forbidden');
    return Response.json([{shipment_id:'synthetic-shipment',capabilities:raw}]);
  };
  const state=await loadShipmentActionCapabilities(operator,'synthetic-shipment');
  assert.deepEqual(requests.sort(),['admin_effective_permissions','shipment_action_capabilities']);
  assert.equal(state.actions.view_info.allowed,true);assert.equal(state.actions.edit.allowed,false);
  assert.equal(state.actions.edit.business_allowed,true);assert.equal(state.actions.edit.reason,'PERMISSION_REQUIRED');
  assert.equal(state.actions.release.reason,'SHIPMENT_ALREADY_RELEASED');assert.equal(state.write_access,false);
  requests.length=0;granted=['logistics.read','logistics.write','documents.read'];
  const bundle=await loadShipmentActionCapabilityMap(operator);
  assert.equal(requests.length,2);assert.equal(bundle.write_access,true);
  assert.equal(bundle.map.get('synthetic-shipment').actions.edit.allowed,true);
  granted=[];
  const revoked=await loadShipmentActionCapabilities(operator,'synthetic-shipment');
  assert.equal(revoked.actions.edit.allowed,false,'revocations apply on the next request without a permission cache');
  assert.equal(revoked.actions.view_info.allowed,false);assert.equal(revoked.write_access,false);
  requests.length=0;
  const master=await loadShipmentActionCapabilities({role:'master_admin'},'synthetic-shipment');
  assert.deepEqual(requests,['shipment_action_capabilities']);assert.equal(master.actions.edit.allowed,true);
  assert.equal(master.actions.release.allowed,false,'master must still obey business state');
  denied=true;
  await assert.rejects(loadShipmentActionCapabilities(operator,'synthetic-shipment'),/synthetic permission denied/);
  assert.equal(raw.actions.edit.allowed,true);assert.equal(Object.hasOwn(raw.actions.edit,'required_permission'),false);
  const masked=maskShipmentActionCapabilities(raw,new Set());
  assert.notEqual(masked,raw);assert.notEqual(masked.actions,raw.actions);assert.notEqual(masked.actions.edit,raw.actions.edit);
  // Both independent reads start before either completes.
  const pending=[],started=[];
  globalThis.fetch=input=>new Promise(resolve=>{started.push(new URL(input).pathname);pending.push(resolve);});
  const reading=loadShipmentActionCapabilities(operator,'synthetic-shipment');
  assert.equal(started.length,2);
  pending[0](Response.json([{permission_key:'logistics.write'}]));
  pending[1](Response.json([{shipment_id:'synthetic-shipment',capabilities:raw}]));
  assert.equal((await reading).actions.edit.allowed,true);
}finally{
  globalThis.fetch=originalFetch;
  for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
}
console.log('Shipment action reads: two parallel reads, current permissions, no unrelated reads, no source mutation and fail-closed authorization passed.');
