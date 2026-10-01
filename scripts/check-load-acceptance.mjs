import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import { performance } from 'node:perf_hooks';
import { createOperatorAcceptanceDb } from './lib/operator-acceptance-db.mjs';
import { applyTrackingWorkflowAcceptanceSchema } from './lib/tracking-workflow-acceptance-db.mjs';
import { operatorFixture } from './lib/operator-acceptance-fixture.mjs';
import { startOperatorApi } from './lib/operator-acceptance-http.mjs';
import { hashPassword } from '../api/_lib.js';
import dashboard from '../api/dashboard.js';
import financial from '../api/dashboard-financial.js';
import shipments from '../api/shipments.js';

if(process.env.ERP_LOAD_ACCEPTANCE!=='synthetic-only')throw Error('Explicit synthetic-only load acceptance is required');
const levels=[5,20,50],rounds=3,shipmentCount=2000,clientCount=500,invoiceCount=100;
const baselineDir=process.env.ERP_LOAD_BASELINE_DIR;
let baselineShipments;
if(baselineDir){
  const expected=path.resolve('.load-acceptance-baseline');
  assert.equal(fs.realpathSync(baselineDir),expected,'baseline must be the isolated local checkout');
  baselineShipments=(await import(pathToFileURL(path.join(expected,'api/shipments.js')))).default;
}
const report={environment:'isolated-loopback PostgreSQL/PostgREST; not production latency',
  baseline_ref:process.env.ERP_LOAD_BASELINE_REF||null,
  seed:{shipments:shipmentCount,additional_clients:clientCount,invoices:invoiceCount},rounds,stages:[],errors:[]};
