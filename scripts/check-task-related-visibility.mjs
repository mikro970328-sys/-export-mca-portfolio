import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as realLib from '../api/_lib.js';

// Run the real handler with an isolated PostgREST transport; no credentials or writes.
const id = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const actor=id(1), other=id(2), team=id(3), foreignTeam=id(4);
const parent={id:id(10),title:'Visible parent',assigned_admin_id:actor,status:'pending',open_dependency_count:4};
const related=[
  {id:id(11),title:'Assigned',assigned_admin_id:actor},
  {id:id(12),title:'Created',created_by:actor},
  {id:id(13),title:'Team',assigned_team_id:team},
  {id:id(14),title:'PRIVATE_TITLE',description:'PRIVATE_DESCRIPTION',assigned_admin_id:other,assigned_team_id:foreignTeam,entity_type:'invoice',entity_id:id(99)}
];
const source=fs.readFileSync('api/tasks.js','utf8').replace(/^import \{([^}]+)\} from '.\/_lib.js';/m,'const {$1}=lib;').replace('export default async function handler','async function handler');
assert.doesNotMatch(source,/^import |^export /m);
let checks=0;
async function request({manage=false,master=false,teams=[team],target=parent.id,transition=false,teamError=false,relatedError=false}={}) {
  const calls=[];
  const lib={...realLib,authorizeAdmin:async()=>({admin_id:actor,role:master?'master_admin':'operator'}),writeAudit:async()=>{},
    supabase:async(table,options={})=>{
      calls.push({table,...options});
      if(table==='admin_effective_permissions')return options.query.includes('tasks.manage')?(manage?[{}]:[]):[{}];
      if(table==='admin_team_directory') {if(teamError)throw Object.assign(new Error('PRIVATE_FAILURE'),{retryable:true});return teams.map(team_id=>({team_id}));}
      if(table==='operational_task_workspace'){
        if(relatedError&&options.query.includes('&id=in.'))throw Object.assign(new Error('PRIVATE_FAILURE'),{retryable:true});
        const params=new URLSearchParams(options.query.slice(1));
        const filter=params.get('id');
        let rows=[parent,...related].filter(row=>!filter||filter===`eq.${row.id}`||filter.startsWith('in.')&&filter.includes(row.id));
        const visibility=params.get('or');
        if(visibility)rows=rows.filter(row=>visibility.includes(`assigned_admin_id.eq.${row.assigned_admin_id}`)||visibility.includes(`created_by.eq.${row.created_by}`)||(row.assigned_team_id&&visibility.includes(row.assigned_team_id)));
        return rows;
      }
      if(table==='operational_task_dependencies')return options.query.includes('&task_id=eq.')?related.map(row=>({depends_on_task_id:row.id})):related.map(row=>({task_id:row.id}));
      if(table==='operational_task_comments'||table==='operational_task_history')return [];
      if(table==='invoices')return [{id:id(99),invoice_number:'PRIVATE_INVOICE'}];
      if(table==='rpc/transition_operational_task')throw new Error('TASK_OPEN_DEPENDENCIES');
      throw new Error(`Unexpected transport ${table}`);
    }};
  const handler=new Function('lib','console',`${source}\nreturn handler;`)(lib,{error(){}});
  const res={setHeader(){},end(body){this.body=JSON.parse(body);}};
  await handler({method:transition?'POST':'GET',url:`/api/tasks?id=${target}`,body:transition?{action:'transition',task_id:target,status:'completed'}:undefined},res);
  return {...res,calls};
}
for(const opts of [{},{teams:[]},{manage:true},{master:true}]){
  const response=await request(opts);
  assert.equal(response.statusCode,200);
  const task=response.body.task;
  const expected=opts.manage||opts.master?related:related.filter(row=>row.id!==id(14)&&(opts.teams?.length!==0||row.id!==id(13)));
  assert.deepEqual(task.dependencies.map(row=>row.id),expected.map(row=>row.id));
  assert.deepEqual(task.dependents.map(row=>row.id),expected.map(row=>row.id));
  assert.equal(task.restricted_dependency_count,related.length-expected.length);
  assert.equal(task.open_dependency_count,4,'Visibility must not alter the authoritative blocker count');
  if(!opts.manage&&!opts.master){
    assert.doesNotMatch(JSON.stringify(task),/PRIVATE_/);
    assert.equal(response.calls.some(call=>call.table==='invoices'),false,'Do not enrich hidden entities');
  }
  checks++;
}
const denied=await request({target:id(14)});
assert.equal(denied.statusCode,404);assert.equal(denied.calls.some(call=>call.table==='operational_task_dependencies'),false);checks++;
const failed=await request({teamError:true});assert.equal(failed.statusCode,503);assert.doesNotMatch(JSON.stringify(failed.body),/PRIVATE_/);checks++;
const relatedFailed=await request({relatedError:true});assert.equal(relatedFailed.statusCode,503);assert.equal(relatedFailed.body.task,undefined);checks++;
const blocked=await request({transition:true});assert.equal(blocked.statusCode,400);assert.match(blocked.body.error,/dependencias pendientes/);checks++;
const ui=fs.readFileSync('admin/tasks-workspace.js','utf8');
const renderSource=ui.slice(ui.indexOf('  function detailMarkup(task) {'),ui.indexOf('  async function openDetail(id)'));
const render=new Function('can','esc','entityLabels','statusLabels','priorityLabels','formatDate','historyLabel',`${renderSource};return detailMarkup;`)(()=>false,String,{}, {}, {},()=>'',()=> '');
for(const [dependencies,restricted] of [[[],0],[[],1],[[related[0]],1],[[related[0]],0]]){
  const html=render({...parent,dependencies,restricted_dependency_count:restricted});
  assert.equal(html.includes('Hay dependencias fuera de tu acceso'),Boolean(restricted));
  assert.equal(html.includes('Sin dependencias.'),!restricted&&!dependencies.length);
  assert.equal(html.includes('Assigned'),Boolean(dependencies.length));
  checks++;
}
console.log(`Task related visibility: ${checks}/${checks} isolated handler/UI scenarios passed`);
