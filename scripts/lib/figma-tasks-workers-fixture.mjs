import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const root=fileURLToPath(new URL('../../',import.meta.url));
const read=p=>readFileSync(root+p,'utf8');
const font=readFileSync(root+'admin/fonts/InterVariable.woff2').toString('base64');

// Actual native owners with fictional records; the memory API and CSP deny network.
export function tasksWorkersFixture({module='tasks',writable=true,manage=writable,failRead=false,restricted=false}={}){
  if(!['tasks','workers'].includes(module))throw Error('Unsupported workspace');
  const dom=new JSDOM(`<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><section id="${module}Section" class="app-section"></section></body></html>`),doc=dom.window.document;
  const owner=module==='tasks'?'tasks-workspace':'workers-module';
  for(const name of ['platform-theme','native-workspace-foundation',owner]){
    const style=doc.createElement('style');style.textContent=read('admin/'+name+'.css').replaceAll('/admin/fonts/InterVariable.woff2',`data:font/woff2;base64,${font}`);doc.head.append(style);
  }
  const csp=doc.createElement('meta');csp.httpEquiv='Content-Security-Policy';csp.content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:";doc.head.prepend(csp);
  const tasks=[
    {id:'task-0',title:'Revisar documentación del contenedor',description:'Confirmar los documentos vigentes antes del despacho.',status:'pending',priority:'high',origin:'workflow',due_at:'2026-09-30T16:00:00Z',assigned_admin_id:'operator-0',assigned_team_id:'team-0',entity_type:'shipment',entity_id:'shipment-0',entity_label:'MCA-DEMO-018'},
    {id:'task-1',title:'Confirmar la entrega con el cliente',description:'Coordinar la fecha y confirmar la recepción de la mercancía.',status:'pending',priority:'normal',origin:'manual',due_at:'2026-10-01T10:00:00Z',assigned_admin_id:'operator-1',assigned_team_id:'team-1',entity_type:'sales_order',entity_id:'sale-0',entity_label:'SO-DEMO-019'},
    {id:'task-2',title:'Preparar cargue',description:'Revisar las asignaciones de mercancía.',status:'in_progress',priority:'normal',origin:'manual'},
    {id:'task-3',title:'Resolver documento pendiente',description:'Falta confirmar un documento.',status:'blocked',priority:'critical',origin:'manual',is_overdue:true},
    {id:'task-4',title:'Verificar datos del cliente',description:'Datos revisados.',status:'completed',priority:'low',origin:'manual'}
  ];
  const context={manage,teams:[{id:'team-0',name:'Logística'},{id:'team-1',name:'Comercial'}],users:[{id:'operator-0',full_name:'Operador de ejemplo',username:'operador'},{id:'operator-1',full_name:'Ana Pérez',username:'ana'},{id:'operator-2',full_name:'Luis García',username:'luis'}],memberships:[{team_id:'team-0',admin_user_id:'operator-0'},{team_id:'team-1',admin_user_id:'operator-1'}]};
  const workers=[
    {id:'worker-0',full_name:'Ana Pérez',phone:'+530000000000',position:'Comercial',is_active:true,created_at:'2026-09-20T09:30:00Z',updated_at:'2026-09-26T09:30:00Z'},
    {id:'worker-1',full_name:'Luis García',phone:'+530000000001',position:'Logística',is_active:true,created_at:'2026-09-20T09:30:00Z',updated_at:'2026-09-26T09:30:00Z'},
    {id:'worker-2',full_name:'Trabajador de ejemplo',phone:'+530000000002',position:'',is_active:false,deactivation_reason:'Ausencia temporal',created_at:'2026-09-20T09:30:00Z',updated_at:'2026-09-26T09:30:00Z'}
  ];
  const harness=`
    localStorage.setItem('export_mca_token','fixture-token');localStorage.setItem('export_mca_user',JSON.stringify({id:'operator-0',username:'operador'}));
    window.ExportMcaAccessControl={can:key=>key.endsWith('.read')||(key==='tasks.manage'?${manage}:${writable})};
    window.__fixtureTasks=${JSON.stringify(tasks)};window.__fixtureWorkers=${JSON.stringify(workers)};window.__fixtureContext=${JSON.stringify(context)};
    window.__fixtureCalls=[];window.__fixtureRejectWrites=false;window.__fixtureReadError=${failRead};window.__fixtureBlockCompletion=false;window.__fixtureHistory=[];
    const response=data=>({ok:true,status:200,json:async()=>data});
    const failure=(code,status=503)=>({ok:false,status,json:async()=>({error:code,code})});
    function workerShape(w){return {...w,capabilities:{actions:{history:{allowed:true},edit:{allowed:${writable}},deactivate:{allowed:${writable}&&w.is_active},reactivate:{allowed:${writable}&&!w.is_active}}}}};
    function taskShape(t){const c=window.__fixtureContext;return {...t,assigned_admin_name:c.users.find(u=>u.id===t.assigned_admin_id)?.full_name,assigned_team_name:c.teams.find(u=>u.id===t.assigned_team_id)?.name,capabilities:{write:${writable},manage:${manage}},dependencies:t.dependencies||[],dependents:[],restricted_dependency_count:${restricted}?2:0,comments:t.comments||[{author_username:'Operador de ejemplo',body:'Se recibió la versión actualizada del proveedor.',created_at:'2026-09-26T09:30:00Z'}],history:t.history||[{event_type:'created',actor_username:'Sistema',created_at:'2026-09-26T09:30:00Z'}]}};
    window.fetch=async(path,options={})=>{
      const url=new URL(path,'https://erp-visual.invalid'),method=options.method||'GET',body=options.body?JSON.parse(options.body):null;
      window.__fixtureCalls.push({path:url.pathname,query:url.search,method,body});
      if(!['/api/tasks','/api/admins'].includes(url.pathname))throw Error('Fixture blocks network');
      if(method==='GET'){
        if(window.__fixtureReadError)return failure('Internal fixture read error');
        if(url.pathname==='/api/tasks'){
          if(url.searchParams.get('action')==='context')return response({context:window.__fixtureContext});
          if(url.searchParams.has('id'))return response({task:taskShape(window.__fixtureTasks.find(t=>t.id===url.searchParams.get('id')))});
          return response({tasks:window.__fixtureTasks.map(taskShape)});
        }
        if(url.searchParams.get('resource')==='worker_history')return response({history:[{action:'reactivated',reason:'Reincorporación al equipo',created_at:'2026-09-26T09:30:00Z'},...window.__fixtureHistory.filter(h=>h.worker_id===url.searchParams.get('worker_id'))]});
        return response({workers:window.__fixtureWorkers.map(workerShape),write_access:${writable}});
      }
      if(!${writable})throw Error('Read-only fixture blocks mutations');
      if(window.__fixtureRejectWrites)return failure('Internal fixture write error');
      if(url.pathname==='/api/tasks'){
        if(body.action==='create'){window.__fixtureTasks.push({...body,id:'task-created',status:'pending',origin:'manual'});return response({ok:true});}
        const t=window.__fixtureTasks.find(t=>t.id===(body.task_id||body.id));
        if(method==='PATCH')Object.assign(t,body);
        else if(body.action==='transition'){
          if(body.status==='completed'&&window.__fixtureBlockCompletion)return failure('TASK_OPEN_DEPENDENCIES',400);
          const from=t.status;t.status=body.status;t.history=[...(t.history||[]),{event_type:'transitioned',from_status:from,to_status:t.status,actor_username:'operador',created_at:'2026-09-26T10:30:00Z'}];
        }
        else if(body.action==='comment')t.comments=[...(t.comments||[]),{author_username:'operador',body:body.body,created_at:'2026-09-26T10:30:00Z'}];
        else if(body.action==='set_dependencies')t.dependencies=window.__fixtureTasks.filter(x=>body.dependency_ids.includes(x.id));
        else throw Error('Unsupported fixture task action');
        return response({task:taskShape(t)});
      }
      if(method==='POST'){window.__fixtureWorkers.push({...body,id:'worker-created',is_active:true,created_at:'2026-09-26T09:30:00Z'});return response({ok:true});}
      if(method==='PATCH'){
        const w=window.__fixtureWorkers.find(w=>w.id===body.id);Object.assign(w,body);
        if(typeof body.is_active==='boolean')window.__fixtureHistory.push({worker_id:body.id,action:body.is_active?'reactivated':'deactivated',reason:body.deactivation_reason||body.reactivation_reason,created_at:'2026-09-26T10:30:00Z'});
        return response({worker:workerShape(w)});
      }
      throw Error('Unsupported fixture mutation');
    };`;
  for(const code of [harness,read('admin/admin-shell-runtime.js'),read('admin/'+owner+'.js')]){const script=doc.createElement('script');script.textContent=code.replaceAll('</script','<\\/script');doc.body.append(script);}
  const html=dom.serialize();dom.window.close();return html;
}
