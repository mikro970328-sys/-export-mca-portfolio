import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as lib from '../api/_lib.js';
import {validDate,repeatDue,DAY} from '../api/_alert-lifecycle.js';

for(const value of [null,undefined,'','   ',false,true,[],{},'invalid',NaN,Infinity])assert.equal(validDate(value),null);
assert.equal(validDate('2026-09-20T12:00:00Z').toISOString(),'2026-09-20T12:00:00.000Z');
assert.equal(validDate(0).getTime(),0,'an explicit epoch differs from a missing date');
assert.equal(repeatDue({},DAY),true);
assert.equal(repeatDue({last_triggered_at:new Date().toISOString()},DAY),false);

const id='11111111-1111-4111-8111-111111111111',dedupe=`shipment_discharged_not_released:${id}`;
function compile(file,deps,names){
  const source=fs.readFileSync(file,'utf8')
    .replace(/^import \{([^}]+)\} from '([^']+)';$/gm,(_,bindings,path)=>`const {${bindings}}=deps[${JSON.stringify(path)}];`)
    .replace(/export (default )?/g,'');
  return new Function('deps','console',source+`\nreturn {${names}};`)(deps,{error(){}});
}
const nativeFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw Error('Missing-date acceptance refuses all external traffic');};
try{
  for(const scenario of [
    {date:null},{date:undefined},{date:''},{date:'invalid'},
    {date:null,previous:true},{date:new Date(Date.now()-6*DAY).toISOString(),active:true},
    {date:new Date(Date.now()-4*DAY).toISOString()},
    {date:new Date(Date.now()-6*DAY).toISOString(),released:true,previous:true}
  ]){
    const reconciliations=[];
    const deps={'./_lib.js':{...lib,
      authorizeAdmin:async()=>({admin_id:id,role:'master_admin'}),writeAudit:async()=>{},
      supabase:async(path,params={})=>{
        if(path==='shipments')return[{id,container_number:'QA-DATE',discharged_at:scenario.date,released_at:scenario.released?new Date().toISOString():null,active:true}];
        if(path==='operational_alert_condition_state')return scenario.previous?[{dedupe_key:dedupe,event_type:'shipment_discharged_not_released',shipment_id:id}]:[];
        assert.equal(path,'rpc/reconcile_operational_alert_condition');
        reconciliations.push(params.body);return{action:'refreshed'};
      }}};
    deps['./_alert-lifecycle.js']=compile('api/_alert-lifecycle.js',deps,'DAY,alertKey,validDate,elapsedDays,repeatDue,loadConditionMap,reconcileAlert,closeCondition,changedAction');
    const handler=compile('api/discharge-release-alerts.js',deps,'handler').handler;
    const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
    await handler({method:'GET',headers:{}},res);
    assert.equal(res.statusCode,200);
    const active=reconciliations.filter(r=>r.p_condition_active===true);
    assert.equal(active.length,scenario.active?1:0,'a missing/recent/released discharge cannot open an alert');
    if(scenario.active)assert.ok(active[0].p_payload.days_since_discharge>=6&&active[0].p_payload.days_since_discharge<7);
    if(scenario.previous){assert.equal(reconciliations.length,1);assert.equal(reconciliations[0].p_condition_active,false,'previous false alerts are closed by the canonical reconciler');}
  }
}finally{globalThis.fetch=nativeFetch;}
console.log('Alert dates: missing/invalid dates never become 1970; real overdue discharges remain eligible and stale false conditions close.');
