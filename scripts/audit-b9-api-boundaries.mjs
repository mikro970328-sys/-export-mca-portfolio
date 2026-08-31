import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const apiRoot=path.join(root,'api');
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(entry=>{
  const full=path.join(dir,entry.name);
  return entry.isDirectory()?walk(full):[full];
});
const rel=file=>path.relative(root,file).replaceAll('\\','/');
const endpointFiles=walk(apiRoot).filter(file=>file.endsWith('.js')&&!path.basename(file).startsWith('_'));
const explicitPublic=new Set([
  'api/public/publications.js'
]);
const retiredPublic=new Set([
  'api/public-marketplace.js',
  'api/public-tracking.js'
]);
const rows=[];
const unresolved=[];
const legacy=[];
const findings=[];

for(const file of endpointFiles){
  const name=rel(file);
  const src=fs.readFileSync(file,'utf8');
  const permissions=[...src.matchAll(/authorizeAdmin\s*\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  const anyPermissions=[...src.matchAll(/authorizeAdminAny\s*\([^,]+,[^,]+,\s*\[([^\]]*)\]/g)].flatMap(m=>[...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x=>x[1]));
  const hasAuthorize=/\bauthorizeAdmin(?:Any)?\s*\(/.test(src);
  const hasAuthenticate=/\bauthenticateAdmin\s*\(/.test(src);
  const hasScopedIdentity=hasAuthenticate&&/\bloadAdminAccessContext\s*\(/.test(src);
  const hasLegacy=/\brequire(?:Master)?Admin\s*\(/.test(src);
  const login=name==='api/login.js';
  const shipsgoWebhook=name==='api/shipsgo-webhook.js';
  const twilioCallback=name==='api/twilio-status.js';
  const shipsgoVerified=shipsgoWebhook&&/(SHIPSGO_WEBHOOK_SECRET|timingSafeEqual|signature)/i.test(src);
  const twilioVerified=twilioCallback&&/x-twilio-signature/i.test(src)&&/validateTwilioRequest\s*\(/.test(src)&&/TWILIO_STATUS_CALLBACK_URL/.test(src);
  const retiredVerified=retiredPublic.has(name)&&/fail\s*\(\s*res\s*,\s*410\b/.test(src)&&!\bsupabase\b/.test(src);
  let boundary='UNCLASSIFIED';

  if(explicitPublic.has(name)) boundary='public_explicit';
  else if(retiredVerified) boundary='public_retired';
  else if(login&&/verifyPassword\s*\(/.test(src)) boundary='credential_login';
  else if(hasAuthorize) boundary='permission';
  else if(hasScopedIdentity) boundary='identity_scoped_permissions';
  else if(hasAuthenticate) boundary='identity_only';
  else if(shipsgoVerified) boundary='external_webhook_verified';
  else if(twilioCallback&&twilioVerified) boundary='external_webhook_verified';
  else if(twilioCallback) {
    boundary='external_webhook_unverified';
    findings.push({severity:'critical',file:name,code:'TWILIO_SIGNATURE_NOT_VERIFIED'});
  }

  if(retiredPublic.has(name)&&!retiredVerified) {
    findings.push({severity:'high',file:name,code:'STALE_PUBLIC_ENDPOINT_NOT_RETIRED'});
  }
  if(hasLegacy) legacy.push(name);
  if(boundary==='UNCLASSIFIED') unresolved.push(name);
  rows.push({file:name,boundary,permissions:[...new Set([...permissions,...anyPermissions])].sort(),hasLegacy});
}

const permissionKeys=[...new Set(rows.flatMap(row=>row.permissions))].sort();
console.log(JSON.stringify({endpoint_count:rows.length,permission_keys:permissionKeys,unresolved,legacy,findings,rows},null,2));

if(legacy.length||unresolved.length||findings.some(item=>item.severity==='critical'||item.severity==='high')){
  console.error(`B9 API boundary audit failed: ${legacy.length} legacy, ${unresolved.length} unclassified, ${findings.length} finding(s).`);
  process.exit(1);
}
