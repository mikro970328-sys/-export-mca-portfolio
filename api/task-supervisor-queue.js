import { authorizeAdmin, fail, ok, supabase } from './_lib.js';

const ATTENTION_RANK=Object.freeze({blocked:0,overdue:1,unassigned:2,due_soon:3,normal:4,closed:5});
const PRIORITY_RANK=Object.freeze({critical:0,high:1,normal:2,low:3});

function asTime(value){const n=Date.parse(value||'');return Number.isFinite(n)?n:null;}
function compareTasks(a,b){
  const attention=(ATTENTION_RANK[a.attention_state]??99)-(ATTENTION_RANK[b.attention_state]??99);
  if(attention)return attention;
  const priority=(PRIORITY_RANK[a.priority]??99)-(PRIORITY_RANK[b.priority]??99);
  if(priority)return priority;
  const ad=asTime(a.due_at),bd=asTime(b.due_at);
  if(ad!==null||bd!==null){if(ad===null)return 1;if(bd===null)return -1;if(ad!==bd)return ad-bd;}
  return (asTime(b.updated_at)||0)-(asTime(a.updated_at)||0);
}
function inc(map,key,label){const id=String(key??'unassigned');if(!map.has(id))map.set(id,{key:id,label:label||'Sin asignar',count:0});map.get(id).count+=1;}
function groups(rows){
  const workflows=new Map(),priorities=new Map(),teams=new Map(),assignees=new Map();
  for(const row of rows.filter(item=>item.is_open)){
    inc(workflows,row.workflow_key||'manual',row.workflow_label||'Manual');
    inc(priorities,row.priority,row.priority);
    inc(teams,row.assigned_team_id,row.assigned_team_name||'Sin equipo');
    inc(assignees,row.assigned_admin_id,row.assigned_admin_name||row.assigned_admin_username||'Sin responsable');
  }
  const convert=map=>[...map.values()].sort((a,b)=>b.count-a.count||a.label.localeCompare(b.label,'es'));
  return {workflows:convert(workflows),priorities:convert(priorities),teams:convert(teams),assignees:convert(assignees)};
}
function summary(rows){
  const active=rows.filter(row=>row.is_open);
  return {
    open:active.length,
    unassigned:active.filter(row=>row.attention_state==='unassigned').length,
    due_soon:active.filter(row=>row.attention_state==='due_soon').length,
    overdue:active.filter(row=>row.attention_state==='overdue').length,
    blocked:active.filter(row=>row.attention_state==='blocked').length,
    normal:active.filter(row=>row.attention_state==='normal').length,
    routing_attention:active.filter(row=>row.needs_routing_attention).length,
    completed:rows.filter(row=>row.status==='completed').length,
    cancelled:rows.filter(row=>row.status==='cancelled').length
  };
}

export default async function handler(req,res){
  const admin=await authorizeAdmin(req,res,'tasks.manage');
  if(!admin)return;
  if(req.method!=='GET')return fail(res,405,'Método no permitido');
  try{
    const [taskRows,routeRows]=await Promise.all([
      supabase('operational_task_attention',{query:'?select=*&limit=5000'}),
      supabase('workflow_task_route_health',{query:'?select=*&order=label.asc'})
    ]);
    const tasks=(Array.isArray(taskRows)?taskRows:[]).sort(compareTasks);
    const routes=Array.isArray(routeRows)?routeRows:[];
    return ok(res,{
      summary:summary(tasks),
      groups:groups(tasks),
      tasks,
      routes,
      generated_at:new Date().toISOString()
    });
  }catch(error){
    console.error('TASK_SUPERVISOR_QUEUE_ERROR',String(error?.message||error));
    return fail(res,500,'No se pudo cargar la cola de supervisión');
  }
}
