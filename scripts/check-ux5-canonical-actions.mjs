import fs from 'node:fs';

const failures=[];
const read=file=>fs.readFileSync(file,'utf8');
const migration=read('supabase/migrations/20260831122500_ux5_purchase_order_action_capabilities.sql');
const editMigration=read('supabase/migrations/20260831122600_ux5_purchase_order_edit_assertion.sql');
const api=read('api/purchases.js');
const ui=read('admin/purchases.js');
const test=read('supabase/tests/ux5_purchase_order_actions.sql');
const requireText=(label,source,text)=>{if(!source.includes(text))failures.push(`${label}: falta ${text}`);};
const forbid=(label,source,re,msg)=>{if(re.test(source))failures.push(`${label}: ${msg}`);};

for(const text of [
  'create or replace function public.purchase_order_action_state',
  'create or replace function public.assert_purchase_order_action',
  'create or replace view public.purchase_order_action_capabilities',
  "'receive_remaining'",
  "'receive_excess'",
  "perform public.assert_purchase_order_action(v_po.id,v_action)",
  "perform public.assert_purchase_order_action(v_po_id,v_receipt_action)",
  "v_receipt_status='received'",
  "'PO_ALREADY_FULLY_RECEIVED'",
  'with (security_invoker=true)',
  'grant select on public.purchase_order_action_capabilities to service_role'
])requireText('DB canonical action owner',migration,text);
requireText('DB edit mutation owner',editMigration,"perform public.assert_purchase_order_action(v_po.id,'edit')");

for(const text of [
  'loadAdminAccessContext',
  "permissionSet.has('procurement.write')",
  "permissionSet.has('warehouse.write')",
  "admin?.role==='master_admin'",
  "supabase('purchase_order_action_capabilities'",
  'capabilities:capabilitiesByPo.get(order.id)',
  "key.startsWith('receive_')?'warehouse.write':'procurement.write'"
])requireText('API capability contract',api,text);
forbid('API capability contract',api,/\bhasPermission\s*\(/,'no debe depender de un helper hasPermission paralelo/inexistente');

for(const text of [
  "function capability(order,key)",
  "function can(order,key)",
  "can(o,'receive_remaining')",
  "can(o,'receive_excess')",
  "data-detail-action=\"receive_excess\"",
  "openReceive(order,'remaining')",
  "openReceive(order,'excess')",
  "if(!order||!can(order,key))"
])requireText('UI capability consumer',ui,text);

forbid('Purchase list action ownership',ui,/\[\s*['\"]issued['\"],\s*['\"]confirmed['\"]\s*\]\.includes\(o\.status\)[\s\S]{0,120}Recibir/,'no puede inferir Recibir desde status comercial');
forbid('Purchase detail action ownership',ui,/if\s*\(o\.status===['\"](?:issued|confirmed)['\"]\)\s*acts\.push/,'no puede construir CTAs por status comercial');

for(const text of [
  'begin;',
  'UX5_FULL_RECEIVE_MUST_DISAPPEAR',
  'UX5_EXCESS_ACTION_EXPECTED',
  'PO_ALREADY_FULLY_RECEIVED',
  'rollback;',
  'purchase_order_fixture_residue',
  'warehouse_receipt_fixture_residue',
  'allocation_fixture_residue'
])requireText('DB reversible fixture',test,text);

if(failures.length){console.error('UX5 canonical actions check failed:\n'+failures.map(x=>`- ${x}`).join('\n'));process.exit(1);}
console.log('UX5 canonical action ownership check passed.');
