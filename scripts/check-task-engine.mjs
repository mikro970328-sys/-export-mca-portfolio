import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const requireFile=file=>{if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta archivo P4`);};

const files=[
  'supabase/migrations/20260830154000_p4_task_engine.sql',
  'api/tasks.js',
  'admin/tasks-workspace.js',
  'admin/tasks-workspace.css',
  'admin/tasks-navigation.js',
  'admin/erp.js'
];
files.forEach(requireFile);

if(files.every(file=>fs.existsSync(path.join(root,file)))) {
  const migration=read(files[0]);
  const api=read(files[1]);
  const ui=read(files[2]);
  const css=read(files[3]);
  const navigation=read(files[4]);
  const loader=read(files[5]);

  for(const permission of ['tasks.read','tasks.write','tasks.manage']) {
    if(!migration.includes(`'${permission}'`))failures.push(`migración P4: falta ${permission}`);
  }

  for(const table of ['operational_tasks','operational_task_comments','operational_task_history','operational_task_dependencies']) {
    if(!migration.includes(`public.${table}`))failures.push(`migración P4: falta ${table}`);
  }
  for(const rpc of ['create_operational_task','update_operational_task','transition_operational_task','add_operational_task_comment','set_operational_task_dependencies']) {
    if(!migration.includes(`function public.${rpc}`))failures.push(`migración P4: falta RPC ${rpc}`);
  }
  for(const required of [
    'with (security_invoker=true)',
    'TASK_HARD_DELETE_FORBIDDEN',
    'TASK_APPEND_ONLY_RECORD_IMMUTABLE',
    'TASK_DEPENDENCY_CYCLE',
    'TASK_ASSIGNEE_NOT_TEAM_MEMBER',
    'create unique index operational_tasks_dedupe_key_uidx'
  ]) if(!migration.includes(required))failures.push(`migración P4: falta ${required}`);

  for(const role of ['public,anon,authenticated','service_role']) {
    if(!migration.includes(role))failures.push(`migración P4: faltan grants/revokes para ${role}`);
  }

  for(const required of [
    "authorizeAdmin(req,res,'tasks.read')",
    "authorizeAdmin(req,res,'tasks.write')",
    "authorizeAdmin(req,res,'tasks.manage')",
    'visibilityQuery(admin,manage)',
    'activeTeamIds(admin.admin_id)',
    "bodyAction === 'set_dependencies'",
    "bodyAction === 'transition'"
  ]) if(!api.includes(required))failures.push(`api/tasks.js: falta ${required}`);
  if(/req\.method\s*===\s*['"]DELETE['"]/.test(api))failures.push('api/tasks.js: no debe exponer hard-delete');

  for(const required of ['Mis tareas','tasksSection','window.TasksWorkspace','tasks.read','tasks.write','tasks.manage','data-task-transition','tasksCommentForm']) {
    if(!ui.includes(required))failures.push(`admin/tasks-workspace.js: falta ${required}`);
  }
  for(const forbidden of ['prompt(', 'alert(', 'confirm(']) {
    if(ui.includes(forbidden))failures.push(`admin/tasks-workspace.js: diálogo nativo prohibido ${forbidden}`);
  }
  if(!ui.includes(".nav-group[data-nav-group=\"home\"] .submenu"))failures.push('admin/tasks-workspace.js: Mis tareas no se monta en Inicio');
  if(!css.includes('@media(max-width:720px)'))failures.push('admin/tasks-workspace.css: falta adaptación móvil');

  for(const required of ['tasksSection',"window.showSection('tasksSection')",'data-section="tasksSection"']) {
    if(!navigation.includes(required))failures.push(`admin/tasks-navigation.js: falta ${required}`);
  }

  for(const required of [
    "accessCan('tasks.read')",
    '/admin/tasks-workspace.css?v=20260830-p4',
    '/admin/tasks-workspace.js?v=20260830-p4',
    '/admin/tasks-navigation.js?v=20260830-p4',
    '/admin/navigation-shell.js?v=20260830-p3',
    '/admin/section-state.js?v=20260817-nav1'
  ]) if(!loader.includes(required))failures.push(`admin/erp.js: falta ${required}`);
  const navIndex=loader.indexOf('/admin/navigation-shell.js?v=20260830-p3');
  const taskIndex=loader.indexOf('/admin/tasks-workspace.js?v=20260830-p4');
  const taskNavIndex=loader.indexOf('/admin/tasks-navigation.js?v=20260830-p4');
  const stateIndex=loader.indexOf('/admin/section-state.js?v=20260817-nav1');
  if(navIndex<0||taskIndex<0||taskNavIndex<0||stateIndex<0||!(navIndex<taskIndex&&taskIndex<taskNavIndex&&taskNavIndex<stateIndex))failures.push('admin/erp.js: orden requerido Navigation Shell → Mis tareas → navegación tareas → section-state');
}

if(failures.length){console.error('P4 task-engine check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));process.exit(1);}
console.log('P4 task-engine check passed.');
