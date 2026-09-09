import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import { setTimeout as pause } from 'node:timers/promises';
import login from '../../api/login.js';
import account from '../../api/account.js';
import admins from '../../api/admins.js';
import access from '../../api/access-control.js';
import payments from '../../api/invoice-payments.js';
import invoices from '../../api/invoices.js';
import live from '../../api/live-updates.js';
import { createToken } from '../../api/_lib.js';

const routes = {'/api/login':login,'/api/account':account,'/api/admins':admins,
  '/api/access-control':access,'/api/invoice-payments':payments,'/api/invoices':invoices,'/api/live-updates':live};

// Host the unmodified Vercel handlers on loopback. Only the /rest/v1 prefix is
// stripped before proxying to the real PostgREST process; SQL, auth, projection,
// permissions, request transactions and auditing are not replaced with mocks.
async function startApi() {
  const rest = new URL(process.env.ERP_TEST_POSTGREST_URL || 'http://127.0.0.1:3000');
  if(rest.protocol!=='http:' || !['127.0.0.1','localhost','[::1]'].includes(rest.hostname)
    || rest.username || rest.password || rest.pathname!=='/' || rest.search) throw Error('PostgREST must be local QA');
  const secret=process.env.ERP_TEST_POSTGREST_SECRET;
  if(!secret || secret.length<32)throw Error('A disposable PostgREST JWT secret is required');
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encode({alg:'HS256',typ:'JWT'})}.${encode({role:'service_role',exp:Math.floor(Date.now()/1000)+3600})}`;
  const serviceToken=`${unsigned}.${crypto.createHmac('sha256',secret).update(unsigned).digest('base64url')}`;
  const previous={};
  for(const key of ['JWT_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])previous[key]=process.env[key];
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://qa.invalid');
    if(url.pathname.startsWith('/rest/v1/')) {
      const upstream=http.request(new URL(url.pathname.slice('/rest/v1'.length)+url.search,rest),{
        method:req.method,headers:{...req.headers,host:rest.host}
      },reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
      upstream.on('error',()=>{res.writeHead(502);res.end('QA database transport failed');});
      req.pipe(upstream);return;
    }
    const handler=routes[url.pathname];
    if(!handler){res.writeHead(404);res.end();return;}
    req.query=Object.fromEntries(url.searchParams);
    try{await handler(req,res);}
    catch(error){res.writeHead(500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.code||'QA_HANDLER_FAILED'}));}
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}`;
  process.env.JWT_SECRET=crypto.randomBytes(48).toString('base64url');
  process.env.SUPABASE_URL=base;
  process.env.SUPABASE_SERVICE_ROLE_KEY=serviceToken;
  return {
    async request(path,{method='GET',token,body}={}) {
      const response=await fetch(`${base}/api/${path}`,{method,signal:AbortSignal.timeout(20000),
        headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},
        body:body===undefined?undefined:JSON.stringify(body)});
      return {status:response.status,body:await response.json()};
    },
    async ready(db) {
      await db.query("notify pgrst, 'reload schema'");
      const deadline=Date.now()+15000;
      while(Date.now()<deadline) {
        try {
          const r=await fetch(`${rest}admin_users?select=id&limit=0`,{headers:{Authorization:`Bearer ${serviceToken}`},signal:AbortSignal.timeout(1000)});
          await r.text();if(r.status===200)return;
        }catch{}
        await pause(150);
      }
      throw Error('Real PostgREST did not become ready after the schema reload');
    },
    async close(){
      server.closeIdleConnections();await new Promise(resolve=>server.close(resolve));
      for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}
    }
  };
}

