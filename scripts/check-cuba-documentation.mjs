import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const failures=[];
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const requireFile=file=>{if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta archivo P7`);};

const files={
  lifecycle:'supabase/migrations/20260830183000_p7_cuba_document_version_lifecycle.sql',
  rpcFix:'supabase/migrations/20260830183500_p7_cuba_document_version_rpc_fix.sql',
  api:'api/shipment-documents.js',
  readinessApi:'api/shipment-document-readiness.js',
  salesApi:'api/sales-workspace.js',
  shipmentActions:'api/_shipment-actions.js',
  containers:'admin/containers-module.js'
};
Object.values(files).forEach(requireFile);

if(Object.values(files).every(file=>fs.existsSync(path.join(root,file)))){
  const lifecycle=read(files.lifecycle);
  const rpcFix=read(files.rpcFix);
  const api=read(files.api);
  const readinessApi=read(files.readinessApi);
  const salesApi=read(files.salesApi);
  const shipmentActions=read(files.shipmentActions);
  const containers=read(files.containers);

  for(const required of [
    'superseded_at timestamptz',
    'superseded_by_document_id uuid',
    'deleted_at timestamptz',
    'documents_one_current_cuba_type_idx',
    "d.generated=false and d.deleted_at is null and d.superseded_at is null",
    "public.canonical_cuba_document_type(d.document_type)='Packing List Cuba'",
    "public.canonical_cuba_document_type(d.document_type)='Commercial Invoice Cuba'",
    'current_official_document_count',
    'soft_delete_shipment_customs_document',
    'with (security_invoker=true)'
  ]) if(!lifecycle.includes(required))failures.push(`migración P7 lifecycle: falta ${required}`);

  for(const required of [
    'set superseded_at=now(),superseded_by_document_id=null',
    'set superseded_by_document_id=v_id',
    'return query select v_id,v_version'
  ]) if(!rpcFix.includes(required))failures.push(`migración P7 RPC fix: falta ${required}`);

  for(const signature of [
    'public.create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text)',
    'public.soft_delete_shipment_customs_document(uuid,uuid,text)'
  ]){
    if(!lifecycle.includes(`revoke execute on function ${signature} from public,anon,authenticated`)&&!rpcFix.includes(`revoke execute on function ${signature} from public,anon,authenticated`)) failures.push(`P7: falta revoke ${signature}`);
    if(!lifecycle.includes(`grant execute on function ${signature} to service_role`)&&!rpcFix.includes(`grant execute on function ${signature} to service_role`)) failures.push(`P7: falta grant service_role ${signature}`);
  }

  for(const required of [
    "req.method==='GET'?'documents.read':'documents.write'",
    "rpc/create_shipment_customs_document",
    "rpc/soft_delete_shipment_customs_document",
    'superseded_at,superseded_by_document_id,deleted_at',
    "state:row.deleted_at?'deleted':row.superseded_at?'superseded':'current'"
  ]) if(!api.includes(required))failures.push(`api/shipment-documents.js: falta ${required}`);
  if(api.includes("supabase('documents', {method:'DELETE'" )||api.includes("supabase('documents',{method:'DELETE'")) failures.push('api/shipment-documents.js: no debe hard-delete documentos Cuba');

  if(!readinessApi.includes("authorizeAdmin(req,res,'documents.read')"))failures.push('readiness API: debe exigir documents.read');
  for(const required of [
    "hasPermission(admin,'documents.read')",
    'documentsReadable&&shipmentIds.length',
    'document_access:{read:documentsReadable}'
  ]) if(!salesApi.includes(required))failures.push(`api/sales-workspace.js: falta gate documental ${required}`);

  // UX-5: shipment capabilities carry the effective documents.read permission from DB-backed P3 access.
  for(const required of [
    "action==='view_documents'?'documents.read'",
    'loadAdminAccessContext',
    'shipment_action_capabilities'
  ]) if(!shipmentActions.includes(required))failures.push(`api/_shipment-actions.js: falta contrato documental UX-5 ${required}`);

  for(const required of [
    "actionAllowed(shipment,'view_documents')",
    "window.ExportMcaAccessControl?.can?.('documents.write')===true",
    'Versiones anteriores',
    'Eliminar versión vigente',
    'decision({title:\'Eliminar versión vigente\'',
    'refreshAfterCustomsChange',
    'window.TasksWorkspace?.load?.()',
    'SalesWorkspace?.reload?.({keepTab:true})'
  ]) if(!containers.includes(required))failures.push(`admin/containers-module.js: falta ${required}`);

  const p7Start=containers.indexOf('function latestDocument');
  const p7End=containers.indexOf('async function openHistory');
  if(p7Start<0||p7End<=p7Start) failures.push('admin/containers-module.js: no se pudo delimitar el flujo P7');
  else {
    const p7Flow=containers.slice(p7Start,p7End);
    for(const forbidden of ['alert(', 'confirm(', 'prompt(', '/api/tracking-alerts', 'loadNotifications']) if(p7Flow.includes(forbidden))failures.push(`flujo P7: dependencia/diálogo prohibido ${forbidden}`);
  }
}

if(failures.length){console.error('P7 Cuba documentation check failed:\n'+failures.map(item=>`- ${item}`).join('\n'));process.exit(1);}
console.log('P7 Cuba documentation check passed.');
