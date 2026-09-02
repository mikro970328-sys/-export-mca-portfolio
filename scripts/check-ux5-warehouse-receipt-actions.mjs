import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260901004000_ux5_warehouse_receipt_action_capabilities.sql');
const helper=read('api/_warehouse-actions.js');
const api=read('api/warehouse.js');
const html=read('admin/warehouse.html');
const ui=read('admin/warehouse.js');
const fixture=read('supabase/tests/ux5_warehouse_receipt_actions.sql');
const errors=[];
const requireText=(source,needle,label)=>{if(!source.includes(needle))errors.push(`${label}: falta ${needle}`);};
const forbidText=(source,needle,label)=>{if(source.includes(needle))errors.push(`${label}: conserva ${needle}`);};

for(const token of [
  'function public.warehouse_receipt_action_state',
  'function public.assert_warehouse_receipt_action',
  'view public.warehouse_receipt_action_capabilities',
  'with (security_invoker=true)',
  "'WR_HAS_INVENTORY_HISTORY'",
  "'WR_ASSIGNED_TO_LOAD'",
  "'WR_NOT_RECEIVED'",
  "perform public.assert_warehouse_receipt_action(old.id,'cancel')",
  'function public.cancel_warehouse_receipt_canonical',
  "perform public.assert_warehouse_receipt_action(p_receipt_id,'cancel')",
  "set search_path to 'public','pg_temp'",
  'revoke all on public.warehouse_receipt_action_capabilities from public,anon,authenticated,service_role',
  'grant select on public.warehouse_receipt_action_capabilities to service_role'
])requireText(migration,token,'WR DB action owner');

for(const token of [
  'loadAdminAccessContext',
  "admin?.role==='master_admin'",
  "'warehouse.write'",
  'warehouse_receipt_action_capabilities',
  "entry.required_permission='warehouse.write'",
  "entry.reason='PERMISSION_REQUIRED'"
])requireText(helper,token,'WR permission helper');
forbidText(helper,'hasPermission(','WR permission helper');

for(const token of [
  "from './_warehouse-actions.js'",
  'loadWarehouseReceiptActionCapabilityMap(admin)',
  'capabilities:receiptAccess.map.get',
  'write_access:receiptAccess.write_access',
  "rpc/cancel_warehouse_receipt_canonical"
])requireText(api,token,'Warehouse API');
forbidText(api,"body:{ status:'cancelled'",'Warehouse API legacy cancel mutation');
forbidText(api,'&status=eq.received&select=*','Warehouse API legacy cancel mutation');

requireText(html,'<script src="/admin/warehouse.js?v=20260902-ux6owner1"></script>','Warehouse HTML external JS ownership');
if(/<script>(.|\n)*cancelReceipt/.test(html))errors.push('Warehouse HTML: conserva lógica inline de cancelación');

for(const token of [
  "const actionAllowed=(receipt,action)=>receipt?.capabilities?.actions?.[action]?.allowed===true",
  "actionAllowed(r,'cancel')",
  "if(!receipt||!actionAllowed(receipt,'cancel'))",
  "word:'ANULAR'",
  "action:'cancel_receipt'"
])requireText(ui,token,'Warehouse UI');
forbidText(ui,"r.status==='received'?`<button class=\"danger\" onclick=\"cancelReceipt",'Warehouse UI action-state inference');
if(/\b(?:prompt|alert|confirm)\s*\(/.test(ui))errors.push('Warehouse UI: no debe usar diálogos nativos en el flujo modernizado');
if(/expediente/i.test(ui))errors.push('Warehouse UI: no debe reintroducir Expedientes');

for(const token of [
  'begin;',
  'rollback;',
  'UX5_WR_HISTORY_CANCEL_FORBIDDEN',
  'UX5_WR_ACTIVE_LOAD_CANCEL_FORBIDDEN',
  'UX5_WR_CLEAN_CANCEL_EXPECTED',
  'UX5_WR_REPEAT_CANCEL_FORBIDDEN',
  'overriding system value',
  'receipt_fixture_residue',
  'receipt_item_fixture_residue',
  'movement_fixture_residue',
  'load_fixture_residue',
  'load_item_fixture_residue',
  'allocation_fixture_residue'
])requireText(fixture,token,'WR reversible fixture');
forbidText(fixture,'insert into public.loads(id,load_number','WR fixture generated load_number ownership');

if(errors.length){
  console.error('UX5 Warehouse Receipt canonical actions check failed:');
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}
console.log('UX5 Warehouse Receipt canonical actions check passed.');
