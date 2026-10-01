import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Execute the real handler with gated dependencies; no network or business records.
const source=fs.readFileSync('api/shipments.js','utf8')
  .replace(/^import .*;\n/gm,'')
  .replace('export default async function handler','async function handler');
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
};
const tick=()=>new Promise(setImmediate);
const row={id:'simulated-shipment',client_id:null,container_number:'SIMU0000001',booking_number:'SIM-ORIGINAL',carrier:'SIMULACION INTERNA'};

function harness({authorized=true}={}){
  const read=deferred(),guard=deferred(),calls=[];
  const effects={capabilities:deferred(),history:deferred(),audit:deferred()};
  const sideEffects={resolve(){for(const effect of Object.values(effects))effect.resolve();}};
  const clock={now:0};
  const response={headers:{},setHeader(name,value){this.headers[name]=value;}};
  const context={
    Date:class extends Date {static now(){return clock.now;}},
    console:{error(){},info(){}},process:{env:{}},
    authorizeAdmin:async()=>authorized?{username:'simulated-admin',role:'master_admin'}:null,
    readJson:async req=>req.body,
    ok(res,data){res.status=200;res.body=data;},
    fail(res,status,error){res.status=status;res.body={error};},
    publicNotificationData:value=>value,
    publicNotificationError:value=>value,
    upstreamFailureStatus:(_error,fallback)=>fallback,
    assertShipmentBusinessAction(id,action){calls.push({kind:'guard',id,action});return guard.promise;},
    async loadShipmentActionCapabilities(){calls.push({kind:'capabilities'});await effects.capabilities.promise;return {actions:{edit:{allowed:true}}};},
    async supabase(table,options={}){
      const method=options.method||'GET';
      calls.push({kind:'db',table,method,body:options.body,prefer:options.prefer});
      if(table==='shipments'&&method==='GET')return read.promise;
      if(table==='shipments'&&method==='PATCH')return [{...row,...options.body}];
      if(table==='shipments'&&method==='DELETE')return [{id:row.id,container_number:row.container_number}];
      if(['loads','direct_shipment_allocations'].includes(table)&&method==='GET')return [];
      if(['shipment_history','audit_log'].includes(table)&&method==='POST'){
        await effects[table==='shipment_history'?'history':'audit'].promise;
        return null;
      }
      if(['notifications','shipment_history'].includes(table)&&method==='DELETE')return [];
      throw Error(`Unexpected dependency: ${method} ${table}`);
    }
  };
  vm.runInNewContext(`${source}\nthis.handler=handler;`,context,{filename:'api/shipments.js'});
  const run=(body={id:row.id,booking_number:'SIM-UPDATED'},method='PATCH')=>context.handler({method,body,query:{id:row.id}},response);
  const writes=()=>calls.filter(call=>call.kind==='db'&&call.method!=='GET');
  return {read,guard,sideEffects,effects,clock,calls,response,run,writes};
}

for(const first of ['read','guard']){
  const h=harness(),saving=h.run();
  await tick();
  assert.equal(h.calls.filter(call=>call.kind==='guard'&&call.action==='edit').length,1);
  assert.equal(h.calls.filter(call=>call.kind==='db'&&call.table==='shipments'&&call.method==='GET').length,1);
  assert.equal(h.writes().length,0,'starting both reads must not write');
  h[first].resolve(first==='read'?[row]:undefined);
  await tick();
  assert.equal(h.writes().length,0,`finishing only ${first} must not write`);
  const last=first==='read'?'guard':'read';
  h[last].resolve(last==='read'?[row]:undefined);
  await tick();
  assert.ok(h.writes().some(call=>call.table==='shipments'&&call.method==='PATCH'));
  assert.ok(h.writes().some(call=>call.table==='shipment_history'));
  assert.ok(h.writes().some(call=>call.table==='audit_log'));
  assert.ok(h.calls.some(call=>call.kind==='capabilities'));
  assert.equal(h.response.status,undefined,'receipt must wait for post-write work');
  h.sideEffects.resolve();
  await saving;
  assert.equal(h.response.status,200);
  assert.equal(h.response.body.shipment.booking_number,'SIM-UPDATED');
  assert.equal(h.response.body.shipment.carrier,row.carrier,'sparse edits must preserve other fields');
  assert.match(h.response.headers['Server-Timing'],/business_guard_ms;dur=\d+/);
  assert.match(h.response.headers['Server-Timing'],/total_ms;dur=\d+/);
}

