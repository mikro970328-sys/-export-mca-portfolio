import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('api/account.js','utf8')
  .replace(/^import .*;\n/gm,'')
  .replace('export default async function handler','async function handler');
const deferred=()=>{
  let resolve,reject;
  const promise=new Promise((done,fail)=>{resolve=done;reject=fail;});
  return {promise,resolve,reject};
};
const tick=()=>new Promise(setImmediate);
const account={id:'simulated-admin',username:'simulated-user',full_name:'Simulated User',role:'admin',is_active:true,access_role_id:'simulated-role'};
const access={permissions:['dashboard.read'],teams:[{team_id:'simulated-team'}],access_role:{id:'simulated-role',is_active:true}};

function harness(){
  const authentication=deferred(),profile=deferred(),permissions=deferred(),calls=[];
  const response={headers:{},setHeader(name,value){this.headers[name]=value;}};
  const context={
    console:{error(){}},
    authenticateAdmin:()=>authentication.promise,
    supabase(table,options){calls.push({table,options});assert.equal(table,'admin_users');assert.ok(!options.method,'account loading must only read');assert.ok(!options.query.includes('password_hash'),'profile reads must exclude password material');return profile.promise;},
    loadAdminAccessContext(id){calls.push({kind:'access',id});return permissions.promise;},
    ok(res,data){res.status=200;res.body=data;},
    fail(res,status,error){res.status=status;res.body={error};}
  };
  vm.runInNewContext(`${source}\nthis.handler=handler;`,context,{filename:'api/account.js'});
  return {authentication,profile,permissions,calls,response,run:()=>context.handler({method:'GET'},response)};
}

for(const first of ['profile','permissions']){
  const h=harness(),loading=h.run();
  await tick();
  assert.equal(h.calls.length,0,'all reads must wait for live authentication');
  h.authentication.resolve({admin_id:account.id,role:account.role});
  await tick();
  assert.equal(h.calls.length,2,'profile and access must start together');
  h[first].resolve(first==='profile'?[account]:access);
  await tick();
  assert.equal(h.response.status,undefined,'a partial read must not expose the account');
  const last=first==='profile'?'permissions':'profile';
  h[last].resolve(last==='profile'?[account]:access);
  await loading;
  assert.equal(h.response.status,200);
  assert.equal(h.response.body.account.id,account.id);
  assert.equal(h.response.body.account.permissions.join(','),'dashboard.read');
  assert.equal(h.response.body.account.access_role.id,'simulated-role');
  assert.match(h.response.headers['Server-Timing'],/authorization_ms;dur=\d+/);
  assert.match(h.response.headers['Server-Timing'],/access_ms;dur=\d+/);
}

for(const profile of [[],[{...account,is_active:false}]]){
  const h=harness(),loading=h.run();
  h.authentication.resolve({admin_id:account.id});
  await tick();
  h.profile.resolve(profile);
  h.permissions.resolve(access);
  await loading;
  assert.equal(h.response.status,403);
  assert.equal(h.response.body.account,undefined,'missing or inactive profiles must remain denied');
}

const failed=harness(),failedLoad=failed.run();
failed.authentication.resolve({admin_id:account.id});
await tick();
failed.profile.resolve([account]);
failed.permissions.reject(new Error('simulated permissions outage'));
await failedLoad;
assert.equal(failed.response.status,500);
assert.equal(failed.response.body.account,undefined,'failed access reads must not expose a partial account');

const denied=harness(),deniedLoad=denied.run();
denied.authentication.resolve(null);
await deniedLoad;
assert.equal(denied.calls.length,0,'denied authentication must stop all profile and access reads');

console.log('Account load: parallel reads, live authentication, inactive-account and failed-access guards passed.');
