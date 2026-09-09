import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const MIME={
  '.css':'text/css; charset=utf-8',
  '.html':'text/html; charset=utf-8',
  '.js':'text/javascript; charset=utf-8',
  '.json':'application/json; charset=utf-8',
  '.png':'image/png',
  '.svg':'image/svg+xml',
  '.webmanifest':'application/manifest+json; charset=utf-8'
};

function localPostgrestUrl(){
  const value=new URL(process.env.ERP_TEST_POSTGREST_URL||'http://127.0.0.1:3000');
  if(value.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(value.hostname)
    ||value.username||value.password||value.pathname!=='/'||value.search)throw Error('PostgREST must be local QA');
  return value;
}

function serviceRoleToken(secret){
  const encode=value=>Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned=`${encode({alg:'HS256',typ:'JWT'})}.${encode({role:'service_role',exp:Math.floor(Date.now()/1000)+3600})}`;
  return `${unsigned}.${crypto.createHmac('sha256',secret).update(unsigned).digest('base64url')}`;
}

async function proxyPostgrest(req,res,url,rest){
  await new Promise(resolve=>{
    const upstream=http.request(new URL(url.pathname.slice('/rest/v1'.length)+url.search,rest),{
      method:req.method,
      headers:{...req.headers,host:rest.host}
    },reply=>{
      res.writeHead(reply.statusCode,reply.headers);
      reply.pipe(res);
      reply.on('end',resolve);
    });
    upstream.on('error',()=>{res.writeHead(502);res.end('QA database transport failed');resolve();});
    req.pipe(upstream);
  });
}

async function runApi(req,res,url){
  const match=url.pathname.match(/^\/api\/([a-z0-9-]+)$/);
  if(!match){res.writeHead(404);res.end();return;}
  const file=path.join(ROOT,'api',`${match[1]}.js`);
  try{
    const module=await import(`${new URL(`../../api/${match[1]}.js`,import.meta.url).href}?qa=1`);
    req.query=Object.fromEntries(url.searchParams);
    await module.default(req,res);
  }catch(error){
    if(error?.code==='ERR_MODULE_NOT_FOUND'||error?.code==='ENOENT'){
      res.writeHead(404);res.end();return;
    }
    if(!res.headersSent){
      res.writeHead(500,{'Content-Type':'application/json; charset=utf-8'});
      res.end(JSON.stringify({error:'QA_HANDLER_FAILED'}));
    }else if(!res.writableEnded)res.end();
    console.error('QA_BROWSER_HANDLER_FAILED',path.relative(ROOT,file),error?.message||error);
  }
}

async function serveStatic(res,url){
  let pathname=url.pathname==='/'?'/admin/index.html':decodeURIComponent(url.pathname);
  const file=path.resolve(ROOT,`.${pathname}`);
  if(!file.startsWith(`${ROOT}${path.sep}`)){res.writeHead(403);res.end();return;}
  try{
    const body=await fs.readFile(file);
    res.writeHead(200,{
      'Content-Type':MIME[path.extname(file)]||'application/octet-stream',
      'Cache-Control':'no-store'
    });
    res.end(body);
  }catch(error){
    res.writeHead(error?.code==='ENOENT'?404:500);
    res.end();
  }
}

export async function startOperatorBrowserServer(db){
  const rest=localPostgrestUrl();
  const secret=process.env.ERP_TEST_POSTGREST_SECRET;
  if(!secret||secret.length<32)throw Error('A disposable PostgREST JWT secret is required');
  const previous={};
  for(const key of ['JWT_SECRET','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'])previous[key]=process.env[key];
  process.env.JWT_SECRET=crypto.randomBytes(48).toString('base64url');
  process.env.SUPABASE_SERVICE_ROLE_KEY=serviceRoleToken(secret);

  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://qa.invalid');
    if(url.pathname.startsWith('/rest/v1/'))return proxyPostgrest(req,res,url,rest);
    if(url.pathname.startsWith('/api/'))return runApi(req,res,url);
    return serveStatic(res,url);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const origin=`http://127.0.0.1:${server.address().port}`;
  process.env.SUPABASE_URL=origin;

  await db.query("notify pgrst, 'reload schema'");
  const deadline=Date.now()+15000;
  while(Date.now()<deadline){
    try{
      const response=await fetch(`${rest}rpc/register_admin_login_success`,{
        method:'POST',
        headers:{Authorization:`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,'Content-Type':'application/json'},
        body:JSON.stringify({p_admin_user_id:'00000000-0000-0000-0000-000000000000'})
      });
      const result=await response.json();
      if(response.status===400&&result.code==='P0001'&&result.message==='ADMIN_USER_UNAVAILABLE')break;
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,150));
  }
  if(Date.now()>=deadline){await close();throw Error('PostgREST did not expose the disposable browser schema');}

  async function close(){
    server.closeIdleConnections();
    await new Promise(resolve=>server.close(resolve));
    for(const [key,value] of Object.entries(previous)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
  return {origin,close};
}
