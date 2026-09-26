import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(`${root}${path}`, 'utf8');
const font = readFileSync(`${root}admin/fonts/InterVariable.woff2`).toString('base64');

// Real UI owner and fictional records. All requests, including saves, stay in memory.
export function costsFixture({ writable = true, companyPending = false } = {}) {
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
  const period = `${new Date().getFullYear()}-${String(new Date().getMonth()+1).padStart(2,'0')}`;
  const profitability = { profitability:{
    sales_orders:[],
    invoices:[{invoice_id:'fixture-invoice',invoice_number:'INV-DEMO-1',issue_date:`${period}-10`,invoice_currency:'USD',invoice_total:1000,cogs_currency:'USD',recognized_merchandise_cogs:500,merchandise_cost_coverage:'actual',profitability_status:'comparable'},
      ...(companyPending?[{invoice_id:'fixture-invoice-pending',invoice_number:'INV-DEMO-2',issue_date:`${period}-15`,invoice_currency:'USD',invoice_total:400,cogs_currency:null,recognized_merchandise_cogs:null,merchandise_cost_coverage:'incomplete',profitability_status:'incomplete_cogs'}]:[])],
    loads:[],shipments:[{shipment_id:'fixture-shipment',container_number:'CONT-DEMO-0248',operation_id:'fixture-operation',fulfillment_allocation_count:1,revenue_currency_count:1,revenue_currency:'USD',attributed_sales_revenue:1200,cogs_currency:'USD',recognized_merchandise_cogs:750,direct_cost_currency_count:1,direct_cost_currency:'USD',direct_cost_charge_count:1,direct_cost_amount:100,gross_margin_before_direct_costs:450,contribution_margin:350,contribution_margin_pct:29.16,profitability_status:'comparable'}],operations:[{operation_id:'fixture-operation',operation_code:'OP-DEMO-0248',operation_status:'active',shipment_count:1,issued_revenue:1000,revenue_currency:'USD',recognized_merchandise_cogs:500,cogs_currency:'USD',gross_margin_before_direct_costs:500,direct_cost_charge_count:0,direct_cost_amount:0,direct_cost_currency_count:0,contribution_margin:500,contribution_margin_pct:50,profitability_status:'comparable'}]
  },traceability:{sales_orders:[],invoices:[],cost_charges:[{cost_charge_allocation_id:'fixture-expense-allocation',cost_number:'CC-DEMO-1',category:'domestic_trucking',currency:'USD',incurred_date:`${period}-12`,allocated_amount:100,target_type:'sales_order',target_id:'fixture-sale'}]},masters:{products:[],clients:[]}};
  const payroll = {workers:writable?[{id:'fixture-worker',full_name:'Trabajadora de ejemplo',position:'Operaciones',is_active:true}]:[],entries:writable?[
    {id:'fixture-payroll',worker_id:'fixture-worker',period_start:`${period}-01`,salary_amount:250,tips_amount:25,currency:'USD',status:'posted',notes:'Mes ficticio'},
    {id:'fixture-payroll-void',worker_id:'fixture-worker',period_start:`${period}-01`,salary_amount:900,tips_amount:0,currency:'USD',status:'void',notes:'Registro anulado'}
  ]:[],company_totals:[{period_start:`${period}-01`,currency:'USD',salary_amount:250,tips_amount:25}],write_access:writable};
  const harness = `
    localStorage.setItem('export_mca_token','isolated-fixture-only');
    window.__fixtureCalls=[];
    window.__fixtureRejectWrites=false;
    window.__fixturePayroll=JSON.parse(${JSON.stringify(JSON.stringify(payroll))});
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
      if(url.pathname==='/api/payroll'&&method==='POST'){
        if(!${writable})throw Error('Read-only fixture blocks writes');
        const entry={...body,id:body.id||'fixture-payroll-created',worker_id:body.worker_id,period_start:body.period+'-01',salary_amount:Number(body.salary_amount),tips_amount:Number(body.tips_amount),currency:body.currency,status:'posted'};
        if(body.action==='create')window.__fixturePayroll.entries.push(entry);
        else if(body.action==='update')Object.assign(window.__fixturePayroll.entries.find(row=>row.id===body.id)||{},entry);
        else if(body.action==='void')Object.assign(window.__fixturePayroll.entries.find(row=>row.id===body.id)||{},{status:'void',voided_at:new Date().toISOString()});
        const totals=new Map();
        for(const row of window.__fixturePayroll.entries){if(row.status!=='posted')continue;const key=row.period_start+'|'+row.currency;const total=totals.get(key)||{period_start:row.period_start,currency:row.currency,salary_amount:0,tips_amount:0};total.salary_amount+=Number(row.salary_amount||0);total.tips_amount+=Number(row.tips_amount||0);totals.set(key,total);}
        window.__fixturePayroll.company_totals=[...totals.values()];
        return {ok:true,status:200,json:async()=>({ok:true,entry})};
      }
      if(method!=='GET')throw Error('Fixture blocks network');
      const data=url.pathname==='/api/costs'?${JSON.stringify(payload)}:url.pathname==='/api/profitability'?${JSON.stringify(profitability)}:url.pathname==='/api/payroll'?window.__fixturePayroll:null;
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
