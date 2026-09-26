import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=path=>readFileSync(root+path,'utf8');
const font=readFileSync(root+'admin/fonts/InterVariable.woff2').toString('base64');

// Canonical UI, fictional records and a memory-only API. CSP denies network.
// Server authorization and business history remain covered by disposable-DB suites.
export function directoriesFixture({module='clients',writable=true,failRead=false}={}){
  if(!['clients','suppliers'].includes(module))throw Error('Unsupported directory');
  const dom=new JSDOM(read(module==='clients'?'admin/index.html':'admin/suppliers.html')),doc=dom.window.document;
  if(module==='clients'){
    doc.body.replaceChildren(doc.getElementById('clientsSection'),doc.getElementById('modal'));
    doc.body.className='';doc.documentElement.className='';doc.getElementById('clientsSection').classList.remove('hidden');
  }
  doc.querySelectorAll('script,link').forEach(n=>n.remove());
  for(const name of module==='clients'?['platform-theme','native-workspace-foundation','clients-module','form-drafts']:['embedded-foundation','suppliers','form-drafts']){
    const style=doc.createElement('style');style.textContent=read('admin/'+name+'.css').replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`);doc.head.append(style);
  }
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";doc.head.prepend(csp);
  const clients=[
    {id:'fixture-client-0',name:'Ana Pérez',company:'Comercial del Caribe',mipyme_name:'MIPYME registrada',phone:'+530000000000',email:'contacto@example.test',welcome_status:'sent',created_at:'2026-09-20T09:30:00Z',updated_at:'2026-09-26T09:30:00Z'},
    {id:'fixture-client-1',name:'Luis García',company:'Distribuidora Norte',mipyme_name:'MIPYME registrada',phone:'+530000000001',email:'compras@example.test',welcome_status:'pending',created_at:'2026-09-20T09:30:00Z',updated_at:'2026-09-26T09:30:00Z'}
  ];
  const suppliers=[
    {id:'fixture-supplier-0',name:'Proveedor de ejemplo',legal_name:'Razón social registrada',country:'China',tax_id:'ID-DEMO-018',email:'ventas@example.test',phone:'+860000000000',address:'Dirección comercial de ejemplo',notes:'Condiciones comerciales registradas.',active:true},
    {id:'fixture-supplier-1',name:'Suministros del Caribe',legal_name:'Razón social registrada',country:'Panamá',tax_id:'ID-DEMO-019',email:'compras@example.test',phone:'+50700000000',address:'Dirección de ejemplo',notes:'',active:true},
    {id:'fixture-supplier-2',name:'Proveedor histórico',legal_name:'Histórico de ejemplo',country:'China',tax_id:'',email:'',phone:'',address:'',notes:'Historial conservado.',active:false}
  ];
  const importers={importers:[{id:'fixture-importer',name:'Importadora de ejemplo'}],client_importers:[{client_id:clients[0].id,importer_id:'fixture-importer'}],shipment_importers:[]};
  const harness=`
    localStorage.setItem('export_mca_token','fixture-token');localStorage.setItem('export_mca_user',JSON.stringify({id:'fixture-user',username:'Operador de ejemplo'}));
    window.__fixtureCalls=[];window.__fixtureRejectWrites=false;window.__fixtureReadError=${failRead};
    window.__fixtureClients=${JSON.stringify(clients)};window.__fixtureSuppliers=${JSON.stringify(suppliers)};window.__fixtureImporters=${JSON.stringify(importers)};
    const response=data=>({ok:true,status:200,json:async()=>data});
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
      window.__fixtureCalls.push({path:url.pathname,query:url.search,method,body});
      if(!['/api/clients','/api/importers','/api/history','/api/suppliers'].includes(url.pathname))throw Error('Fixture blocks network');
      if(method==='GET'){
        if(window.__fixtureReadError)return {ok:false,status:503,json:async()=>({error:'Internal fixture read failure'})};
        if(url.pathname==='/api/clients')return response({clients:window.__fixtureClients});
        if(url.pathname==='/api/importers')return response(window.__fixtureImporters);
        if(url.pathname==='/api/history')return response({events:[{title:'Cliente registrado',details:'Datos iniciales del contacto.',created_at:'2026-09-20T09:30:00Z'}],notifications:[],audit_events:[]});
        if(url.pathname==='/api/suppliers')return response({suppliers:window.__fixtureSuppliers,write_access:${writable}});
      }
      if(!${writable})throw Error('Read-only fixture blocks writes');
      if(window.__fixtureRejectWrites)return {ok:false,status:503,json:async()=>({error:'Internal fixture write failure'})};
      if(url.pathname==='/api/clients'){
        if(method==='POST'){const client={...window.__fixtureClients[0],...body,id:'fixture-created-client',welcome_status:'pending'};window.__fixtureClients.push(client);return response({client});}
        if(method==='PATCH'){const client=window.__fixtureClients.find(c=>c.id===body.id);if(body.action==='resend_welcome')return response({status:'sent'});Object.assign(client,body);return response({client});}
        if(method==='DELETE'){window.__fixtureClients=window.__fixtureClients.filter(c=>c.id!==url.searchParams.get('id'));return response({ok:true});}
      }
      if(url.pathname==='/api/importers'&&body.action==='sync_client'){
        const state=window.__fixtureImporters;state.client_importers=state.client_importers.filter(x=>x.client_id!==body.client_id);
        for(const name of body.importer_names){let item=state.importers.find(x=>x.name===name);if(!item){item={id:'fixture-importer-'+state.importers.length,name};state.importers.push(item);}state.client_importers.push({client_id:body.client_id,importer_id:item.id});}
        return response({state});
      }
      if(url.pathname==='/api/suppliers'){
        if(method==='POST'){const supplier={...body,id:'fixture-created-supplier',active:true};window.__fixtureSuppliers.push(supplier);return response({supplier});}
        if(method==='PATCH'){const supplier=window.__fixtureSuppliers.find(x=>x.id===body.id);Object.assign(supplier,body);return response({supplier});}
      }
      throw Error('Unsupported fixture mutation');
    };`;
  const nativeHarness=`window.clients=window.__fixtureClients;window.ExportMcaAccessControl={can:key=>${writable}||key.endsWith('.read')};window.loadAll=async()=>{window.clients=(await window.api('/api/clients')).clients;window.dispatchEvent(new CustomEvent('export-mca:data-loaded'))};window.loadNotifications=async()=>{};`;
  const scripts=module==='clients'?[harness,read('admin/admin-shell-runtime.js'),nativeHarness,read('admin/form-drafts.js'),read('admin/modal-dismissal.js'),read('admin/clients-module.js')]:[harness,read('admin/form-drafts.js'),read('admin/suppliers.js')];
  for(const code of scripts){const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);}
  const html=dom.serialize();dom.window.close();return html;
}
