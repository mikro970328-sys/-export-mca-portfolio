import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(`${root}${path}`,'utf8');
const font=readFileSync(`${root}admin/fonts/InterVariable.woff2`).toString('base64');
const chevron=readFileSync(`${root}admin/assets/purchase-chevron.svg`).toString('base64');

// Production owners with fictional records and an in-memory API. CSP blocks all network.
export function stockCatalogFixture({module='inventory',writable=true,failRead=false}={}) {
  if(!['inventory','products'].includes(module))throw Error('Unsupported fixture module');
  const dom=new JSDOM(read(`admin/${module}.html`)),doc=dom.window.document;
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
  const warehouses=[{id:'fixture-warehouse',code:'ALM-01',name:'Bodega principal',active:true},{id:'fixture-other',code:'ALM-02',name:'Bodega secundaria',active:true}];
  const products=[
    {id:'fixture-panel',sku:'SOL-620',name:'Panel solar 620W',brand:'Solar',category:'Energía',unit:'paneles',package_format:'Caja de paneles',country_of_origin:'Estados Unidos',hs_code:'8541',default_units_per_pallet:40,unit_weight_kg:15,unit_volume_m3:0.08,description:'Panel solar para proyectos comerciales.',notes:'Manipular en posición vertical.',active:true},
    {id:'fixture-oil',sku:'SOY-35LB',name:'Aceite de soya 35 lb',brand:'MCA',category:'Alimentos',unit:'cajas',package_format:'JIB 35 lb / 17.25 L',country_of_origin:'Estados Unidos',hs_code:'1507',default_units_per_pallet:60,unit_weight_kg:15.8,unit_volume_m3:0.03,active:true},
    {id:'fixture-old',sku:'HIST-001',name:'Producto histórico',unit:'unidades',active:false}
  ];
  const sources=[0,1].map(index=>({receipt_number:`WR-DEMO-0${42-index}`,lot_number:`LOTE-0${26-index}`,physical_quantity:40,physical_pallets:1,reserved_quantity:index?0:40,reserved_pallets:index?0:1,available_quantity:index?40:0,available_pallets:index?1:0,units_per_pallet:40,movement_count:index?1:2}));
  const inventory=[
    {product_id:products[0].id,product:products[0],warehouse_id:warehouses[0].id,warehouse:warehouses[0],physical_quantity:80,physical_pallets:2,reserved_quantity:40,reserved_pallets:1,available_quantity:40,available_pallets:1,sources},
    {product_id:products[1].id,product:products[1],warehouse_id:warehouses[1].id,warehouse:warehouses[1],physical_quantity:60,physical_pallets:1,reserved_quantity:0,reserved_pallets:0,available_quantity:60,available_pallets:1,sources:[{receipt_number:'WR-DEMO-040',lot_number:'LOTE-024',physical_quantity:60,physical_pallets:1,reserved_quantity:0,reserved_pallets:0,available_quantity:60,available_pallets:1,units_per_pallet:60,movement_count:1}]}
  ];
  const traceability=[
    {occurred_at:'2026-09-26T09:30:00Z',movement_type:'reserve',receipt_number:'WR-DEMO-042',quantity_delta:0,pallets_delta:0,reserved_quantity_delta:40,reserved_pallets_delta:1,reference_type:'load',reference_id:'CG-DEMO-018'},
    {occurred_at:'2026-09-25T09:30:00Z',movement_type:'receipt',receipt_number:'WR-DEMO-042',quantity_delta:40,pallets_delta:1,reserved_quantity_delta:0,reserved_pallets_delta:0,reference_type:'warehouse_receipt'},
    {occurred_at:'2026-09-24T09:30:00Z',movement_type:'receipt',receipt_number:'WR-DEMO-041',quantity_delta:40,pallets_delta:1,reserved_quantity_delta:0,reserved_pallets_delta:0,reference_type:'warehouse_receipt'}
  ].map((row,i)=>({...row,id:`fixture-movement-${i}`,product_name:products[0].name,product_sku:products[0].sku,unit:'paneles',warehouse_id:warehouses[0].id,warehouse_code:warehouses[0].code,warehouse_name:warehouses[0].name,created_by_username:'Operador de ejemplo',lot_number:i===2?'LOTE-025':'LOTE-026'}));
  const payload=module==='products'?{products,write_access:writable}:{inventory,warehouses,traceability};
  const harness=`
    localStorage.setItem('export_mca_token','isolated-fixture-only');
    localStorage.setItem('export_mca_user',JSON.stringify({id:'fixture-operator'}));
    const fixturePayload=${JSON.stringify(payload)};
    window.__fixtureCalls=[];window.__fixtureRejectWrites=false;window.__fixtureReadError=${failRead};
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET';
      const body=options.body?JSON.parse(options.body):null;window.__fixtureCalls.push({path,method,body});
      if(url.pathname!=='/api/${module}')throw Error('Fixture blocks network');
      if(method==='GET')return window.__fixtureReadError
        ? {ok:false,status:503,json:async()=>({error:'Internal database fixture failure'})}
        : {ok:true,status:200,json:async()=>fixturePayload};
      if('${module}'!=='products'||!${writable})throw Error('Fixture blocks writes');
      if(window.__fixtureRejectWrites)return {ok:false,status:503,json:async()=>({error:'Internal write fixture failure'})};
      if(method==='POST'){fixturePayload.products.push({...body,id:'fixture-created',active:true});}
      else if(method==='PATCH'){
        const product=fixturePayload.products.find(item=>item.id===body.id);
        if(!product)throw Error('Unknown fixture product');
        if(body.action==='set_active')product.active=body.active;
        else if(body.action==='update')Object.assign(product,body);
        else throw Error('Unsupported fixture action');
      }else throw Error('Unsupported fixture method');
      return {ok:true,status:200,json:async()=>({ok:true})};
    };`;
  for(const code of [harness,...(module==='products'?[read('admin/form-drafts.js')]:[]),read(`admin/${module}.js`)]){
    const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);
  }
  const html=dom.serialize();dom.window.close();return html;
}
