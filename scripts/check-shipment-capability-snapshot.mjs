import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createFinanceAcceptanceDb} from './lib/finance-acceptance-db.mjs';
import {financeFixture} from './lib/finance-acceptance-fixture.mjs';

// Actual migration and canonical owners in a disposable in-memory PostgreSQL.
// Real multi-connection HTTP/capacity verification runs separately in CI.
const db=await createFinanceAcceptanceDb();
try{
  for(const name of ['20260831235500_ux5_shipment_action_capabilities.sql',
    '20261001025606_shipment_action_capability_snapshot.sql'])await db.exec(fs.readFileSync(`supabase/migrations/${name}`,'utf8'));
  const one=async(sql,params=[])=>(await db.query(sql,params)).rows[0];
  assert.deepEqual((await one('select shipment_action_capability_snapshot() rows')).rows,[]);
  const f=await financeFixture(db);
  // Existing reversible contract covers linked loads, released/delivered and
  // reactivation restrictions; the snapshot keeps this owner unchanged.
  const fixture=await db.exec(fs.readFileSync('supabase/tests/ux5_shipment_actions.sql','utf8'));
  assert.deepEqual(fixture.at(-1).rows[0],{shipment_fixture_residue:0,load_fixture_residue:0});
  await db.query(`insert into shipments(container_number,client_id,importer_id,active,released_at,delivered_at)
    select 'QA-SNAPSHOT-'||g,case when g%2=0 then $1::uuid else null end,$2,
      g%7<>0,case when g%3=0 then now() else null end,case when g%5=0 then now() else null end
    from generate_series(1,2000) g`,[f.client,f.importer]);
  const states=await one(`select shipment_action_capability_snapshot() snapshot,
    (select jsonb_agg(jsonb_build_object('shipment_id',shipment_id,'capabilities',capabilities) order by shipment_id) from shipment_action_capabilities) canonical`);
  assert.equal(states.snapshot.length,2000);assert.deepEqual(states.snapshot,states.canonical);
  await assert.rejects(db.query('select shipment_action_capability_snapshot(1999)'),/SHIPMENT_LIST_VOLUME_LIMIT/);
  for(const limit of [null,0,-1,50001])await assert.rejects(db.query('select shipment_action_capability_snapshot($1)',[limit]),/SHIPMENT_LIST_QUERY_INVALID/);
  const privileges=await one(`select prosecdef as definer,provolatile as volatility,
    has_function_privilege('anon',oid,'execute') anonymous,
    has_function_privilege('authenticated',oid,'execute') authenticated,
    has_function_privilege('service_role',oid,'execute') service
    from pg_proc where oid='public.shipment_action_capability_snapshot(integer)'::regprocedure`);
  assert.deepEqual(privileges,{definer:false,volatility:'s',anonymous:false,authenticated:false,service:true});
  for(const role of ['anon','authenticated']){
    await db.exec(`set role ${role}`);
    try{await assert.rejects(db.query('select public.shipment_action_capability_snapshot()'),/permission denied/);}
    finally{await db.exec('reset role');}
  }
  console.log('Shipment capability snapshot: empty/mixed states, 2000 canonical rows, reversible UX5 rules, bounds and denied public execution passed.');
}finally{await db.close();}