export async function checkOperatorHttp({db,f,users,test}) {
  const api=await startApi();
  const expect=(r,status)=>assert.equal(r.status,status,`${r.body?.error||''} ${r.body?.details?.code||''}`);
  const tokens={};
  const readKeys=['finance.read','reports.read'];
  const writeKeys=[...readKeys,'finance.write'];
  const role=async(keys,extra={})=>{
    const r=await api.request('access-control?resource=roles',{method:'PATCH',token:tokens.master,
      body:{id:users.b.access_role_id,permission_keys:keys,...extra}});expect(r,200);
  };
  const enter=async key=>{
    const r=await api.request('login',{method:'POST',body:{username:users[key].username,password:users[key].password}});
    expect(r,200);assert.equal(r.body.user.id,users[key].id);assert.ok(r.body.token);tokens[key]=r.body.token;
  };
  const pay=(token,inv,amount)=>api.request('invoice-payments',{method:'POST',token,body:{action:'register',invoice_id:inv.id,amount}});
  const liveState=token=>api.request('live-updates',{token});
  try {
    await api.ready(db);
    await test('HTTP-01 real password login creates distinct operator sessions',async()=>{
      assert.notEqual(users.a.id,users.b.id);
      for(const key of ['master','a','b'])await enter(key);
      assert.notEqual(tokens.a,tokens.b);
      const ids=(await db.query("select actor_admin_id from audit_log where action='login'")).rows.map(r=>r.actor_admin_id);
      for(const key of ['master','a','b'])assert.ok(ids.includes(users[key].id));
    });
    // A failed login must not cause later cases to accidentally send no session.
    if(!tokens.master||!tokens.a||!tokens.b)throw Error('Operator login prerequisite failed');
    await role(readKeys);
    await test('HTTP-02 unauthenticated and tampered sessions are rejected',async()=>{
      expect(await liveState(),401);
      const invalid=tokens.a.slice(0,-1)+(tokens.a.endsWith('a')?'b':'a');
      expect(await liveState(invalid),401);
      expect(await api.request('invoices'),401);
    });
    await test('HTTP-03 reader can inspect invoices but cannot collect or administer roles',async()=>{
      const inv=await f.invoice(await f.sale());
      expect(await api.request('invoices',{token:tokens.b}),200);
      const before=(await liveState(tokens.b)).body.versions;
      expect(await pay(tokens.b,inv,50),403);
      expect(await api.request('access-control?resource=roles',{token:tokens.b}),403);
      assert.equal(Number((await f.financial(inv)).paid_amount),0);
      assert.deepEqual((await liveState(tokens.b)).body.versions,before);
    });
    await test('HTTP-04 committed collection is visible to both operators with the same version',async()=>{
      const inv=await f.invoice(await f.sale());
      const before=(await liveState(tokens.b)).body.versions.invoices;
      const result=await pay(tokens.a,inv,120);expect(result,200);
      const states=await Promise.all([liveState(tokens.a),liveState(tokens.b)]);
      states.forEach(r=>expect(r,200));
      assert.ok(states[0].body.versions.invoices>before);
      assert.equal(states[0].body.versions.invoices,states[1].body.versions.invoices);
      assert.equal(Number((await f.financial(inv)).balance_due),280);
      const audit=await f.one("select actor_admin_id from audit_log where action='invoice_payment_registered' and entity_id=$1",[result.body.payment.id]);
      assert.equal(audit.actor_admin_id,users.a.id);
    });
    await test('HTTP-05 permission changes apply to the existing session and stale claims cannot bypass them',async()=>{
      const inv=await f.invoice(await f.sale());
      await role(writeKeys);expect(await pay(tokens.b,inv,50),200);
      await role(readKeys);expect(await pay(tokens.b,inv,50),403);
      const version=(await f.one('select session_version from admin_users where id=$1',[users.b.id])).session_version;
      const stale=createToken({admin:true,admin_id:users.b.id,role:'master_admin',session_version:Number(version)});
      expect(await pay(stale,inv,50),403);
      const context=await api.request('account',{token:tokens.b});expect(context,200);
      assert.ok(!context.body.account.permissions.includes('finance.write'));
      assert.equal(Number((await f.financial(inv)).paid_amount),50);
    });
    await test('HTTP-06 concurrent HTTP collections use separate PostgREST transactions',async()=>{
      await role(writeKeys);
      const inv=await f.invoice(await f.sale()),holder=await db.connect();
      let pending;
      try {
        await holder.query('begin');await holder.query('select id from invoices where id=$1 for update',[inv.id]);
        pending=Promise.all([pay(tokens.a,inv,300),pay(tokens.b,inv,300)]);
        let blocked=0;const deadline=Date.now()+7000;
        while(Date.now()<deadline) {
          blocked=Number((await db.query('select count(*)::int as n from pg_stat_activity where $1::int=any(pg_blocking_pids(pid))',[holder.processID])).rows[0].n);
          if(blocked>=2)break;await pause(20);
        }
        assert.ok(blocked>=2,'both real HTTP transactions must overlap at the invoice');
        await holder.query('commit');
        const results=await pending;assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
        const rejected=results.find(r=>r.status===400);assert.equal(rejected.body.details.code,'PAYMENT_EXCEEDS_BALANCE');
        assert.equal(Number((await f.financial(inv)).paid_amount),300);
        assert.equal((await f.rows('select id from payments where invoice_id=$1',[inv.id])).length,1);
      }finally{await holder.query('rollback');if(pending)await pending;holder.release();}
    });
    await test('HTTP-07 revocation invalidates only the selected operator and fresh login works',async()=>{
      const r=await api.request('admins',{method:'PATCH',token:tokens.master,body:{id:users.b.id,revoke_sessions:true,reason:'QA revocation'}});expect(r,200);
      expect(await liveState(tokens.b),401);expect(await liveState(tokens.a),200);
      const inv=await f.invoice(await f.sale());expect(await pay(tokens.b,inv,50),401);
      await enter('b');expect(await liveState(tokens.b),200);
      assert.equal(Number((await f.financial(inv)).paid_amount),0);
    });
    await test('HTTP-08 password change revokes the old token and previous password',async()=>{
      const oldToken=tokens.b,oldPassword=users.b.password;
      const next=crypto.randomBytes(24).toString('base64url');
      const r=await api.request('account',{method:'PATCH',token:tokens.b,body:{current_password:oldPassword,new_password:next}});expect(r,200);
      expect(await liveState(oldToken),401);expect(await liveState(r.body.token),200);
      expect(await api.request('login',{method:'POST',body:{username:users.b.username,password:oldPassword}}),401);
      users.b.password=next;await enter('b');
      assert.equal(Number((await f.one('select failed_attempts from admin_users where id=$1',[users.b.id])).failed_attempts),0);
    });
    await test('HTTP-09 inactive role removes permissions and inactive account rejects its session',async()=>{
      await role(writeKeys,{is_active:false});
      expect(await api.request('invoices',{token:tokens.b}),403);
      await role(writeKeys,{is_active:true});expect(await api.request('invoices',{token:tokens.b}),200);
      await db.query('update admin_users set is_active=false where id=$1',[users.b.id]);
      expect(await liveState(tokens.b),401);
      expect(await api.request('login',{method:'POST',body:{username:users.b.username,password:users.b.password}}),403);
      await db.query('update admin_users set is_active=true where id=$1',[users.b.id]);
      expect(await liveState(tokens.a),200);
    });
    await test('HTTP-10 consecutive invalid passwords lock login without changing another account',async()=>{
      for(let i=0;i<5;i++)expect(await api.request('login',{method:'POST',body:{username:users.b.username,password:'QA deliberately incorrect'}}),401);
      expect(await api.request('login',{method:'POST',body:{username:users.b.username,password:users.b.password}}),429);
      const user=await f.one('select failed_attempts,locked_until from admin_users where id=$1',[users.b.id]);
      assert.equal(Number(user.failed_attempts),5);assert.ok(new Date(user.locked_until)>new Date());
      expect(await liveState(tokens.a),200);
    });
  }finally{await api.close();}
}
