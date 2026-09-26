import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(root+p,'utf8');
const font=readFileSync(root+'admin/fonts/InterVariable.woff2').toString('base64');
export const fixturePhoto='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=';

export function publicationsWorkflowFixture({module='publications',writable=true,failRead=false}={}){
 if(!['publications','routes','supervisor'].includes(module))throw Error('Unsupported workspace');
 const publications=module==='publications';
 const dom=new JSDOM(publications?read('admin/publications.html'):'<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><section id="tasksSection" class="app-section"><div class="tasks-head-actions"></div></section></body></html>'),doc=dom.window.document;
 doc.querySelectorAll('script').forEach(n=>n.remove());doc.querySelectorAll('link').forEach(n=>n.remove());
 const styles=publications?['embedded-foundation','publications','form-drafts']:['platform-theme','native-workspace-foundation','tasks-workspace','workflow-route-settings','task-supervisor-queue'];
 for(const name of styles){const s=doc.createElement('style');s.textContent=read('admin/'+name+'.css').replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`);doc.head.append(s);}
 const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src 'self' data: blob:; font-src data:";doc.head.prepend(csp);
 const workers=[{id:'worker-0',full_name:'Ana Pérez',phone:'+530000000000',position:'Comercial'},{id:'worker-1',full_name:'Luis García',phone:'+530000000001',position:'Logística'}];
 const photo=index=>`https://erp-visual.invalid/storage/v1/object/public/publication-images/photo-${index}.png`;
 const rows=[{id:'publication-0',title:'Mercancía disponible',category:'merchandise_plaza',description:'Oferta comercial de ejemplo.',price:1250,currency:'USD',quantity:20,unit:'Cajas',assigned_worker_id:'worker-0',location_public:'Miami, FL',location_internal:'Referencia privada',departure_date:'',arrival_date:'',availability_status:'available',publication_status:'published',image_urls:[photo(0),photo(1)]},{id:'publication-1',title:'Próxima salida',category:'upcoming_shipments',currency:'USD',quantity:10,departure_date:'2026-09-30',arrival_date:'2026-10-10',publication_status:'draft',availability_status:'upcoming',image_urls:[]},{id:'publication-2',title:'Contenedor de ejemplo',category:'containers_plaza',assigned_worker_id:'worker-1',currency:'USD',publication_status:'archived',availability_status:'available',image_urls:[photo(2)]},{id:'publication-3',title:'Oferta temporal',category:'usa_warehouse',assigned_worker_id:'worker-0',currency:'EUR',publication_status:'hidden',availability_status:'available',image_urls:[photo(3)]}];
 const routes=[{workflow_key:'shipment_cuba_documents',label:'Revisar documentación',description:'Reúne los documentos necesarios antes del despacho.',assigned_team_id:'team-0',assigned_admin_id:'operator-0',default_priority:'normal',default_due_hours:48,enabled:true,active_task_count:3},{workflow_key:'purchase_receipt',label:'Coordinar entrega',description:'Confirma la recepción con el cliente.',assigned_team_id:'team-1',assigned_admin_id:'operator-1',default_priority:'high',default_due_hours:24,enabled:true,active_task_count:2},{workflow_key:'prepare_load',label:'Revisar excepción operativa',description:'Trabajo pendiente de asignación por supervisión.',assigned_team_id:null,assigned_admin_id:null,default_priority:'normal',default_due_hours:null,enabled:true,active_task_count:1}];
 const teams=[{id:'team-0',name:'Logística'},{id:'team-1',name:'Comercial'}],users=[{id:'operator-0',full_name:'Luis García',username:'luis'},{id:'operator-1',full_name:'Ana Pérez',username:'ana'},{id:'operator-2',full_name:'Usuario de ejemplo',username:'ejemplo'}],memberships=[{team_id:'team-0',admin_user_id:'operator-0'},{team_id:'team-0',admin_user_id:'operator-2'},{team_id:'team-1',admin_user_id:'operator-1'}];
 const tasks=[{id:'task-0',title:'Revisar documentación',description:'Falta confirmar el documento del envío.',attention_state:'overdue',priority:'high',assigned_admin_name:'Luis García',assigned_team_name:'Logística',due_at:'2026-09-25T16:00:00Z',due_in_minutes:-180,workflow_key:'shipment_cuba_documents',workflow_label:'Documentación',is_open:true,status:'pending',needs_routing_attention:false},{id:'task-1',title:'Coordinar entrega',description:'Asignar responsable de la entrega.',attention_state:'unassigned',priority:'normal',due_at:null,due_in_minutes:null,workflow_key:'purchase_receipt',workflow_label:'Entrega',is_open:true,status:'pending',needs_routing_attention:true},{id:'task-2',title:'Confirmar mercancía',description:'La tarea requiere una revisión adicional.',attention_state:'blocked',priority:'critical',assigned_admin_name:'Ana Pérez',due_at:'2026-09-27T16:00:00Z',due_in_minutes:1440,is_open:true,status:'blocked',needs_routing_attention:false},{id:'task-3',title:'Confirmar recepción',description:'Confirmar fecha prevista.',attention_state:'due_soon',priority:'normal',assigned_team_name:'Comercial',due_at:'2026-09-26T16:00:00Z',due_in_minutes:120,workflow_key:'purchase_receipt',workflow_label:'Entrega',is_open:true,status:'pending',needs_routing_attention:false}];
 const harness=`
 localStorage.setItem('export_mca_token','fixture-token');localStorage.setItem('export_mca_user',JSON.stringify({id:'operator-0',username:'operador'}));
 window.ExportMcaAccessControl={can:key=>key.endsWith('.read')||${writable}};window.__fixtureCalls=[];window.__fixtureReadError=${failRead};window.__fixtureRejectWrites=false;window.__fixtureWriteDelay=0;window.__fixtureOpenedTask=null;window.__fixtureTaskReloads=0;window.__fixtureMissingTask=false;
 window.TasksWorkspace={load:async()=>{window.__fixtureTaskReloads++;},open:async id=>{if(window.__fixtureMissingTask)throw Error('PRIVATE_FIXTURE_ERROR');window.__fixtureOpenedTask=id;}};
 window.__fixturePublications=${JSON.stringify(rows)};window.__fixtureRoutes=${JSON.stringify(routes)};window.__fixtureTasks=${JSON.stringify(tasks)};window.__fixtureImageCount=4;
 const fixtureWorkers=${JSON.stringify(workers)},fixtureTeams=${JSON.stringify(teams)},fixtureUsers=${JSON.stringify(users)},fixtureMemberships=${JSON.stringify(memberships)};
 const response=data=>({ok:true,status:200,json:async()=>JSON.parse(JSON.stringify(data))}),failure=()=>({ok:false,status:503,json:async()=>({error:'PRIVATE_FIXTURE_ERROR'})});
 window.fetch=async(path,options={})=>{
   const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
   if(!['/api/publications','/api/publication-images','/api/workflow-routes','/api/task-supervisor-queue'].includes(url.pathname))throw Error('Fixture blocks network');
   window.__fixtureCalls.push({path:url.pathname,query:url.search,method,body});
   if(method==='GET'){
     if(window.__fixtureReadError)return failure();
     if(url.pathname==='/api/publications')return response({publications:window.__fixturePublications.map(row=>({...row,assigned_worker:fixtureWorkers.find(w=>w.id===row.assigned_worker_id)||null})),workers:fixtureWorkers,capabilities:{write:${writable}}});
     if(url.pathname==='/api/workflow-routes')return response({routes:window.__fixtureRoutes,teams:fixtureTeams,users:fixtureUsers,memberships:fixtureMemberships});
     if(url.pathname==='/api/task-supervisor-queue')return response({tasks:window.__fixtureTasks,summary:{open:4,unassigned:1,due_soon:1,overdue:1,blocked:1,routing_attention:1},groups:{workflows:[{key:'shipment_cuba_documents',label:'Documentación',count:1},{key:'purchase_receipt',label:'Entrega',count:2},{key:'manual',label:'Manual',count:1}]},routes:[{...window.__fixtureRoutes[0],assigned_team_name:'Logística',routing_access_compatible:true,required_permissions:['tasks.read'],team_member_count:2,team_eligible_member_count:2},{...window.__fixtureRoutes[2],routing_access_compatible:false,required_permissions:['tasks.read']}]});
     throw Error('Unsupported fixture read');
   }
   if(!${writable})throw Error('Read-only fixture blocks writes');
   if(window.__fixtureWriteDelay)await new Promise(r=>setTimeout(r,window.__fixtureWriteDelay));
   if(window.__fixtureRejectWrites)return failure();
   if(url.pathname==='/api/publication-images'){
     if(method==='POST')return response({url:'https://erp-visual.invalid/storage/v1/object/public/publication-images/photo-'+(window.__fixtureImageCount++)+'.png'});
     if(method==='DELETE')return response({ok:true});throw Error('Unsupported image mutation');
   }
   if(url.pathname==='/api/publications'){
     if(method==='DELETE'){window.__fixturePublications=window.__fixturePublications.filter(r=>r.id!==url.searchParams.get('id'));return response({ok:true});}
     const category={plaza_merchandise:'merchandise_plaza',plaza_containers:'containers_plaza',us_warehouse:'usa_warehouse'}[body.category]||body.category;
     if(method==='POST')window.__fixturePublications.push({...body,category,id:'publication-created'});
     else if(method==='PATCH'){const row=window.__fixturePublications.find(r=>r.id===body.id);Object.assign(row,body);if(category)row.category=category;}
     else throw Error('Unsupported publication mutation');return response({ok:true});
   }
   if(url.pathname==='/api/workflow-routes'){
     if(method==='PATCH')Object.assign(window.__fixtureRoutes.find(r=>r.workflow_key===body.workflow_key),body);
     else if(method!=='POST'||body.action!=='reconcile_current')throw Error('Unsupported workflow mutation');return response({success:true});
   }
   throw Error('Supervisor is read-only');
 };`;
 const scripts=publications?[harness,read('admin/form-drafts.js'),read('admin/publications.js')]:[harness,read('admin/admin-shell-runtime.js'),read('admin/workflow-route-settings.js'),read('admin/task-supervisor-queue.js')];
 for(const code of scripts){const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);}
 const html=dom.serialize();dom.window.close();return html;
}
