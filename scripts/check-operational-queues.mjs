import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const requiredFiles=[
  'supabase/migrations/20260830203500_p8_operational_task_attention.sql',
  'api/task-supervisor-queue.js',
  'admin/task-supervisor-queue.js',
  'admin/task-supervisor-queue.css',
  'admin/erp.js'
];
for(const file of requiredFiles)if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta archivo P8`);

if(!failures.length){
  const migration=read(requiredFiles[0]);
  const api=read(requiredFiles[1]);
  const ui=read(requiredFiles[2]);
  const css=read(requiredFiles[3]);
  const loader=read(requiredFiles[4]);

  for(const required of [
    'blocked_at timestamptz',
    'assignment_state_changed_at timestamptz',
    'track_operational_task_attention_timestamps',
    'required_permissions text[]',
    'due_soon_minutes integer',
    'workflow_task_route_health',
    'operational_task_attention',
    "when w.status='blocked' then 'blocked'",
    "then 'overdue'",
    "then 'unassigned'",
    "then 'due_soon'",
    "else 'normal'",
    'needs_routing_attention',
    'with (security_invoker=true)',
    'grant select on public.operational_task_attention to service_role',
    'revoke all on public.operational_task_attention from public,anon,authenticated'
  ]) if(!migration.includes(required))failures.push(`migración P8: falta ${required}`);

  if(/status\s*=\s*['"]overdue['"]/.test(migration))failures.push('P8: overdue no puede persistirse como status');
  if(/status\s*=\s*['"]due_soon['"]/.test(migration))failures.push('P8: due_soon no puede persistirse como status');
  if(/status\s*=\s*['"]unassigned['"]/.test(migration))failures.push('P8: unassigned no puede persistirse como status');

  for(const required of [
    "authorizeAdmin(req,res,'tasks.manage')",
    "supabase('operational_task_attention'",
    "supabase('workflow_task_route_health'",
    'summary:summary(tasks)',
    'groups:groups(tasks)'
  ]) if(!api.includes(required))failures.push(`API supervisor P8: falta ${required}`);

  for(const forbidden of ['/api/tracking-alerts','notifications','operational_alert','create_alert']) {
    if(api.toLowerCase().includes(forbidden.toLowerCase())) failures.push(`API supervisor P8: dependencia prohibida ${forbidden}`);
  }

  for(const required of [
    "canManage=()=>window.ExportMcaAccessControl?.can?.('tasks.manage')===true",
    'Supervisión de trabajo',
    'Esto no crea Alertas ni Notificaciones',
    'data-task-supervisor-filter',
    'needs_routing_attention',
    'window.TasksWorkspace?.open?.(id)'
  ]) if(!ui.includes(required))failures.push(`UI supervisor P8: falta ${required}`);

  if(/alert\s*\(|confirm\s*\(|prompt\s*\(/.test(ui))failures.push('UI supervisor P8: no usar diálogos nativos');
  if(!css.includes('.task-supervisor-summary')||!css.includes('@media(max-width:720px)'))failures.push('CSS supervisor P8: falta estructura responsive');

  for(const required of [
    "if (accessCan('tasks.manage'))",
    "'/admin/task-supervisor-queue.css?v=20260830-p8'",
    "'/admin/task-supervisor-queue.js?v=20260830-p8'"
  ]) if(!loader.includes(required))failures.push(`loader P8: falta ${required}`);
}

if(failures.length){
  console.error('P8 operational queue check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('P8 operational queue check passed.');
