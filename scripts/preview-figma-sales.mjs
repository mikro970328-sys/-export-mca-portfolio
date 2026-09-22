// Portable visual review, with fictional records and no business connections.
// Usage: node scripts/preview-figma-sales.mjs /absolute/path/ERP-vista-previa.html
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { JSDOM } from 'jsdom';
import { salesFixture } from './lib/figma-sales-fixture.mjs';

const output=resolve(process.argv[2] || '/tmp/ERP-vista-previa.html');
const read=path=>readFileSync(path,'utf8');
const font=readFileSync('admin/fonts/InterVariable.woff2').toString('base64');
const generated=JSON.parse(execFileSync(process.execPath,['scripts/preview-ux8-dashboard-navigation.mjs','https://erp-visual.invalid/'],{encoding:'utf8'}));
const shell=new JSDOM(generated.desktop);
const doc=shell.window.document;
const memory=`const previewStorage=new Map();Object.defineProperty(window,'localStorage',{value:{getItem:key=>previewStorage.get(key)||null,setItem:(key,value)=>previewStorage.set(key,String(value)),removeItem:key=>previewStorage.delete(key)}});`;
const boot=doc.createElement('script');boot.textContent=memory;doc.head.append(boot);
doc.querySelectorAll('img').forEach(node=>node.remove());
doc.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{
  const style=doc.createElement('style');
  style.textContent=read(new URL(link.href).pathname.slice(1)).replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`);
  link.replaceWith(style);
});
doc.querySelectorAll('script[src]').forEach(script=>{
  script.textContent=read(new URL(script.src).pathname.slice(1));
  script.removeAttribute('src');
});
doc.querySelector('meta[http-equiv]').content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; frame-src about: 'self'; connect-src 'none'";
doc.querySelector('.qa-note').hidden=true;
doc.querySelectorAll('.qa-placeholder').forEach(node=>node.textContent='Esta vista previa permite revisar Inicio y Ventas.');
let sales=salesFixture().replace("localStorage.setItem('export_mca_token','isolated-fixture-only');",memory+"localStorage.setItem('export_mca_token','isolated-fixture-only');");
// Label the demo and guard business actions, without changing the product owners.
const saleDom=new JSDOM(sales);
const review= saleDom.window.document.createElement('script');
review.textContent=`window.addEventListener('load',()=>{
  document.getElementById('saveOrder').disabled=true;
  document.getElementById('saveOrder').title='Demostración: no guarda operaciones';
  document.addEventListener('click',event=>{
    if(event.target.closest('[data-load-order],[data-supply-order]')){
      event.preventDefault();event.stopImmediatePropagation();
    }
  },true);
});`;
saleDom.window.document.body.append(review);
sales=saleDom.serialize();saleDom.window.close();
const frame=doc.createElement('iframe');
frame.className='embedded-workspace-frame';frame.title='Ventas · Datos de ejemplo';frame.srcdoc=sales;
doc.getElementById('salesSection').replaceChildren(frame);
const ready=doc.createElement('script');
ready.textContent=`window.addEventListener('load',()=>{
  window.showSection('salesSection');
  document.getElementById('currentUser').textContent='Vista previa';
  document.getElementById('currentRole').textContent='Datos de ejemplo';
});`;
doc.body.append(ready);
const shellHtml=shell.serialize();shell.window.close();
const esc=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;');
const html=`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; frame-src about: 'self'; img-src data:; connect-src 'none'">
<title>EXPORT MCA · Vista previa del ERP</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f8f8f7;color:#20211f;font:14px system-ui,sans-serif}header{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 20px;border-bottom:1px solid #dedfd9;background:white}strong{font-weight:600}small{display:block;margin-top:4px;color:#60615b}nav{display:flex;gap:8px}button{min-height:44px;padding:10px 14px;border:1px solid #dedfd9;border-radius:8px;background:white;color:#20211f;cursor:pointer}button[aria-pressed="true"]{border-color:#b54708;background:#fff1e8;color:#b54708}button:focus-visible{outline:3px solid #20211f;outline-offset:2px}.canvas{height:calc(100dvh - 80px);min-height:650px;padding:12px;display:flex;justify-content:center}iframe{width:100%;height:100%;border:1px solid #dedfd9;border-radius:12px;background:white}body.mobile iframe{width:390px;max-width:100%}@media(max-width:600px){header{align-items:flex-start;flex-direction:column;padding:12px 16px}.canvas{padding:0;height:calc(100dvh - 142px)}iframe{border:0;border-radius:0}}</style>
</head><body><header><div><strong>EXPORT MCA · Vista previa</strong><small>Datos de ejemplo. Puedes abrir Nueva venta y probar los filtros.</small></div><nav aria-label="Tamaño de vista"><button id="desktop" type="button" aria-pressed="true">Computadora</button><button id="mobile" type="button" aria-pressed="false">Celular</button></nav></header><div class="canvas"><iframe title="ERP de demostración" srcdoc="${esc(shellHtml)}"></iframe></div>
<script>for(const id of ['desktop','mobile'])document.getElementById(id).onclick=()=>{document.body.classList.toggle('mobile',id==='mobile');for(const other of ['desktop','mobile'])document.getElementById(other).setAttribute('aria-pressed',String(id===other));};</script>
</body></html>`;
mkdirSync(dirname(output),{recursive:true});writeFileSync(output,html);
console.log(output);
