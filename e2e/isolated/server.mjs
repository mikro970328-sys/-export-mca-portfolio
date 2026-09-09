import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startOperatorApi } from '../../scripts/lib/operator-acceptance-http.mjs';

export const root = fileURLToPath(new URL('../../', import.meta.url));
const routeNames = ['products','suppliers','purchases','warehouse','inventory','loads','sales',
  'payables','supplier-payments','costs','profitability','reports','ap-links','publications',
  'sales-order-ux','sales-workspace','sales-loads','sales-supply','customer-advances',
  'proformas','shipment-document-readiness','shipments','clients','operational-links'];
const mime = { '.html':'text/html', '.js':'text/javascript', '.css':'text/css',
  '.json':'application/json', '.webmanifest':'application/manifest+json',
  '.png':'image/png', '.svg':'image/svg+xml', '.ico':'image/x-icon' };

export async function startBrowserAcceptanceServer() {
  const handlers = new Map(await Promise.all(routeNames.map(async name =>
    [`/api/${name}`, (await import(new URL(`../../api/${name}.js`, import.meta.url))).default])));
  return startOperatorApi({ fallbackHandler: async (req,res,url) => {
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
    else fs.createReadStream(file).pipe(res);
  }});
}
