import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(`${root}${path}`, 'utf8');
const font = readFileSync(`${root}admin/fonts/InterVariable.woff2`).toString('base64');

// Presentation fixture only: authored owners, fictional records, no network or writes.
export function salesFixture({ writable = true, workspace = false } = {}) {
  const dom = new JSDOM(read('admin/sales.html'));
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
  const client = { id:'fixture-client', name:'Cliente ficticio', company:'Costa Sur Comercial' };
  const product = { id:'fixture-product', name:'Producto de demostración', sku:'DEMO-1', unit:'cajas', default_units_per_pallet:10 };
  const orders = ['confirmed','confirmed','confirmed','draft','closed'].map((status, index) => ({
    id:`fixture-sale-${index}`, so_number:`SO-DEMO-024${8-index}`, status,
    client_id:client.id, client, importer:{name:'Importadora de ejemplo'}, customer_reference:`REF-${248-index}`,
    currency:index === 1?'EUR':'USD', order_date:'2026-09-22', requested_at:'2026-09-26T16:00:00Z',
    nationalization_status:index === 2?'not_nationalized':'nationalized',
    items:[{id:`fixture-item-${index}`,product_id:product.id,product,ordered_quantity:10,unit_price:100,unit:'cajas'}],
    progress:{order_total:28400-index*1500,fulfillment_status:['prepared','planned','partial','pending','dispatched'][index],fully_dispatched_items:index===4?1:0,item_count:1},
    capabilities:{actions:{edit:{allowed:writable&&status==='draft'},allocate_load:{allowed:writable&&status==='confirmed'}}}
  }));
  const payload = {orders,clients:[client],products:[product],importers:[],client_importers:[],write_access:writable};
  const workspaceData = { summary: { so_number:'SO-DEMO-0248', client_company:client.company,
    commercial_status:'confirmed', sales_currency:'USD', order_total:39916,
    profitability_status:'comparable', contribution_status:'comparable', billing_currency_comparable:true,
    recognized_merchandise_cogs:22680, direct_cost_amount:11600, direct_cost_currency:'USD',
    contribution_margin:5636, issued_invoice_total:39916, collected_amount:39916 },
    financial_access:{read:true,write:writable}, items:[],
    billing:{invoices:[],capabilities:{create_invoice:{allowed:false}}},
    costs:{allocations:[{amount:11600,basis:'manual',cost_charge:{id:'fixture-cost',cost_number:'CC-DEMO',
      status:'posted',category:'domestic_trucking',stage:'fulfillment',amount:11600,currency:'USD',
      incurred_date:'2026-09-22',capabilities:{actions:{revise:{allowed:writable}}}}}]},
    history:Array.from({length:12},(_,index)=>({action:'cost_charge_created',entity_type:'cost_charge',
      created_at:'2026-09-22T12:00:00Z',details:{notes:'Evento de prueba '+index}})) };
  const harness = `
    localStorage.setItem('export_mca_token','isolated-fixture-only');
    window.__fixtureCalls=[];
    window.SalesSupplyWorkspace={open:id=>window.__fixtureCalls.push({supply:id})};
    window.fetch=async(path,options={})=>{
      window.__fixtureCalls.push({path,method:options.method||'GET'});
      if(options.method&&options.method!=='GET')throw Error('Fixture blocks writes');
      const url=new URL(path,'https://erp-visual.invalid');
      let data;
      if(url.pathname==='/api/sales')data=${JSON.stringify(payload)};
      else if(url.pathname==='/api/sales-workspace')data={workspace:${JSON.stringify(workspaceData)}};
      else if(url.pathname==='/api/sales-order-ux'){
        const mode=url.searchParams.get('mode');
        if(mode==='clients')data={clients:[${JSON.stringify(client)}],has_more:false};
        else if(mode==='client_context')data={client:${JSON.stringify(client)},importers:[]};
        else if(mode==='pricing')data={items:[]};
        else if(mode==='inventory')data={warehouses:[],totals:{}};
        else throw Error('Unrecognized fixture query');
      }else throw Error('Fixture blocks network');
      return {ok:true,status:200,json:async()=>data};
    };`;
  for (const code of [harness, read('admin/sales.js'), read('admin/sales-order-ux.js'), ...(workspace?[read('admin/sales-workspace.js'),read('admin/sales-controller.js')]:[])]) {
    const script=doc.createElement('script');
    script.textContent=code.replaceAll('</script','<\\/script');
    doc.body.append(script);
  }
  const html = dom.serialize();
  dom.window.close();
  return html;
}
