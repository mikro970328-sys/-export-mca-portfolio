import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(`${root}${path}`,'utf8');
const font=readFileSync(`${root}admin/fonts/InterVariable.woff2`).toString('base64');
const chevron=readFileSync(`${root}admin/assets/purchase-chevron.svg`).toString('base64');

// Original UI and fictional data; every API call stays in memory, under a no-network CSP.
export function purchasesFixture({writable=true,related=false}={}) {
  const dom=new JSDOM(read('admin/purchases.html')),doc=dom.window.document;
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
  const supplier={id:'fixture-supplier',name:'Proveedor de ejemplo',country:'Estados Unidos'};
  const warehouse={id:'fixture-warehouse',code:'MIA-01',name:'Almacén de Miami'};
  const product={id:'fixture-product',sku:'DEMO-001',name:'Producto de demostración',unit:'cajas',brand:'Marca de ejemplo',default_units_per_pallet:10};
  const orders=['confirmed','issued','issued','draft','closed'].map((status,index)=>{
    const direct=index===1,protectedOrder=index===0;
    const allowed=key=>writable&&({edit:status!=='closed',repeat:true,cancel:status!=='closed',receive_remaining:!direct&&['confirmed','issued'].includes(status),create_direct_sale:direct})[key]===true;
    return {id:`fixture-po-${index}`,po_number:`PO-DEMO-024${8-index}`,status,currency:'USD',order_date:'2026-09-25',
      supplier_id:supplier.id,supplier,warehouse_id:direct?null:warehouse.id,warehouse:direct?null:warehouse,
      supplier_reference:`REF-DEMO-${48-index}`,notes:'Compra ficticia para pruebas.',
      progress:{receipt_status:protectedOrder?'partial':status==='closed'?'received':'pending',received_items:status==='closed'?1:0,item_count:1},
      items:[{id:`fixture-item-${index}`,product_id:product.id,product,unit:'cajas',currency:'USD',ordered_quantity:100,ordered_pallets:10,units_per_pallet:10,unit_cost:24,entered_line_total:null,notes:'Línea de demostración',allocations:protectedOrder?[{received_quantity:20,received_pallets:2,receipt_item:{receipt:{status:'received',receipt_number:'WR-DEMO-001'}}}]:[]}],
      capabilities:{actions:Object.fromEntries(['edit','repeat','cancel','receive_remaining','create_direct_sale'].map(key=>[key,{allowed:allowed(key),...(key==='edit'&&protectedOrder?{mode:'protected',destination_locked:true,supplier_locked:true,currency_locked:true}:{})}]))}
    };
  });
  const payload={orders,suppliers:[supplier],warehouses:[warehouse],products:[product]};
  const harness=`
    localStorage.setItem('export_mca_token','isolated-fixture-only');
    localStorage.setItem('export_mca_user',JSON.stringify({id:'fixture-operator'}));
    window.__fixtureCalls=[];window.__fixtureRejectWrites=false;
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET';
      const body=options.body?JSON.parse(options.body):null;
      window.__fixtureCalls.push({path,method,body});
      if(url.pathname!=='/api/purchases')throw Error('Fixture blocks network');
      if(method==='POST'){
        if(!${writable})throw Error('Read-only fixture blocks writes');
        if(window.__fixtureRejectWrites)return {ok:false,status:400,json:async()=>({error:'No se pudo procesar Compras. Intenta nuevamente.'})};
        return {ok:true,status:200,json:async()=>({ok:true})};
      }
      if(method!=='GET')throw Error('Fixture blocks network');
      return {ok:true,status:200,json:async()=>(${JSON.stringify(payload)})};
    };`;
  const relatedHarness=`
    window.__fixtureRelatedPending={};window.__fixtureRelatedOpened=[];
    const pending=key=>new Promise((resolve,reject)=>{window.__fixtureRelatedPending[key]={resolve,reject};});
    window.OperationalNavigation={purchaseByNumber:number=>pending('receipts:'+number),invalidateLinks(){},openSupplier:value=>window.__fixtureRelatedOpened.push({supplier:value}),openWarehouseReceipt:value=>window.__fixtureRelatedOpened.push({receipt:value})};
    window.APTraceability={billsForPurchase:id=>pending('bills:'+id),paymentsForPurchase:id=>pending('payments:'+id),invalidate(){},openBill:id=>window.__fixtureRelatedOpened.push({bill:id}),openPayment:id=>window.__fixtureRelatedOpened.push({payment:id})};
  `;
  for(const code of [harness,...(related?[relatedHarness]:[]),read('admin/form-drafts.js'),read('admin/purchases.js')]){
    const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);
  }
  const html=dom.serialize();dom.window.close();return html;
}
