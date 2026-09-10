import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOperatorApi } from '../../scripts/lib/operator-acceptance-http.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const routeNames = ['products','suppliers','purchases','warehouse','inventory','loads','sales',
  'payables','supplier-payments','costs','profitability','reports','ap-links','publications',
  'sales-order-ux','sales-workspace','sales-loads','sales-supply','customer-advances',
  'proformas','shipment-document-readiness','shipments','clients','importers','operational-links',
  'direct-shipment-dispatch'];
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

// QA-only observational instrumentation. It does not replace a handler, click,
// response or navigation decision. No tokens, input values or identities are read.
function navigationProbe(source) {
  const probe = `;(() => {
    const session=crypto.randomUUID();let sequence=0,lastEvent='mount';
    const read=(kind,stack='')=>{
      if(sequence>=160)return;
      const record={session,sequence:++sequence,kind,lastEvent,time:performance.now(),
        width:innerWidth,height:innerHeight,clientWidth:document.documentElement.clientWidth,
        visualWidth:visualViewport?.width||0,visualHeight:visualViewport?.height||0,
        desktop:matchMedia('(min-width:901px)').matches,ready:document.readyState,
        sidebar:document.getElementById('sidebar')?.className||'',
        overlay:document.getElementById('mobileOverlay')?.className||'',
        expanded:document.getElementById('mobileMenuBtn')?.getAttribute('aria-expanded')||'',
        active:document.querySelector('.app-section:not(.hidden)')?.id||'',stack};
      navigator.sendBeacon('/qa/navigation-diagnostic',new Blob([JSON.stringify(record)],{type:'application/json'}));
    };
    window.__qaNavigationRecord=kind=>{read(kind,new Error().stack||'');queueMicrotask(()=>read(kind+':settled'));};
    for(const type of ['resize','pageshow','export-mca:section-changed'])window.addEventListener(type,event=>{
      lastEvent=type+(type==='pageshow'?':persisted='+event.persisted:'');
      read('event:'+lastEvent);queueMicrotask(()=>read('after:'+lastEvent));
    },true);
    document.addEventListener('click',event=>{
      const target=event.target?.closest?.('#mobileMenuBtn,#sidebarToggle,#mobileOverlay,[data-section]');
      if(!target)return;lastEvent='click:'+(target.id||target.dataset.section||'');
      read(lastEvent);queueMicrotask(()=>read('after:'+lastEvent));
    },true);
    read('probe-mounted');
  })();\n`;
  for (const name of ['openMobileMenu','closeMobileMenu','toggleShell','handleViewportChange']) {
    const marker=`function ${name}() {`;
    if(source.split(marker).length!==2)throw Error(`Review navigation diagnostic hook: ${name}`);
    source=source.replace(marker,`${marker}\n    window.__qaNavigationRecord('${name}');`);
  }
  return probe+source;
}

export async function startBrowserAcceptanceServer() {
  const handlers = new Map(await Promise.all(routeNames.map(async name =>
    [`/api/${name}`, (await import(new URL(`../../api/${name}.js`, import.meta.url))).default])));
  return startOperatorApi({ fallbackHandler: async (req,res,url) => {
    if(url.pathname==='/qa/navigation-diagnostic'&&req.method==='POST'){
      try{
        let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)throw Error('Diagnostic too large');}
        const input=JSON.parse(body);
        if(!/^[a-f0-9-]{36}$/.test(input.session)||!Number.isInteger(input.sequence)||input.sequence<1||input.sequence>160)throw Error('Invalid diagnostic');
        const row={};
        for(const key of ['session','sequence','kind','lastEvent','time','width','height','clientWidth','visualWidth','visualHeight','desktop','ready','sidebar','overlay','expanded','active','stack']){
          const value=input[key];
          if(typeof value==='string')row[key]=value.slice(0,key==='stack'?2000:120);
          else if(typeof value==='number'&&Number.isFinite(value)||typeof value==='boolean')row[key]=value;
        }
        const dir=path.join(root,'e2e/isolated/test-results');fs.mkdirSync(dir,{recursive:true});
        fs.appendFileSync(path.join(dir,`navigation-${input.session}.ndjson`),JSON.stringify(row)+'\n');
        res.writeHead(204);res.end();
      }catch{res.writeHead(400);res.end();}
      return;
    }
    const handler = handlers.get(url.pathname);
    if (handler) {
      req.query = Object.fromEntries(url.searchParams);
      try { await handler(req,res); }
      catch (error) {
        console.error('QA_HANDLER_FAILED', url.pathname, error.code || error.message);
        res.writeHead(500, { 'Content-Type':'application/json' });
        res.end(JSON.stringify({ error:'QA_HANDLER_FAILED' }));
      }
      return;
    }
    // Serve only public assets, never repository metadata, SQL or credentials.
    const allowed = /^(?:\/admin\/|\/app\/)/.test(url.pathname)
      || ['/sw.js','/logo.png','/favicon.ico'].includes(url.pathname);
    let relative;
    try { relative = decodeURIComponent(url.pathname).slice(1); } catch {}
    const file = relative && path.resolve(root,relative);
    if (!allowed || !file?.startsWith(root) || relative.split('/').some(part=>part.startsWith('.'))
      || !mime[path.extname(file)] || !['GET','HEAD'].includes(req.method)
      || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(404);res.end();return;
    }
    res.writeHead(200, {
      'Content-Type':mime[path.extname(file)],
      'Cache-Control':'no-store',
      'Content-Security-Policy':"connect-src 'self'; form-action 'self'; base-uri 'self'"
    });
    if (req.method==='HEAD') res.end();
    else if(url.pathname==='/admin/navigation-shell.js')res.end(navigationProbe(fs.readFileSync(file,'utf8')));
    else fs.createReadStream(file).pipe(res);
  }});
}
