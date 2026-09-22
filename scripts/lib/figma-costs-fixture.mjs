import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(`${root}${path}`, 'utf8');
const font = readFileSync(`${root}admin/fonts/InterVariable.woff2`).toString('base64');

// Real UI owner and fictional records. All requests, including saves, stay in memory.
export function costsFixture({ writable = true } = {}) {
  const dom = new JSDOM(read('admin/costs.html'));
  const doc = dom.window.document;
  doc.querySelectorAll('script,link:not([rel="stylesheet"])').forEach(node => node.remove());
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
    const style = doc.createElement('style');
    style.textContent = read(new URL(link.getAttribute('href'), 'https://erp-visual.invalid').pathname.slice(1)).replaceAll('/admin/fonts/InterVariable.woff2', `data:font/woff2;base64,${font}`);
    link.replaceWith(style);
  });
  const csp = doc.createElement('meta');
  csp.httpEquiv = 'Content-Security-Policy';
  csp.content = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";
  doc.head.prepend(csp);
  const charges = ['posted','posted','draft','draft','void'].map((status,index) => ({
    id:`fixture-cost-${index}`, cost_number:`CC-DEMO-004${8-index}`, status,
    category:['domestic_trucking','ocean_freight','inspection','documentation','warehouse'][index],
    stage:'inbound', amount:[1250,2100,350,125,400][index], currency:index===1?'EUR':'USD',
    incurred_date:'2026-09-22', supplier_id:'fixture-supplier', reference:`REF-DEMO-${48-index}`,
    notes:'Traslado de la mercancía.\nRegistro ficticio para pruebas.',
    allocations:index===2?[]:[{purchase_order_id:'fixture-po',amount:[1250,2100,350,125,400][index],basis:'manual',notes:'Distribución de demostración'}],
    progress:{allocated_amount:index===2?0:[1250,2100,350,125,400][index],unallocated_amount:index===2?350:0,allocation_status:index===2?'unallocated':'allocated'},
    capabilities:{actions:{edit:{allowed:writable&&status==='draft'},revise:{allowed:writable&&status==='posted'},post:{allowed:writable&&index===3},void:{allowed:writable&&status!=='void'}}}
  }));
  const payload = { charges, write_access:writable, targets:{
    suppliers:[{id:'fixture-supplier',name:'Proveedor de ejemplo'}],
    purchase_orders:[{id:'fixture-po',po_number:'PO-DEMO-0248'}],
    loads:[{id:'fixture-load',load_number:'LD-DEMO-0248'}]
  },cost_models:{warehouse_receipt_items:[],loads:[]} };
  const harness = `
    localStorage.setItem('export_mca_token','isolated-fixture-only');
    window.__fixtureCalls=[];
    window.__fixtureRejectWrites=false;
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid');
      const method=options.method||'GET';
      const body=options.body?JSON.parse(options.body):null;
      window.__fixtureCalls.push({path,method,body});
      if(url.pathname==='/api/costs'&&method==='POST'){
        if(!${writable})throw Error('Read-only fixture blocks writes');
        if(window.__fixtureRejectWrites)return {ok:false,status:400,json:async()=>({error:'No se pudo guardar el gasto.'})};
        return {ok:true,status:200,json:async()=>({ok:true})};
      }
      if(method!=='GET')throw Error('Fixture blocks network');
      const data=url.pathname==='/api/costs'?${JSON.stringify(payload)}:url.pathname==='/api/profitability'?{profitability:{sales_orders:[],invoices:[],loads:[],operations:[]}}:null;
      if(!data)throw Error('Fixture blocks network');
      return {ok:true,status:200,json:async()=>data};
    };`;
  for (const code of [harness,read('admin/costs.js')]) {
    const script=doc.createElement('script');
    script.textContent=code.replaceAll('</script','<\\/script');
    doc.body.append(script);
  }
  const html=dom.serialize();
  dom.window.close();
  return html;
}
