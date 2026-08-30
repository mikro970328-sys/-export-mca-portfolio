import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRIORITIES=new Set(['low','normal','high','critical']);
const nullableUuid=value=>{if(value===null||value===undefined||value==='')return null;const id=String(value).trim();if(!UUID_RE.test(id))throw new Error('WORKFLOW_ROUTE_ID_INVALID');return id;};

async function rpc(name,body={}){return supabase(`rpc/${name}`,{method:'POST',body,prefer:'return=representation'});}

function friendly(error){
  const raw=String(error?.message||error||'');
  const map={
    WORKFLOW_ROUTE_TEAM_INVALID:'El equipo seleccionado no está activo.',
    WORKFLOW_ROUTE_ASSIGNEE_INVALID:'El responsable seleccionado no está activo.',
    WORKFLOW_ROUTE_ASSIGNEE_NOT_TEAM_MEMBER:'El responsable debe pertenecer al equipo seleccionado.',
    WORKFLOW_ROUTE_ACTOR_INVALID:'La cuenta actual no puede modificar handoffs.',
    WORKFLOW_ROUTE_PRIORITY_INVALID:'Prioridad inválida.',
    WORKFLOW_ROUTE_DUE_INVALID:'El vencimiento predeterminado debe estar entre 1 y 8760 horas.',
    WORKFLOW_ROUTE_NOT_FOUND:'Ruta de handoff no encontrada.'
  };
  const key=Object.keys(map).find(code=>raw.includes(code));
  return key?map[key]:'No se pudo actualizar la configuración de handoffs.';
}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,'tasks.manage');
  if(!admin)return;
  try{
    if(req.method==='GET'){
      const [routes,teams,users,memberships]=await Promise.all([
        supabase('workflow_task_route_directory',{query:'?select=*&order=label.asc'}),
        supabase('teams',{query:'?select=id,name,description,is_active&is_active=eq.true&order=name.asc'}),
        supabase('admin_users',{query:'?select=id,full_name,username,role,is_active&is_active=eq.true&order=full_name.asc'}),
        supabase('team_memberships',{query:'?select=team_id,admin_user_id'})
      ]);
      const teamIds=new Set((teams||[]).map(row=>row.id));
      const userIds=new Set((users||[]).map(row=>row.id));
      return ok(res,{routes:routes||[],teams:teams||[],users:users||[],memberships:(memberships||[]).filter(row=>teamIds.has(row.team_id)&&userIds.has(row.admin_user_id))});
    }

    if(req.method==='PATCH'){
      const body=await readJson(req);
      const workflowKey=String(body.workflow_key||'').trim();
      if(!workflowKey)return fail(res,400,'Ruta de handoff inválida.');
      const priority=String(body.default_priority||'normal');
      if(!PRIORITIES.has(priority))return fail(res,400,'Prioridad inválida.');
      const dueRaw=body.default_due_hours;
      const due=dueRaw===null||dueRaw===undefined||dueRaw===''?null:Number(dueRaw);
      if(due!==null&&(!Number.isInteger(due)||due<1||due>8760))return fail(res,400,'El vencimiento debe ser un número entero de horas entre 1 y 8760.');
      await rpc('update_workflow_task_route',{
        p_workflow_key:workflowKey,
        p_actor:admin.admin_id,
        p_enabled:body.enabled!==false,
        p_default_priority:priority,
        p_default_due_hours:due,
        p_assigned_team_id:nullableUuid(body.assigned_team_id),
        p_assigned_admin_id:nullableUuid(body.assigned_admin_id)
      });
      await writeAudit(admin,'workflow.route.update','workflow_task_route',null,{workflow_key:workflowKey,enabled:body.enabled!==false,default_priority:priority,default_due_hours:due,assigned_team_id:body.assigned_team_id||null,assigned_admin_id:body.assigned_admin_id||null});
      return ok(res,{success:true});
    }

    if(req.method==='POST'){
      const body=await readJson(req);
      if(String(body.action||'').trim()!=='reconcile_current')return fail(res,400,'Acción inválida.');
      const result=await rpc('reconcile_current_workflow_tasks',{});
      await writeAudit(admin,'workflow.reconcile.current','workflow_task_route',null,{scope:'current'});
      return ok(res,{result:Array.isArray(result)?result[0]??null:result});
    }

    return fail(res,405,'Método no permitido');
  }catch(error){
    console.error('WORKFLOW_ROUTES_API_ERROR',String(error?.message||error));
    return fail(res,400,friendly(error));
  }
}
