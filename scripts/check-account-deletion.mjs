import fs from 'node:fs';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
import {JSDOM,VirtualConsole} from 'jsdom';
import {applyOperatorAcceptanceSchema} from './lib/operator-acceptance-db.mjs';
import {applyTrackingWorkflowAcceptanceSchema} from './lib/tracking-workflow-acceptance-db.mjs';
import {operatorFixture} from './lib/operator-acceptance-fixture.mjs';
import {accessAccountFixture} from './lib/figma-access-account-fixture.mjs';
import handler from '../api/admins.js';
import {authenticateAdmin,createToken} from '../api/_lib.js';

const db=new PGlite({extensions:{pgcrypto}});
const rows=async(sql,args=[]) => (await db.query(sql,args)).rows;
const one=async(sql,args=[]) => (await rows(sql,args))[0];
const read=path=>fs.readFileSync(path,'utf8');
const migration=fs.existsSync('supabase/account-deletion.pending.sql') ? 'supabase/account-deletion.pending.sql' : fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('_admin_account_deletion.sql')).map(f=>'supabase/migrations/'+f).at(-1);
const response=()=>({statusCode:0,setHeader(){},end(value){this.body=JSON.parse(value);}});
const tick=()=>new Promise(r=>setTimeout(r,20));
try {
  await db.waitReady;
  await applyOperatorAcceptanceSchema(db);
  await db.exec(read('supabase/workers.sql'));
  await db.exec('alter table workers add column position text');
  // Legacy publication identity fields used by the deletion routine; this
  // fixture has no publication business RPCs or replacement financial guards.
  await db.exec('create table commercial_publications(id uuid primary key default gen_random_uuid(),assigned_admin_id uuid references admin_users(id) on delete set null,created_by uuid references admin_users(id) on delete set null)');
  await applyTrackingWorkflowAcceptanceSchema(db);
  await db.exec(read('supabase/migrations/20260831005100_p17_admin_worker_atomic_audit.sql'));
  const {f,users}=await operatorFixture(db);
  const calculated=await f.sale({lines:[{product_id:f.product,ordered_quantity:'',ordered_pallets:40,units_per_pallet:490,line_total:18994}]});
  assert.equal(Number(calculated.items[0].ordered_quantity),19600);
  assert.equal(Number(calculated.items[0].ordered_pallets),40);
  const fullInvoice=await f.invoice(calculated,{issued:false});
  assert.equal(Number((await one('select round(sum(line_total),2) as total from invoice_items where invoice_id=$1',[fullInvoice.id])).total),18994);
  const halfSale=await f.sale({lines:[{product_id:f.product,ordered_quantity:'',ordered_pallets:40,units_per_pallet:490,line_total:18994}]});
  const halfInvoice=await f.invoice(halfSale,{issued:false,quantity:9800});
  assert.equal(Number((await one('select round(sum(line_total),2) as total from invoice_items where invoice_id=$1',[halfInvoice.id])).total),9497);
  console.log('Sales SQL: pallets calculate 19600 boxes; full/partial invoices preserve agreed amounts 18994/9497.');
  const so=await f.sale();
  const cost=await one("select * from create_posted_cost_charge(p_category=>'domestic_trucking',p_stage=>'fulfillment',p_amount=>50,p_currency=>'USD',p_allocations=>$1::jsonb,p_actor=>$2)",[JSON.stringify([{sales_order_id:so.id,amount:50,basis:'manual'}]),users.a.id]);
  const costBefore=await one('select to_jsonb(c) as row from cost_charges c where id=$1',[cost.id]);
  const audit=await one("insert into audit_log(actor_admin_id,actor_username,action,entity_type,entity_id) values($1,$2,'qa_original','cost_charge',$3) returning *",[users.a.id,users.a.username,cost.id]);
  await db.exec('begin');await db.exec(read(migration));await db.exec('commit');
  assert.equal((await one('select count(*)::int as n from private.admin_actor_identities')).n,3);
  await assert.rejects(db.query('select * from delete_admin_account_with_audit($1,$2,$3)',[users.a.id,users.b.id,users.a.username]),/ADMIN_PERMISSION_DENIED/);
  await assert.rejects(db.query('select * from delete_admin_account_with_audit($1,$2,$3)',[users.master.id,users.master.id,users.master.username]),/SELF_DELETION_FORBIDDEN/);
  const otherMaster=await one("insert into admin_users(full_name,username,role,password_salt,password_hash) values('QA other master','qa.other.master','master_admin','qa-only','qa-only') returning id");
  await assert.rejects(db.query('select * from delete_admin_account_with_audit($1,$2,$3)',[otherMaster.id,users.master.id,'qa.other.master']),/MASTER_ADMIN_DELETE_FORBIDDEN/);
  await assert.rejects(db.query('select * from delete_admin_account_with_audit($1,$2,$3)',[users.a.id,users.master.id,'wrong-name']),/ADMIN_DELETE_CONFIRMATION_REQUIRED/);
  assert.ok(await one('select id from admin_users where id=$1',[users.a.id]));
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role);
    await assert.rejects(db.query('select * from public.delete_admin_account_with_audit($1,$2,$3)',[users.a.id,users.master.id,users.a.username]),/permission denied/);
    await db.exec('reset role');
  }
  const task=await one("insert into operational_tasks(title,assigned_admin_id,created_by) values('QA retain assignment history',$1,$1) returning id",[users.a.id]);
  await db.query('insert into notification_preferences(admin_user_id) values($1) on conflict do nothing',[users.a.id]);
  const inbox=await one("insert into notification_inbox_items(recipient_admin_id,source_type,source_id,source_version,source_event_type,target_type,target_id,title) values($1,'task',$2,'qa-1','assignment','user',$1,'QA notification') returning id",[users.a.id,task.id]);
  const device=await one("insert into push_subscriptions(admin_user_id,endpoint,endpoint_hash,p256dh,auth_secret,device_label,session_version) values($1,'https://push.example.test/qa',repeat('a',64),repeat('b',87),repeat('c',22),'QA device',1) returning id",[users.a.id]);
  await db.query('insert into push_delivery_queue(inbox_item_id,subscription_id,recipient_admin_id) values($1,$2,$3)',[inbox.id,device.id,users.a.id]);
  await db.query('insert into commercial_publications(assigned_admin_id,created_by) values($1,$1)',[users.a.id]);
  process.env.JWT_SECRET='qa-account-delete-only-0123456789';
  process.env.SUPABASE_URL='https://qa-account-delete.invalid';
  process.env.SUPABASE_SERVICE_ROLE_KEY='qa-only';
  const originalFetch=globalThis.fetch;
  const rpcCalls=[];
  globalThis.fetch=async(input,options={})=>{
    const url=new URL(input);assert.equal(url.hostname,'qa-account-delete.invalid');
    let data;
    if(url.pathname==='/rest/v1/admin_users') data=await rows('select id,full_name,username,role,is_active,access_role_id,session_version from admin_users where id=$1',[url.searchParams.get('id').slice(3)]);
    else if(url.pathname==='/rest/v1/admin_effective_permissions') data=[{permission_key:'administration.users.manage'}];
    else if(url.pathname==='/rest/v1/rpc/delete_admin_account_with_audit') {
      const body=JSON.parse(options.body);rpcCalls.push(body);
      try {
        await db.exec('set role service_role');
        data=await rows('select * from public.delete_admin_account_with_audit($1,$2,$3)',[body.p_admin_user_id,body.p_actor,body.p_confirm_username]);
      }catch(error){return new Response(JSON.stringify({message:error.message}),{status:400});}
      finally{await db.exec('reset role');}
    }else throw Error('Unexpected isolated request '+url.pathname);
    return new Response(JSON.stringify(data),{status:200,headers:{'Content-Type':'application/json'}});
  };
  const jwt=user=>createToken({admin:true,admin_id:user.id,username:user.username,role:user.role,session_version:user.session_version});
  const targetToken=jwt(users.a),masterToken=jwt(users.master);
  const call=async(user,id,confirm_username)=>{const res=response();await handler({method:'DELETE',query:{},headers:{authorization:'Bearer '+jwt(user)},body:{id,confirm_username}},res);return res;};
  assert.equal((await call(users.a,users.b.id,users.b.username)).statusCode,403);
  assert.equal((await call(users.master,users.master.id,users.master.username)).statusCode,403);
  assert.equal((await call(users.master,otherMaster.id,'qa.other.master')).statusCode,403);
  assert.equal((await call(users.master,users.a.id,'bad')).statusCode,400);
  const success=await call(users.master,users.a.id,users.a.username);
  assert.equal(success.statusCode,200);assert.equal(success.body.deleted,true);assert.equal(success.body.account.unassigned_tasks,1);
  assert.equal(await one('select id from admin_users where id=$1',[users.a.id]),undefined);
  assert.deepEqual(await one('select to_jsonb(c) as row from cost_charges c where id=$1',[cost.id]),costBefore);
  assert.deepEqual(await one('select * from audit_log where id=$1',[audit.id]),audit);
  assert.equal((await one('select assigned_admin_id from operational_tasks where id=$1',[task.id])).assigned_admin_id,null);
  assert.equal((await one('select created_by from operational_tasks where id=$1',[task.id])).created_by,users.a.id);
  assert.ok(await one('select id from private.admin_actor_identities where id=$1',[users.a.id]));
  for(const [table,column]of [['notification_preferences','admin_user_id'],['push_subscriptions','admin_user_id'],['notification_inbox_items','recipient_admin_id'],['push_delivery_queue','recipient_admin_id'],['team_memberships','admin_user_id']])assert.equal((await one(`select count(*)::int as n from ${table} where ${column}=$1`,[users.a.id])).n,0);
  const denied=response();assert.equal(await authenticateAdmin({headers:{authorization:'Bearer '+targetToken}},denied),null);assert.equal(denied.statusCode,401);
  assert.ok(await authenticateAdmin({headers:{authorization:'Bearer '+masterToken}},response()));
  assert.equal((await call(users.master,users.a.id,users.a.username)).statusCode,404);
  await db.query('update admin_users set is_active=false where id=$1',[users.b.id]);
  assert.equal((await call(users.master,users.b.id,users.b.username)).statusCode,200,'Inactive accounts must also be deletable');
  await assert.rejects(db.query('delete from audit_log where id=$1',[audit.id]),/AUDIT_LOG_APPEND_ONLY/);
  globalThis.fetch=originalFetch;
  console.log('Account deletion SQL/API: master protection, confirmation, permissions, atomic cleanup, immutable financial history, inactive accounts and JWT rejection passed.');
} catch(error) {console.error('Account deletion QA failed:',error.message,error.detail||'');process.exitCode=1;}
finally {await db.close();}

