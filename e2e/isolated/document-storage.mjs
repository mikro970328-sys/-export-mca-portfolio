import crypto from 'node:crypto';

// Explicit local Storage substitute. Business handlers, auth and SQL stay real.
// No persistent disk, external URLs, production credentials or notification delivery.
export function documentStorage() {
  const objects=new Map(),tokens=new Map();
  const send=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
  return {objects,async handle(req,res,url){
    if(!url.pathname.startsWith('/storage/v1/'))return false;
    const path=url.pathname.slice('/storage/v1'.length);
    const match=path.match(/^\/object\/(upload\/sign|sign|authenticated)\/erp-documents\/(.+)$/);
    if(match&&req.method==='POST'){
      if(req.headers.authorization!==`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`){send(res,403,{});return true;}
      const key=decodeURIComponent(match[2]),token=crypto.randomUUID();tokens.set(token,{key,upload:match[1]==='upload/sign'});
      req.resume();
      if(match[1]==='upload/sign')send(res,200,{url:`/object/upload/sign/erp-documents/${match[2]}?token=${token}`});
      else if(objects.has(key))send(res,200,{signedURL:`/object/authenticated/erp-documents/${match[2]}?token=${token}`});
      else send(res,404,{error:'QA object missing'});
      return true;
    }
    if(match&&['PUT','GET'].includes(req.method)){
      const key=decodeURIComponent(match[2]),grant=tokens.get(url.searchParams.get('token'));
      if(!grant||grant.key!==key||grant.upload!==(req.method==='PUT')){send(res,403,{});return true;}
      if(req.method==='PUT'){
        const chunks=[];for await(const chunk of req)chunks.push(chunk);
        const raw=Buffer.concat(chunks),boundary=String(req.headers['content-type']).match(/boundary=(?:"([^"]+)"|([^;]+))/);
        if(!boundary)throw Error('QA expected multipart upload');
        const parts=raw.toString('latin1').split('--'+(boundary[1]||boundary[2]));
        const part=parts.find(value=>/filename="/.test(value));
        if(!part)throw Error('QA missing multipart file');
        const bytes=Buffer.from(part.slice(part.indexOf('\r\n\r\n')+4,-2),'latin1');
        if(objects.has(key)){send(res,409,{});return true;}
        objects.set(key,bytes);send(res,200,{});
      }else{
        const bytes=objects.get(key);if(!bytes){send(res,404,{});return true;}
        res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'});res.end(bytes);
      }
      return true;
    }
    if(req.method==='DELETE'&&path.startsWith('/object/erp-documents/')){
      if(req.headers.authorization!==`Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`){send(res,403,{});return true;}
      objects.delete(decodeURIComponent(path.slice('/object/erp-documents/'.length)));send(res,200,{});return true;
    }
    send(res,404,{});return true;
  }};
}
