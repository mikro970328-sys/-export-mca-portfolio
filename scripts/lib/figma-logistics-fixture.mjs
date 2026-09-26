import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(root+p,'utf8');
const font=readFileSync(root+'admin/fonts/InterVariable.woff2').toString('base64');
const chevron=readFileSync(root+'admin/assets/purchase-chevron.svg').toString('base64');

// Canonical UI owners, fictional data and a memory API. CSP denies all network.
// These tests verify presentation/payloads; disposable-DB suites verify business effects.
export function logisticsFixture({module='loads',writable=true,failRead=false}={}){
  if(!['loads','tracking'].includes(module))throw Error('Unsupported logistics fixture');
  const dom=new JSDOM(read(module==='loads'?'admin/loads.html':'admin/index.html')),doc=dom.window.document;
  if(module==='tracking'){
    const nodes=['registerContainerSection','containersSection','modal'].map(id=>doc.getElementById(id));
    doc.body.replaceChildren(...nodes);
    doc.documentElement.className='';doc.body.className='';doc.getElementById('containersSection').classList.remove('hidden');
  }
  doc.querySelectorAll('script,link').forEach(el=>el.remove());
  const styles=module==='loads'?['embedded-foundation','loads']:['platform-theme','native-workspace-foundation','containers-module','shipment-editor'];
  for(const name of styles){const style=doc.createElement('style');style.textContent=read('admin/'+name+'.css').replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`).replaceAll('/admin/assets/purchase-chevron.svg',`data:image/svg+xml;base64,${chevron}`);doc.head.append(style);}
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";doc.head.prepend(csp);
  const warehouse={id:'fixture-warehouse',code:'ALM-01',name:'Bodega principal'};
  const product={id:'fixture-product',name:'Panel solar 620W',unit:'paneles'};
  const client={id:'fixture-client',name:'Comercial del Caribe',company:'Comercial del Caribe',phone:'+13055550180',active:true};
  const importer={id:'fixture-importer',name:'Importadora de ejemplo',active:true};
  const sources=[0,1].map(i=>({receipt_item_id:'fixture-source-'+i,receipt_number:'WR-DEMO-0'+(42-i),lot_number:'LOTE-0'+(26-i),warehouse_id:warehouse.id,product_id:product.id,product_name:product.name,product_unit:'paneles',available_quantity:40,available_pallets:1}));
  const capabilities=status=>({status,container_pending:false,actions:Object.fromEntries(['reserve','release','start_loading','mark_loaded','dispatch','edit','cancel','assign_container','create_container','unassign_container','view_tracking'].map(action=>[action,{allowed:action==='view_tracking'||(writable&&({reserve:['draft'],release:['reserved'],start_loading:['reserved'],mark_loaded:['loading'],dispatch:['loaded'],edit:['draft'],cancel:['draft','reserved','loading','loaded'],assign_container:['draft','reserved','loading','loaded'],create_container:['draft','reserved','loading','loaded'],unassign_container:['draft','reserved','loading','loaded']}[action]||[]).includes(status)),reason:'PERMISSION_REQUIRED'}]))});
  const shipments=[0,1,2].map(i=>({id:'fixture-shipment-'+i,container_number:'MCA-DEMO-0'+(18-i),carrier:i===2?'':'Naviera de ejemplo',client_id:i===2?null:client.id,clients:i===2?null:client,active:true,product:product.name,quantity:80,quantity_unit:'paneles',departure_date:'2026-09-26',booking_number:'BK-018',bol_number:'BL-018',operational_status:i===0?'Salió del puerto':i===1?'Cargado en el buque':'Registrado',last_status:i===0?'Salió del puerto':i===1?'Cargado en el buque':'Registrado',last_location:'Puerto de Miami',last_event_at:'2026-09-26T09:30:00Z',fulfillment:{mode:'warehouse',status:i===2?'draft':'loaded',load_number:'CG-DEMO-018'},capabilities:{actions:Object.fromEntries(['view_info','view_documents','edit','view_history','assign_client','manual_tracking','release','deliver','reactivate','delete'].map(action=>[action,{allowed:['view_info','view_documents','view_history'].includes(action)||writable,reason:'PERMISSION_REQUIRED'}]))}}));
  const loads=['reserved','draft','loading','loaded'].map((status,i)=>({id:'fixture-load-'+i,load_number:'CG-DEMO-0'+(18-i),status,notes:i?'Operación de salida':'Paneles para exportación.',warehouse_id:warehouse.id,warehouse,shipment_id:shipments[0].id,shipment:shipments[0],scheduled_at:'2026-09-26T09:30:00Z',updated_at:'2026-09-26T09:30:00Z',capabilities:capabilities(status),items:[{product_id:product.id,product,unit:'paneles',planned_quantity:80,planned_pallets:2,allocations:sources.map(source=>({receipt_item_id:source.receipt_item_id,allocated_quantity:40,allocated_pallets:1,receipt_item:{lot_number:source.lot_number,receipt:{receipt_number:source.receipt_number}}}))}],traceability:sources.map(source=>({receipt_number:source.receipt_number,product_name:product.name,product_unit:'paneles',allocated_quantity:40,allocated_pallets:1,reserved_quantity_net:40,dispatched_quantity:0}))}));
  const documents=[{id:'fixture-doc-2',document_type:'Packing List Cuba',version:2,file_name:'packing-list-cuba.pdf',created_at:'2026-09-26T09:30:00Z',uploaded_by_username:'Operador de ejemplo',is_current:true,state:'current',signed_url:'https://documents.invalid/current'},{id:'fixture-doc-1',document_type:'Packing List Cuba',version:1,file_name:'packing-list-original.pdf',created_at:'2026-09-25T09:30:00Z',is_current:false,state:'superseded',signed_url:'https://documents.invalid/history'}];
  const readiness=shipments.map((shipment,i)=>({shipment_id:shipment.id,document_status:i===1?'ready':i===2?'not_required':'pending',missing_documents:i===0?['Commercial Invoice Cuba']:[]}));
  const payload={loads,warehouses:[warehouse],sources,clients:[client],importers:[importer],shipments,write_access:writable,stats:{total:4,draft:1,reserved:1,loading:1,loaded:1,dispatched:0}};
  const importerState={importers:[importer],client_importers:[],shipment_importers:shipments.filter(s=>s.client_id).map(s=>({shipment_id:s.id,importer_id:importer.id}))};
  const harness=`
    localStorage.setItem('export_mca_token','isolated-fixture-only');localStorage.setItem('export_mca_user',JSON.stringify({id:'fixture-operator'}));
    window.__fixturePayload=${JSON.stringify(payload)};window.__fixtureCalls=[];window.__fixtureRejectWrites=false;window.__fixtureReadError=${failRead};window.__fixtureDocuments=${JSON.stringify(documents)};window.__fixtureReadiness=${JSON.stringify(readiness)};window.__fixtureImporters=${JSON.stringify(importerState)};
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
      window.__fixtureCalls.push({path,method,body});const p=window.__fixturePayload,ok=data=>({ok:true,status:200,json:async()=>data});
      if(!['/api/loads','/api/shipments','/api/importers','/api/shipment-document-readiness','/api/shipment-documents','/api/manual-tracking-event','/api/history'].includes(url.pathname))throw Error('Fixture blocks network');
      if(method==='GET'){
        if(window.__fixtureReadError)return {ok:false,status:503,json:async()=>({error:'Internal fixture database failure'})};
        if(url.pathname==='/api/loads')return ok(url.searchParams.has('id')?{load:p.loads.find(x=>x.id===url.searchParams.get('id'))}:p);
        if(url.pathname==='/api/importers')return ok(window.__fixtureImporters);
        if(url.pathname==='/api/shipment-document-readiness')return ok({readiness:window.__fixtureReadiness});
        if(url.pathname==='/api/shipment-documents')return ok({readiness:window.__fixtureReadiness[0],documents:window.__fixtureDocuments});
        if(url.pathname==='/api/history')return ok({events:[{title:'Reserva registrada',details:'Mercancía vinculada al cargue.',created_at:'2026-09-26T09:30:00Z'}]});
        throw Error('Unsupported fixture read');
      }
      if(!${writable})throw Error('Read-only fixture blocks writes');
      if(window.__fixtureRejectWrites)return {ok:false,status:503,json:async()=>({error:'Internal fixture write failure'})};
      if(url.pathname==='/api/loads'){
        let load=p.loads.find(x=>x.id===body.load_id);
        if(body.action==='create_plan'){load={...p.loads[1],id:'fixture-created-load',load_number:'CG-DEMO-019',notes:body.notes,scheduled_at:body.scheduled_at};p.loads.push(load);p.stats.total++;p.stats.draft++;}
        else if(body.action==='replace_plan'){Object.assign(load,{notes:body.notes,scheduled_at:body.scheduled_at});}
        else if(['create_container','assign_existing_container'].includes(body.action)){load.shipment={...p.shipments[0],container_number:body.container_number||p.shipments[0].container_number};}
        else if(body.action==='start_loading'){load.status='loading';load.capabilities.actions.start_loading.allowed=false;load.capabilities.actions.mark_loaded.allowed=true;load.capabilities.status='loading';}
        else throw Error('Unsupported fixture load mutation');
        return ok({load});
      }
      if(url.pathname==='/api/shipments'){
        if(method==='POST'){const shipment={...p.shipments[2],...body,id:'fixture-created-shipment'};p.shipments.push(shipment);return ok({shipment});}
        if(method==='PATCH'){const shipment=p.shipments.find(s=>s.id===body.id);Object.assign(shipment,body);return ok({shipment});}
      }
      if(url.pathname==='/api/importers'&&body.action==='assign_shipment')return ok({state:window.__fixtureImporters});
      if(url.pathname==='/api/manual-tracking-event')return ok({notification_status:'not_required'});
      throw Error('Unsupported fixture mutation');
    };`;
  const nativeHarness=`window.shipments=window.__fixturePayload.shipments;window.clients=window.__fixturePayload.clients;window.shipmentWriteAccess=${writable};window.ExportMcaAccessControl={can:key=>${writable}||key.endsWith('.read')};window.loadAll=async()=>window.ContainersModule?.render();window.loadNotifications=async()=>{};window.TasksWorkspace={load:async()=>{}};window.OperationalNavigation={loadForShipment:async()=>({load_id:'fixture-load-0',load_number:'CG-DEMO-018',load_status:'Despachado'}),openLoad:args=>{window.__fixtureOpenedLoad=args}};`;
  const code=module==='loads'?[harness,read('admin/loads.js')]:[harness,read('admin/admin-shell-runtime.js'),nativeHarness,read('admin/form-drafts.js'),read('admin/modal-dismissal.js'),read('admin/shipment-editor.js'),read('admin/containers-module.js')];
  for(const codeText of code){const script=doc.createElement('script');script.textContent=codeText.replaceAll('</script','<\\/script');doc.body.append(script);}
  const html=dom.serialize();dom.window.close();return html;
}
