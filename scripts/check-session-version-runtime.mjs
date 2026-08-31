import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { authenticateAdmin, createToken, verifyToken } from '../api/_lib.js';

process.env.JWT_SECRET='p17-ci-session-secret-0123456789';
process.env.SUPABASE_URL='https://p17.example.test';
process.env.SUPABASE_SERVICE_ROLE_KEY='p17-service-role-test';

const account={
  id:'11111111-1111-4111-8111-111111111111',
  full_name:'P17 Fixture',
  username:'p17.fixture',
  role:'master_admin',
  is_active:true,
  access_role_id:null,
  session_version:2
};

globalThis.fetch=async url=>{
  if(!String(url).includes('/rest/v1/admin_users')) throw new Error(`Unexpected fetch: ${url}`);
  return new Response(JSON.stringify([account]),{status:200,headers:{'Content-Type':'application/json'}});
};

const res=()=>({
  statusCode:0,
  headers:{},
  body:'',
  setHeader(k,v){this.headers[k]=v;},
  end(v=''){this.body=String(v);}
});
const req=token=>({headers:{authorization:`Bearer ${token}`}});

const currentToken=createToken({
  admin:true,admin_id:account.id,username:account.username,full_name:account.full_name,role:account.role,session_version:2
});
const currentPayload=verifyToken(currentToken);
assert.equal(currentPayload.session_version,2);
assert.ok(Number.isInteger(currentPayload.iat));
assert.ok(currentPayload.exp>currentPayload.iat);
const currentRes=res();
const authenticated=await authenticateAdmin(req(currentToken),currentRes);
assert.equal(authenticated?.admin_id,account.id);
assert.equal(authenticated?.session_version,2);

const oldToken=createToken({
  admin:true,admin_id:account.id,username:account.username,full_name:account.full_name,role:account.role,session_version:1
});
const oldRes=res();
const rejected=await authenticateAdmin(req(oldToken),oldRes);
assert.equal(rejected,null);
assert.equal(oldRes.statusCode,401);
assert.match(oldRes.body,/revocada|expiró/i);

const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
const header=encode({alg:'HS256',typ:'JWT'});
const now=Math.floor(Date.now()/1000);
const legacyBody=encode({admin:true,admin_id:account.id,username:account.username,role:account.role,iat:now,exp:now+3600});
const legacySig=crypto.createHmac('sha256',process.env.JWT_SECRET).update(`${header}.${legacyBody}`).digest('base64url');
assert.equal(verifyToken(`${header}.${legacyBody}.${legacySig}`),null,'legacy token without session_version must be rejected');

assert.throws(()=>createToken({admin:true,admin_id:account.id,role:account.role}),/SESSION_VERSION_REQUIRED/);
console.log('P17 runtime session-version gate passed.');
