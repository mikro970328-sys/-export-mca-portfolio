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
const rows=[];
const unresolved=[];
const legacy=[];

for(const file of endpointFiles){
  const name=rel(file);
  const src=fs.readFileSync(file,'utf8');
  const permissions=[...src.matchAll(/authorizeAdmin\s*\([^,]+,[^,]+,\s*['"]([^'"]+)['"]/g)].map(m=>m[1]);
  const anyPermissions=[...src.matchAll(/authorizeAdminAny\s*\([^,]+,[^,]+,\s*\[([^\]]*)\]/g)].flatMap(m=>[...m[1].matchAll(/['"]([^'"]+)['"]/g)].map(x=>x[1]));
  const hasAuthorize=/\bauthorizeAdmin(?:Any)?\s*\(/.test(src);
  const hasAuthenticate=/\bauthenticateAdmin\s*\(/.test(src);
  const hasLegacy=/\brequire(?:Master)?Admin\s*\(/.test(src);
  const publicPath=name.startsWith('api/public/');
  const login=name==='api/login.js';
  const webhook=/webhook/i.test(name);
  const webhookBoundary=webhook&&/(SHIPS?GO.*SECRET|WEBHOOK.*SECRET|signature|timingSafeEqual|processed_events)/i.test(src);
  let boundary='UNCLASSIFIED';
  if(publicPath) boundary='public';
  else if(login&&/verifyPassword\s*\(/.test(src)) boundary='credential_login';
  else if(hasAuthorize) boundary='permission';
  else if(hasAuthenticate) boundary='identity_only';
  else if(webhookBoundary) boundary='external_webhook';
  if(hasLegacy) legacy.push(name);
  if(boundary==='UNCLASSIFIED') unresolved.push(name);
  rows.push({file:name,boundary,permissions:[...new Set([...permissions,...anyPermissions])].sort(),hasLegacy});
}

const permissionKeys=[...new Set(rows.flatMap(row=>row.permissions))].sort();
console.log(JSON.stringify({endpoint_count:rows.length,permission_keys:permissionKeys,unresolved,legacy,rows},null,2));

if(legacy.length||unresolved.length){
  console.error(`B9 API boundary audit found ${legacy.length} legacy and ${unresolved.length} unclassified handlers.`);
  process.exit(1);
}
