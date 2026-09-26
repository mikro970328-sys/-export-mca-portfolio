import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(`${root}${path}`,'utf8');
const font=readFileSync(`${root}admin/fonts/InterVariable.woff2`).toString('base64');
const chevron=readFileSync(`${root}admin/assets/purchase-chevron.svg`).toString('base64');

// Real UI/controller with fictional records and an in-memory API. No network or production data.
export function warehouseFixture({writable=true}={}) {
  const dom=new JSDOM(read('admin/warehouse.html')),doc=dom.window.document;
  doc.querySelectorAll('script,link:not([rel="stylesheet"])').forEach(node=>node.remove());
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{
    const style=doc.createElement('style');
    style.textContent=read(new URL(link.getAttribute('href'),'https://erp-visual.invalid').pathname.slice(1))
      .replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`)
      .replaceAll('/admin/assets/purchase-chevron.svg',`data:image/svg+xml;base64,${chevron}`);
    link.replaceWith(style);
  });
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';
  csp.content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";
  doc.head.prepend(csp);
  const warehouse={id:'fixture-warehouse',code:'ALM-01',name:'Bodega principal',country:'Estados Unidos',city:'Miami',active:true};
  const supplier={id:'fixture-supplier',name:'Proveedor Andino',active:true};
  const product={id:'fixture-product',sku:'SOL-620',name:'Panel solar 620W',unit:'paneles',default_units_per_pallet:40,package_format:'Caja de paneles',active:true};
  const receipts=[0,1,2,3].map(index=>({id:`fixture-wr-${index}`,receipt_number:`WR-DEMO-0${42-index}`,
    status:index===3?'cancelled':'received',received_at:'2026-09-26T13:30:00Z',warehouse_id:warehouse.id,warehouse,
    supplier_id:supplier.id,supplier,reference_number:`A-0${41-index}`,truck_reference:`TRK-${104-index}`,
    driver_name:'Conductor de ejemplo',notes:'Mercancía revisada al recibir.',
    items:[{id:`fixture-item-${index}`,product_id:product.id,product,pallets:index===2?0:2,quantity:index===2?24:80,
      units_per_pallet:40,unit:'paneles',lot_number:`LOTE-0${26-index}`,net_weight_kg:1200,gross_weight_kg:1260,unit_cost:30}],
    capabilities:{actions:{cancel:{allowed:writable&&index<2,reason:index===2?'WR_HAS_INVENTORY_HISTORY':'WR_NOT_RECEIVED'}}}
  }));
  const payload={write_access:writable,warehouses:[warehouse],products:[product],suppliers:[supplier],receipts};
  const harness=`
    localStorage.setItem('export_mca_token','isolated-fixture-only');
    const fixturePayload=${JSON.stringify(payload)};
    window.__fixtureCalls=[];window.__fixtureRejectWrites=false;
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET';
      const body=options.body?JSON.parse(options.body):null;window.__fixtureCalls.push({path,method,body});
      if(url.pathname!=='/api/warehouse')throw Error('Fixture blocks network');
      if(method==='GET')return {ok:true,status:200,json:async()=>fixturePayload};
      if(!${writable})throw Error('Read-only fixture blocks writes');
      if(window.__fixtureRejectWrites)return {ok:false,status:503,json:async()=>({error:'Fixture unavailable'})};
      if(body.action==='create_receipt')return {ok:true,status:200,json:async()=>({receipt:{id:'fixture-saved',receipt_number:'WR-DEMO-043',status:'received'}})};
      if(body.action==='cancel_receipt'){
        const r=fixturePayload.receipts.find(r=>r.id===body.id);r.status='cancelled';r.capabilities.actions.cancel.allowed=false;
        return {ok:true,status:200,json:async()=>({ok:true})};
      }
      throw Error('Unsupported fixture write');
    };`;
  for(const code of [harness,read('admin/warehouse.js')]){
    const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);
  }
  const html=dom.serialize();dom.window.close();return html;
}