// An independently slow post-write dependency must remain awaited and identifiable.
for(const slow of ['capabilities','history','audit']){
  const h=harness(),saving=h.run();
  await tick();
  h.read.resolve([row]);
  h.guard.resolve();
  await tick();
  const persisted=h.writes().filter(call=>['shipment_history','audit_log'].includes(call.table));
  assert.equal(persisted.length,2);
  assert.ok(persisted.every(call=>call.prefer==='return=minimal'),'unused inserted rows must not be returned');
  h.clock.now=10;
  for(const [name,effect] of Object.entries(h.effects))if(name!==slow)effect.resolve();
  await tick();
  assert.equal(h.response.status,undefined,`receipt must wait for ${slow}`);
  h.clock.now=75;
  h.effects[slow].resolve();
  await saving;
  assert.equal(h.response.status,200);
  for(const name of Object.keys(h.effects)){
    assert.match(h.response.headers['Server-Timing'],new RegExp(`${name}_ms;dur=${name===slow?75:10}(?:,|$)`));
  }
}

const failedCapabilities=harness(),failedSave=failedCapabilities.run();
await tick();
failedCapabilities.read.resolve([row]);
failedCapabilities.guard.resolve();
await tick();
failedCapabilities.effects.capabilities.reject(new Error('CAPABILITY_READ_FAILED'));
await tick();
assert.equal(failedCapabilities.response.status,undefined,'capability failure must still wait for the write receipts');
failedCapabilities.effects.history.resolve();
failedCapabilities.effects.audit.resolve();
await failedSave;
assert.equal(failedCapabilities.response.status,500,'capability failure must not return partial success');

const unhandled=[];
const onUnhandled=error=>unhandled.push(error);
process.on('unhandledRejection',onUnhandled);
try{
  for(const reason of [new Error('SHIPMENT_ACTION_NOT_ALLOWED'),undefined]){
    const h=harness(),saving=h.run();
    await tick();
    h.guard.reject(reason);
    await tick();
    assert.equal(h.writes().length,0);
    h.read.resolve([row]);
    await saving;
    assert.equal(h.response.status,reason?400:500);
    assert.equal(h.writes().length,0,'a rejected guard must prevent every write');
  }
  const missing=harness(),missingSave=missing.run();
  await tick();
  missing.guard.reject(new Error('SHIPMENT_ACTION_NOT_ALLOWED'));
  missing.read.resolve([]);
  await missingSave;
  await tick();
  assert.equal(missing.response.status,404);
  assert.equal(missing.writes().length,0);
  assert.equal(unhandled.length,0,'early guard failures must be caught while the row is pending');
}finally{
  process.off('unhandledRejection',onUnhandled);
}

const assignment=harness(),assigning=assignment.run({id:row.id,client_id:'simulated-client'});
await tick();
assert.equal(assignment.calls.filter(call=>call.kind==='guard').length,0,'assignment must wait for the row');
assignment.read.resolve([row]);
await tick();
assert.equal(assignment.calls.find(call=>call.kind==='guard').action,'assign_client');
assert.equal(assignment.writes().length,0);
assignment.guard.resolve();
assignment.sideEffects.resolve();
await assigning;
assert.equal(assignment.response.body.shipment.client_id,'simulated-client');

const denied=harness({authorized:false});
await denied.run();
assert.equal(denied.calls.length,0,'authorization denial must stop all data access');

const deletion=harness(),deleting=deletion.run({},'DELETE');
await tick();
assert.equal(deletion.calls.filter(call=>call.kind==='guard').length,0);
deletion.read.resolve([row]);
await tick();
assert.equal(deletion.calls.find(call=>call.kind==='guard').action,'delete');
assert.equal(deletion.writes().length,0);
deletion.guard.resolve();
deletion.sideEffects.resolve();
await deleting;
assert.equal(deletion.response.status,200);

console.log('Shipment save concurrency: parallel reads, guarded writes, rejection handling, assignment and deletion passed.');
