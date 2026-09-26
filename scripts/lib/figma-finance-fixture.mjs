import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(`${root}${path}`,'utf8');
const font=readFileSync(`${root}admin/fonts/InterVariable.woff2`).toString('base64');
const chevron=readFileSync(`${root}admin/assets/purchase-chevron.svg`).toString('base64');
// Use the real API column/dimension definitions. Fictional rows never leave memory.
const datasets=vm.runInNewContext(`(${read('api/reports.js').match(/const DATASETS = Object\.freeze\(([\s\S]*?)\);/)[1]})`);

export function financeFixture({module='invoices',writable=true,failRead=false}={}){
  if(!['invoices','payables','reports'].includes(module))throw Error('Unsupported finance module');
  const dom=new JSDOM(read(`admin/${module}.html`)),doc=dom.window.document;
  doc.querySelectorAll('script,link:not([rel="stylesheet"])').forEach(n=>n.remove());
  doc.querySelectorAll('link[rel="stylesheet"]').forEach(link=>{
    const style=doc.createElement('style');style.textContent=read(new URL(link.getAttribute('href'),'https://erp-visual.invalid').pathname.slice(1))
      .replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`)
      .replaceAll('/admin/assets/purchase-chevron.svg',`data:image/svg+xml;base64,${chevron}`);link.replaceWith(style);
  });
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";doc.head.prepend(csp);
  const client={id:'fixture-client',name:'Comercial del Caribe',company:'Comercial del Caribe'};
  const supplier={id:'fixture-supplier',name:'Proveedor de ejemplo'};
  const product={id:'fixture-product',sku:'SOL-620',name:'Panel solar 620W',unit:'paneles'};
  const caps=allowed=>({actions:Object.fromEntries(allowed.map(a=>[a,{allowed:writable}]))});
  const so={id:'fixture-so',so_number:'SO-DEMO-018',client_id:client.id,client,currency:'USD',status:'confirmed',customer_reference:'REF-018',items:[{id:'fixture-so-line',product_id:product.id,product,unit:'paneles',ordered_quantity:160,unit_price:30,invoice_progress:{available_to_invoice_quantity:80}}]};
  const invoices=[0,1,2].map(i=>({id:`fixture-invoice-${i}`,invoice_number:`INV-DEMO-0${18+i}`,client_id:client.id,client,currency:'USD',status:i===1?'draft':'issued',sales_order_id:so.id,sales_order:so,issue_date:'2026-09-26',due_date:'2026-09-30',notes:'Condiciones de demostración.',
    items:[{id:`fixture-invoice-item-${i}`,sales_order_item_id:'fixture-so-line',description:'Panel solar 620W',product,unit:'paneles',quantity:80,unit_price:30,line_total:2400,credited_quantity:i===2?10:0}],
    financial:{original_total:2400,total:i===2?2100:2400,credited_amount:i===2?300:0,paid_amount:i===0?1000:i===2?2400:0,applied_amount:i===0?1000:i===2?2400:0,balance_due:i===0?1400:i===2?0:2400,payment_status:i===0?'partial':i===2?'paid':'unpaid',customer_credit_balance:i===2?300:0,overdue:false},
    payments:i===0?[{id:'fixture-customer-payment',payment_number:'CP-DEMO-018',amount:1000,payment_date:'2026-09-26',method:'wire',reference_number:'REF-COBRO-018',status:'posted',capabilities:caps(['reverse'])}]:[],credit_notes:[],credit_movements:[],
    capabilities:caps(i===0?['record_payment','credit']:i===1?['edit','issue','void']:['apply_credit','refund_credit'])}));
  const ar={write_access:writable,invoices,sales_orders:[so],metrics:{invoice_count:3,draft_count:1,paid_count:1,overdue_count:0,receivable_by_currency:[{currency:'USD',amount:1400}]}};
  const po={id:'fixture-po',po_number:'PO-DEMO-018',supplier_id:supplier.id,supplier,currency:'USD',status:'confirmed',supplier_reference:'REF-PROV-018',open_balance:1200,items:[{id:'fixture-po-line',product_id:product.id,product,unit:'paneles',ordered_quantity:160,unit_cost:25,ap_progress:{available_to_bill_quantity:80}}]};
  const bills=[0,1].map(i=>({id:`fixture-bill-${i}`,bill_number:`SB-DEMO-0${18+i}`,supplier_invoice_number:`REF-PROV-0${18+i}`,supplier_id:supplier.id,supplier,purchase_order_id:po.id,purchase_order:po,currency:'USD',status:i?'draft':'posted',bill_date:'2026-09-26',due_date:'2026-09-30',notes:'Factura ficticia del proveedor.',
    items:[{id:`fixture-bill-line-${i}`,purchase_order_item_id:'fixture-po-line',description:'Panel solar 620W',product,unit:'paneles',billed_quantity:80,unit_cost:25,line_total:2000,pricing_mode:'unit'}],
    financial:{bill_total:2000,paid_amount:i?0:800,balance_due:i?2000:1200,payment_status:i?'unpaid':'partial'},capabilities:caps(i?['edit','post','void']:['pay'])}));
  const payment={id:'fixture-supplier-payment',payment_number:'SP-DEMO-018',purchase_order_id:po.id,purchase_order:po,supplier_id:supplier.id,supplier,currency:'USD',amount:800,status:'posted',payment_date:'2026-09-26',method:'wire',reference:'REF-PAGO-018',progress:{applied_amount:600,unapplied_amount:200,application_status:'partial'},applications:[{supplier_bill_id:'fixture-bill-0',amount:600}],capabilities:caps(['allocate','reverse'])};
  const ap={write_access:writable,bills,purchase_orders:[po]},sp={write_access:writable,payments:[payment],bills:[bills[0]],purchase_orders:[po],advance_purchase_orders:[po]};
  const reportRow={order_date:'2026-09-26',so_number:'SO-DEMO-018',po_number:'PO-DEMO-018',client_name:client.name,client_company:client.company,importer_name:'Importadora de ejemplo',supplier_name:supplier.name,supplier_legal_name:supplier.name,status:'confirmed',currency:'USD',order_total:2400,fulfillment_status:'fulfilled',attributed_sales_revenue:2400,unattributed_order_value:0,recognized_merchandise_cogs:1600,merchandise_cost_coverage:'complete',gross_margin:800,gross_margin_pct:33.33,profitability_status:'comparable',direct_cost_amount:200,contribution_margin:600,contribution_margin_pct:25,contribution_status:'comparable',warehouse_code:'ALM-01',warehouse_name:'Bodega principal',receipt_number:'WR-DEMO-042',received_at:'2026-09-26',product_sku:product.sku,product_name:product.name,unit:'paneles',lot_number:'LOTE-026',physical_quantity:80,reserved_quantity:40,available_quantity:40,physical_pallets:2,reserved_pallets:1,available_pallets:1,receipt_status:'received',order_value_coverage:'complete',item_count:1,costed_item_count:1,has_excess:false,issue_date:'2026-09-26',invoice_number:'INV-DEMO-018',due_date:'2026-09-30',original_total:2400,credited_amount:0,invoice_total:2400,paid_amount:1000,balance_due:1400,payment_status:'partial',customer_credit_balance:0,overdue:false,bill_date:'2026-09-26',bill_number:'SB-DEMO-018',supplier_invoice_number:'REF-PROV-018',bill_total:2000,payment_date:'2026-09-26',event_type:'customer_collection',direction:'in',party_name:client.name,party_detail:'Cliente',document_number:'INV-DEMO-018',amount:1000,method:'wire',reference_number:'REF-COBRO-018'};
  const harness=`
    localStorage.setItem('export_mca_token','isolated-fixture-only');localStorage.setItem('export_mca_user',JSON.stringify({id:'fixture-operator'}));
    window.__fixtureCalls=[];window.__fixtureRejectWrites=false;window.__fixtureReadError=${failRead};
    const fixtureAR=${JSON.stringify(ar)},fixtureAP=${JSON.stringify(ap)},fixtureSP=${JSON.stringify(sp)},fixtureDatasets=${JSON.stringify(datasets)},fixtureReportRow=${JSON.stringify(reportRow)};
    const response=data=>({ok:true,status:200,json:async()=>data});
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;window.__fixtureCalls.push({path:url.pathname,query:url.search,method,body});
      if(!['/api/invoices','/api/invoice-payments','/api/payables','/api/supplier-payments','/api/reports'].includes(url.pathname))throw Error('Fixture blocks network');
      if(method!=='GET'){
        if(!${writable})throw Error('Read-only fixture blocks writes');
        if(window.__fixtureRejectWrites)return {ok:false,status:503,json:async()=>({error:'Internal fixture unavailable'})};
        if(url.pathname==='/api/invoice-payments')return response({payment:{id:'fixture-new-collection',invoice_id:body.invoice_id,status:'posted'}});
        if(url.pathname==='/api/supplier-payments')return response({payment:{id:'fixture-new-payment',purchase_order_id:body.purchase_order_id||'fixture-po',status:'posted'}});
        return response({ok:true});
      }
      if(window.__fixtureReadError)return {ok:false,status:503,json:async()=>({error:'Internal fixture read failure'})};
      if(url.pathname==='/api/invoices')return response(fixtureAR);
      if(url.pathname==='/api/payables')return response(fixtureAP);
      if(url.pathname==='/api/supplier-payments')return response(fixtureSP);
      if(url.pathname==='/api/reports'){
        const key=url.searchParams.get('dataset')||'sales',config=fixtureDatasets[key];if(!config)throw Error('Unknown report');
        const rows=[fixtureReportRow,{...fixtureReportRow,so_number:'SO-DEMO-019',currency:'EUR',order_total:1200}].filter((row,index)=>key==='inventory'?index===0:(!url.searchParams.get('currency')||row.currency===url.searchParams.get('currency')));
        const columns=config.columns.map(([key,label])=>({key,label}));
        if(url.searchParams.get('format')==='csv'){
          const csv=[config.columns.map(([,label])=>label).join(','),...rows.map(row=>config.columns.map(([key])=>row[key]??'').join(','))].join('\\n');
          return {ok:true,status:200,headers:{get:()=> 'attachment; filename="'+key+'.csv"'},blob:async()=>new Blob([csv],{type:'text/csv'})};
        }
        return response({report:{key,label:config.label,columns,dimensions:config.dimensions,basis:config.basis||'period_activity'},datasets:Object.entries(fixtureDatasets).map(([key,c])=>({key,label:c.label,dimensions:c.dimensions,basis:c.basis||'period_activity'})),rows,row_count:rows.length,limit:1000,filters:Object.fromEntries(url.searchParams),filter_options:{currencies:['USD','EUR'],clients:[${JSON.stringify(client)}],suppliers:[${JSON.stringify(supplier)}],products:[${JSON.stringify(product)}]},generated_at:'2026-09-26T09:30:00Z'});
      }
      throw Error('Unsupported fixture request');
    };`;
  for(const code of [harness,...(module==='reports'?[]:[read('admin/form-drafts.js')]),read(`admin/${module}.js`)]){const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);}
  const html=dom.serialize();dom.window.close();return html;
}
