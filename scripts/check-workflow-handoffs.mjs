import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const requireFile=file=>{if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta archivo P5`);};

const files=[
  'supabase/migrations/20260830170000_p5_workflow_routing_foundation.sql',
  'supabase/migrations/20260830172000_p5_workflow_handoff_rules.sql',
  'supabase/migrations/20260830174500_p5_workflow_dependency_integrity.sql',
  'api/workflow-routes.js',
  'admin/workflow-route-settings.js',
  'admin/workflow-route-settings.css',
  'admin/erp.js'
];
files.forEach(requireFile);

if(files.every(file=>fs.existsSync(path.join(root,file)))){
  const foundation=read(files[0]);
  const rules=read(files[1]);
  const dependencies=read(files[2]);
  const api=read(files[3]);
  const ui=read(files[4]);
  const css=read(files[5]);
  const loader=read(files[6]);

  const workflows=['sales_supply_planning','sales_procurement_linkage','purchase_receipt','direct_fulfillment','prepare_load','shipment_cuba_documents','sales_invoice','invoice_collection','supplier_bill_payment'];
  for(const key of workflows){
    if(!foundation.includes(`'${key}'`))failures.push(`foundation: falta workflow ${key}`);
  }

  for(const required of [
    'create table if not exists public.workflow_task_routes',
    'with (security_invoker=true)',
    'create or replace function public.sync_workflow_task',
    "v_dedupe := 'workflow:' || p_workflow_key",
    'origin,workflow_key,source_event_key,dedupe_key',
    "'workflow_created'",
    "'workflow_reopened'",
    "'workflow_completed'",
    "'workflow_cancelled'",
    'WORKFLOW_ROUTE_ASSIGNEE_NOT_TEAM_MEMBER',
    'revoke all on public.workflow_task_routes from public,anon,authenticated',
    'grant execute on function public.sync_workflow_task'
  ]) if(!foundation.includes(required))failures.push(`foundation: falta ${required}`);

  for(const required of [
    'workflow_sales_order_handoff_state',
    'reconcile_sales_order_workflow_tasks',
    'reconcile_purchase_order_workflow_tasks',
    'reconcile_shipment_workflow_tasks',
    'reconcile_invoice_workflow_tasks',
    'reconcile_supplier_bill_workflow_tasks',
    'reconcile_current_workflow_tasks',
    "select id from public.shipments where active=true",
    "select id from public.purchase_orders where status='confirmed'",
    "select id from public.supplier_bills where status='posted'",
    'workflow_document_reconcile',
    'workflow_direct_dispatch_reconcile',
    'workflow_purchase_receipt_allocation_reconcile',
    'workflow_supplier_payment_reconcile'
  ]) if(!rules.includes(required))failures.push(`rules: falta ${required}`);
  if(rules.includes("for r in select id from public.shipments where active=false"))failures.push('rules: bootstrap no debe backfillear shipments históricos inactivos');

  for(const required of [
    'v_has_open_dependencies',
    "dependency.status<>'completed'",
    "'workflow_waiting_dependencies'",
    'reconcile_workflow_task_by_task_id',
    'workflow_tasks_reconcile_dependents',
    'sync_workflow_task'
  ]) if(!dependencies.includes(required))failures.push(`dependency hardening: falta ${required}`);

  for(const required of [
    "authorizeAdmin(req,res,'tasks.manage')",
    "'reconcile_current'",
    "rpc('update_workflow_task_route'",
    "rpc('reconcile_current_workflow_tasks'"
  ]) if(!api.includes(required))failures.push(`api/workflow-routes.js: falta ${required}`);

  for(const required of ['Configurar handoffs','data-workflow-routes-open','data-workflow-reconcile','tasks.manage','/api/workflow-routes']){
    if(!ui.includes(required))failures.push(`workflow-route-settings.js: falta ${required}`);
  }
  for(const forbidden of ['prompt(', 'alert(', 'confirm(']) if(ui.includes(forbidden))failures.push(`workflow-route-settings.js: diálogo nativo prohibido ${forbidden}`);
  if(!css.includes('@media(max-width:620px)'))failures.push('workflow-route-settings.css: falta adaptación móvil');

  for(const required of [
    "accessCan('tasks.manage')",
    '/admin/workflow-route-settings.css?v=20260830-p5',
    '/admin/workflow-route-settings.js?v=20260830-p5'
  ]) if(!loader.includes(required))failures.push(`admin/erp.js: falta ${required}`);
  const tasksIndex=loader.indexOf('/admin/tasks-workspace.js?v=20260903-ux7tasks1');
  const routeIndex=loader.indexOf('/admin/workflow-route-settings.js?v=20260830-p5');
  if(tasksIndex<0||routeIndex<0||tasksIndex>routeIndex)failures.push('admin/erp.js: configuración de handoffs debe cargar después de Mis tareas');
}

if(failures.length){console.error('P5 workflow-handoffs check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));process.exit(1);}
console.log('P5 workflow-handoffs check passed.');