const db=await createOperatorAcceptanceDb(),nativeFetch=globalThis.fetch;
let api;
try{
  report.postgres=(await db.query('show server_version')).rows[0].server_version;
  await applyTrackingWorkflowAcceptanceSchema(db);
  await db.exec(`alter table clients add column phone text,add column email text,add column welcome_status text default 'pending',add column created_at timestamptz default now();
    alter table shipments add column release_method text,add column released_by_admin_id uuid,add column released_by_username text,add column release_notification_status text default 'pending',add column release_notification_error text;
    grant update on shipments to service_role;
    grant select,insert on shipment_history to service_role;
    grant select on documents,load_expediente_documents,load_traceability_sources,load_traceability_summary,notifications,webhook_events to service_role;`);
  const attention=fs.readFileSync('supabase/migrations/20260830223000_p11_executive_dashboard_profitability.sql','utf8');
  const marker='create or replace view public.executive_operational_attention';
  assert.equal(attention.split(marker).length,2);
  await db.exec(attention.slice(attention.indexOf(marker)));
  for(const name of ['20260831235500_ux5_shipment_action_capabilities.sql',
    '20260928232500_admin_dashboard_snapshot.sql','20260929041000_dashboard_cache_stable_versions.sql',
    '20260929042623_dashboard_operational_cache_cleanup_fix.sql'])await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));
  const {f,users}=await operatorFixture(db);
  const permissions=['dashboard.read','clients.read','logistics.read','logistics.write','documents.read','finance.read','reports.read','sales.read','warehouse.read','procurement.read','tasks.read','notifications.read'];
  await db.query('select set_access_role_permissions($1,$2::text[],$3)',[users.a.access_role_id,permissions,users.master.id]);
  const actors=[];
  for(let i=0;i<Math.max(...levels);i++){
    const password=crypto.randomBytes(24).toString('base64url'),hash=hashPassword(password);
    const user=await f.one(`insert into admin_users(full_name,username,role,access_role_id,password_salt,password_hash)
      values($1,$2,'admin',$3,$4,$5) returning id,username`,[`QA load ${i}`,`qa.load.${i}`,users.a.access_role_id,hash.salt,hash.hash]);
    actors.push({...user,password});
  }
  await db.query("insert into clients(name) select 'QA load customer '||g from generate_series(1,$1) g",[clientCount]);
  await db.query(`insert into shipments(container_number,client_id,importer_id)
    select 'QA-LOAD-'||lpad(g::text,6,'0'),c.ids[1+(g-1)%$1],$2
    from generate_series(1,$3) g cross join (select array_agg(id order by id) ids from clients where name like 'QA load customer %') c`,[clientCount,f.importer,shipmentCount]);
  const rows=await f.rows("select id from shipments where container_number like 'QA-LOAD-%' order by container_number");
  assert.equal(rows.length,shipmentCount);
  for(let i=0;i<invoiceCount;i++)await f.invoice(await f.sale());
  await db.exec('analyze');
  const expectedFinancial=await f.dashboard();
  const handlers={'/api/dashboard':dashboard,'/api/dashboard-financial':financial,'/api/shipments':shipments};
  if(baselineShipments)handlers['/api/load-baseline-shipments']=baselineShipments;
  api=await startOperatorApi({fallbackHandler:async(req,res,url)=>{
    req.query=Object.fromEntries(url.searchParams);
    const handler=handlers[url.pathname];
    if(!handler){res.writeHead(404);res.end();return;}
    await handler(req,res);
  }});
  const allowed=new Set([api.base,new URL(process.env.ERP_TEST_POSTGREST_URL).origin]);
  let databaseRequests;
  globalThis.fetch=(input,options)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(!allowed.has(url.origin))throw Error('Load acceptance refuses external traffic');
    if(databaseRequests&&url.pathname.startsWith('/rest/v1/')){
      const key=(options?.method||'GET')+' '+url.pathname.slice('/rest/v1/'.length);
      databaseRequests.set(key,(databaseRequests.get(key)||0)+1);
    }
    return nativeFetch(input,options);
  };
  await api.ready(db);
  for(const actor of actors){
    const login=await api.request('login',{method:'POST',body:{username:actor.username,password:actor.password}});
    assert.equal(login.status,200,'real QA login');assert.equal(login.body.user.id,actor.id);
    actor.token=login.body.token;delete actor.password;
  }
  if(baselineShipments){
    const [before,after]=await Promise.all([
      api.request('load-baseline-shipments',{token:actors[0].token}),
      api.request('shipments',{token:actors[0].token})
    ]);
    assert.equal(before.status,200);assert.equal(after.status,200);
    assert.deepEqual(after.body,before.body,'optimization must preserve the full shipment list, fulfillment and permission contract');
    report.list_contract_matches_baseline=true;
  }
  const expectedWrites=[];
  const percentile=(values,p)=>values[Math.max(0,Math.ceil(values.length*p)-1)];
  for(const concurrentUsers of levels){
    // Alternate which implementation runs first, on the same seeded database,
    // runner and real HTTP/PostgREST transport. No response/permission caching.
    const variants=baselineShipments?(concurrentUsers===20?['current','baseline']:['baseline','current']):['current'];
    for(const variant of variants){
    const shipmentPath=variant==='baseline'?'load-baseline-shipments':'shipments';
    databaseRequests=new Map();
    const samples=new Map(),timings=new Map();
    const measure=async(label,path,actor,{method='GET',body,validate=()=>{}}={})=>{
      const started=performance.now();
      try{
        const response=await fetch(`${api.base}/api/${path}`,{method,signal:AbortSignal.timeout(20000),
          headers:{Authorization:`Bearer ${actor.token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
        const data=await response.json();
        assert.equal(response.status,200,`${label}: HTTP ${response.status}`);validate(data);
        const elapsed=performance.now()-started;
        if(!samples.has(label))samples.set(label,[]);samples.get(label).push(elapsed);
        for(const metric of (response.headers.get('server-timing')||'').split(',')){
          const match=metric.trim().match(/^([a-z_]+);dur=([\d.]+)$/);
          if(match){const key=label+':'+match[1];if(!timings.has(key))timings.set(key,[]);timings.get(key).push(Number(match[2]));}
        }
      }catch(error){report.errors.push({variant,concurrent_users:concurrentUsers,route:label,message:error.message});throw error;}
    };
    const settled=await Promise.allSettled(actors.slice(0,concurrentUsers).map(async(actor,index)=>{
      for(let round=0;round<rounds;round++){
        await measure('account','account',actor,{validate:data=>assert.equal(data.account.id,actor.id)});
        await measure('overview','dashboard',actor,{validate:data=>{assert.equal(data.stats.total,shipmentCount);assert.equal(data.stats.clients,clientCount+2);}});
        await measure('financial','dashboard-financial',actor,{validate:data=>{
          const {owner,generated_at,...payload}=data;assert.deepEqual(payload,expectedFinancial);
        }});
        await measure('shipments',shipmentPath,actor,{validate:data=>{
          assert.equal(data.shipments.length,shipmentCount,'shipment list must include the entire seeded dataset');
          assert.ok(data.shipments.every(row=>row.capabilities?.actions?.edit?.allowed===true),'capabilities must cover all pages');
        }});
        const row=rows[(variant==='baseline'?800:0)+levels.indexOf(concurrentUsers)*200+round*50+index],booking=`QA-LOAD-${variant}-${concurrentUsers}-${round}-${index}`;
        await measure('save',shipmentPath,actor,{method:'PATCH',body:{id:row.id,booking_number:booking},validate:data=>assert.equal(data.shipment.booking_number,booking)});
        expectedWrites.push({id:row.id,booking});
      }
    }));
    const summarize=values=>{const sorted=values.sort((a,b)=>a-b);return{n:sorted.length,p50_ms:+percentile(sorted,.5).toFixed(1),p95_ms:+percentile(sorted,.95).toFixed(1),p99_ms:+percentile(sorted,.99).toFixed(1),max_ms:+sorted.at(-1).toFixed(1)};};
    report.stages.push({variant,concurrent_users:concurrentUsers,routes:Object.fromEntries([...samples].map(([name,values])=>[name,summarize(values)])),server_timing:Object.fromEntries([...timings].map(([name,values])=>[name,summarize(values)])),database_requests:Object.fromEntries(databaseRequests)});
    console.log(JSON.stringify(report.stages.at(-1)));
    if(report.errors.length)console.error(JSON.stringify(report.errors.slice(-5)));
    assert.equal(settled.filter(r=>r.status==='rejected').length,0,'all concurrent workflows must succeed');
    }
  }
  databaseRequests=null;
  report.comparison=levels.map(concurrent_users=>{
    const before=report.stages.find(s=>s.variant==='baseline'&&s.concurrent_users===concurrent_users);
    const after=report.stages.find(s=>s.variant==='current'&&s.concurrent_users===concurrent_users);
    return before?{concurrent_users,p95_change_percent:Object.fromEntries(['shipments','save'].map(route=>
      [route,+((after.routes[route].p95_ms/before.routes[route].p95_ms-1)*100).toFixed(1)]))}:null;
  }).filter(Boolean);
  console.log('LOAD_COMPARISON '+JSON.stringify(report.comparison));
  for(const write of expectedWrites){
    const stored=await f.one('select booking_number from shipments where id=$1',[write.id]);assert.equal(stored.booking_number,write.booking);
    const evidence=await f.one(`select
      (select count(*)::int from shipment_history where shipment_id=$1 and event_type='updated' and details::jsonb->>'booking_number'=$2) as history,
      (select count(*)::int from audit_log where entity_id=$1 and action='shipment_updated' and details->>'booking_number'=$2) as audit`,[write.id,write.booking]);
    assert.deepEqual(evidence,{history:1,audit:1},'each confirmed save requires exactly one durable history and audit record');
  }
  report.confirmed_saves=expectedWrites.length;
  const counts=await f.one('select (select count(*)::int from notifications) messages,(select count(*)::int from push_delivery_queue) push');
  assert.deepEqual(counts,{messages:0,push:0},'load test must never send notifications');
  report.errors=[];console.log(`Load acceptance passed: ${expectedWrites.length} durable saves; no notifications sent.`);
}finally{
  // Aggregate timings contain no passwords, tokens, rows or customer data.
  fs.writeFileSync('load-acceptance-metrics.json',JSON.stringify(report,null,2)+'\n');
  globalThis.fetch=nativeFetch;
  if(api)await api.close();await db.end();
}