if(!process.exitCode) {
  for(const master of [false,true]) {
    const errors=[];const vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error.message));
    const dom=new JSDOM(accessAccountFixture({master}),{url:'https://erp-visual.invalid',runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc});
    const w=dom.window,d=w.document;await tick();
    const buttons=[...d.querySelectorAll('[data-access-action="delete-user"]')];
    if(!master)assert.equal(buttons.length,0);
    else {
      assert.ok(buttons.length>=2);
      const target=buttons[0];target.click();await tick();
      const id=target.dataset.userId||target.dataset.id;
      const user=w.__fixtureUsers.find(u=>u.id===id)||w.__fixtureUsers.find(u=>u.username===d.querySelector('#accessDeleteUserForm strong')?.textContent.replace('@',''));
      assert.ok(d.getElementById('accessDeleteUserForm'));
      d.getElementById('accessDeleteUsername').value='wrong';d.getElementById('accessDeleteUserForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
      assert.equal(w.__fixtureCalls.filter(c=>c.method==='DELETE').length,0);
      assert.ok(user,'Fixture account is selected');
      d.getElementById('accessDeleteUsername').value=user.username;
      d.getElementById('accessDeleteUserForm').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
      assert.equal(w.__fixtureCalls.filter(c=>c.method==='DELETE').length,1);
      assert.equal(w.__fixtureUsers.some(u=>u.id===user.id),false);
      assert.ok(w.__fixtureUsers.some(u=>u.role==='master_admin'));
    }
    assert.deepEqual(errors,[]);dom.window.close();
  }
  console.log('Account deletion UI: master-only option, protected master, exact confirmation and successful directory removal passed.');
}
