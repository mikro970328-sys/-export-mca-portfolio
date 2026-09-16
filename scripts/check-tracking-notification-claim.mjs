import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as lib from '../api/_lib.js';

// Run the original handlers and delivery-key helper. Database and WhatsApp are
// stateful doubles; no credentials, external requests or client messages.
globalThis.fetch = async () => { throw new Error('Unexpected network request'); };
process.env.TWILIO_RELEASE_CONTENT_SID = 'isolated-release-template';
process.env.TWILIO_DEPARTED_CONTENT_SID = 'isolated-departure-template';
const id = '10000000-0000-4000-8000-000000000001';
let scenarios = 0;
function compile(path, deps, exports) {
  const source = fs.readFileSync(path, 'utf8')
    .replace(/^import \{([^}]+)\} from '([^']+)';$/gm, (_, bindings, name) => `const {${bindings}} = deps[${JSON.stringify(name)}];`)
    .replace(/export (default )?/g, '');
  assert.doesNotMatch(source, /^import |^export /m);
  return new Function('deps', 'console', `${source}\nreturn {${exports}};`)(deps, {error(){}});
}
function fixture(options = {}) {
  const state = {sends:0, releases:0, claims:new Set(), notifications:[], patches:[],
    failPatch:options.failPatch, rejectSend:options.rejectSend,
    shipment:{id, client_id:id, container_number:'QA-CLAIM-001', last_status:'Descargado del buque',
      clients:{active:true, phone:'+15555550100', name:'QA'}}};
  const supabase = async (table, {method, body} = {}) => {
    if(table === 'rpc/claim_notification_dispatch') {
      if(state.claims.has(body.p_delivery_key)) return false;
      state.claims.add(body.p_delivery_key); return true;
    }
    if(table === 'rpc/release_notification_dispatch_claim') {
      state.releases++; return state.claims.delete(body.p_delivery_key);
    }
    if(table === 'shipments' && !method) return [structuredClone(state.shipment)];
    if(table === 'shipments' && method === 'PATCH') {
      if(body.release_notification_status === 'sent' && state.failPatch) {
        state.failPatch = false; throw new Error('isolated post-send database failure');
      }
      state.patches.push(body); Object.assign(state.shipment, body); return [state.shipment];
    }
    if(table === 'notifications') {state.notifications.push(...body); return [];}
    if(['shipment_history','audit_log'].includes(table)) return [];
    throw new Error(`Unexpected database access: ${table}`);
  };
  const deps = {
    './_lib.js':{...lib, supabase, authorizeAdmin:async()=>({admin_id:id, username:'QA'}),
      sendWhatsApp:async()=>{
        state.sends++;
        if(state.rejectSend) {state.rejectSend=false; throw new Error('isolated provider rejection');}
        return {sid:'SM-isolated-accepted',status:'queued'};
      }},
    './_operation-lifecycle.js':{reconcileOperationLifecycle:async()=>{}},
    './_shipment-actions.js':{assertShipmentBusinessAction:async(_,action)=>{
        // Mirror the existing release gate; manual tracking remains correctable.
        if(action==='release' && state.shipment.released_at) throw new Error('SHIPMENT_ALREADY_RELEASED');
      },
      loadShipmentActionCapabilityMap:async()=>new Map(),loadShipmentActionCapabilities:async()=>({})}
  };
  deps['./_notification-delivery.js'] = compile('api/_notification-delivery.js', deps,
    'claimNotificationDelivery, releaseNotificationDelivery, whatsappMilestoneAllowed');
  const handlers = Object.fromEntries(['manual-tracking-event','shipments'].map(name=>
    [name,compile(`api/${name}.js`, deps, 'handler').handler]));
  state.request = async (name, event = 'released') => {
    const res = {statusCode:0, setHeader(){}, end(value){this.body=JSON.parse(value);}};
    await handlers[name]({method:'PATCH', body:{id, event, action:'release'}}, res);
    return res;
  };
  return state;
}

for(const first of ['manual-tracking-event','shipments']) {
  for(const retry of ['manual-tracking-event','shipments']) {
    const f = fixture({failPatch:true});
    const failed = await f.request(first);
    assert.ok(failed.statusCode >= 400, 'Persistence failure must not report a completed update');
    assert.equal(f.sends,1);
    assert.equal(f.releases,0,'Accepted message must retain its deduplication claim');
    assert.equal(f.claims.has('tracking:RELEASE'),true);
    assert.equal(f.notifications.some(n=>n.status==='failed'),false,'Database failure is not a rejected message');
    let recovered = await f.request(retry);
    if(first==='manual-tracking-event' && retry==='shipments') {
      assert.equal(recovered.statusCode,400,'Existing release gate still rejects a released shipment');
      recovered = await f.request('manual-tracking-event');
    }
    assert.equal(recovered.statusCode,200);
    assert.equal(recovered.body.notification_status,'already_notified');
    assert.equal(f.sends,1,'Same or alternate endpoint must not resend');
    assert.equal(f.shipment.last_status,'Liberado');
    scenarios++;
  }
  const f = fixture({rejectSend:true});
  const rejected = await f.request(first);
  assert.equal(rejected.statusCode,200);
  assert.equal(rejected.body.notification_status,'failed');
  assert.equal(f.releases,1);
  assert.equal(f.claims.size,0);
  const retried = await f.request('manual-tracking-event');
  assert.equal(retried.statusCode,200);
  assert.equal(retried.body.notification_status,'queued');
  assert.equal(f.sends,2);
  scenarios++;
}
const f = fixture();
for(const event of ['load','departed','arrived','discharged','released']) {
  assert.equal((await f.request('manual-tracking-event',event)).statusCode,200);
}
assert.equal(f.sends,2,'Only departure and release send WhatsApp');
await f.request('manual-tracking-event','departed');
await f.request('manual-tracking-event','released');
assert.equal(f.sends,2,'Rollback and reconfirmation must not resend either milestone');
assert.equal(f.releases,0);
scenarios++;
console.log(`Tracking notification claims: ${scenarios} scenarios passed (isolated, no external sends).`);
