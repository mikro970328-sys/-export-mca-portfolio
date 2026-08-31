import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260831133000_ux5_sales_order_action_capabilities.sql');
const helper=read('api/_sales-actions.js');
const salesApi=read('api/sales.js');
const salesLoads=read('api/sales-loads.js');
const salesUi=read('admin/sales.js');
const fixture=read('supabase/tests/ux5_sales_order_actions.sql');
const errors=[];
const requireText=(text,needle,label)=>{if(!text.includes(needle))errors.push(`${label}: falta ${needle}`);};
const forbidText=(text,needle,label)=>{if(text.includes(needle))errors.push(`${label}: conserva ${needle}`);};

for(const token of [
  'function public.sales_order_action_state',
  'function public.assert_sales_order_action',
  'view public.sales_order_action_capabilities',
  "perform public.assert_sales_order_action(v_so.id,v_action)",
  "perform public.assert_sales_order_action(v_so.id,'edit')",
  "perform public.assert_sales_order_action(v_so.id,'allocate_load')",
  'SO_HAS_ACTIVE_CUSTOMER_ADVANCE',
  'SO_HAS_ACTIVE_LOAD_ALLOCATIONS',
  'SO_HAS_ACTIVE_SUPPLY_PLAN',
  'SO_HAS_DIRECT_SHIPMENT_ALLOCATIONS',
  'SO_NO_UNALLOCATED_FULFILLMENT',
  'grant select on public.sales_order_action_capabilities to service_role'
]) requireText(migration,token,'DB canonical owner');

requireText(helper,'loadAdminAccessContext','Sales permission helper');
requireText(helper,"has('sales.write')",'Sales permission helper');
requireText(helper,'loadSalesWriteAccess','Sales permission helper');
requireText(helper,'required_permission=\'sales.write\'','Sales permission helper');
forbidText(helper,'hasPermission(','Sales permission helper');

requireText(salesApi,"from './_sales-actions.js'",'Sales API');
requireText(salesApi,'loadSalesActionCapabilityMap','Sales API');
requireText(salesApi,'loadSalesWriteAccess','Sales API');
requireText(salesApi,'capabilities:capabilityMap.get','Sales API');
requireText(salesApi,'write_access:writeAccess','Sales API');

requireText(salesLoads,"from './_sales-actions.js'",'Sales Loads API');
requireText(salesLoads,"requireCapability(order.capabilities, 'allocate_load')",'Sales Loads API');
requireText(salesLoads,"requireCapability(capabilities, 'allocate_load')",'Sales Loads API');
forbidText(salesLoads,"order.status !== 'confirmed'",'Sales Loads API');
forbidText(salesLoads,"order.status!=='confirmed'",'Sales Loads API');

requireText(salesUi,'function capability(order,key)','Sales UI');
requireText(salesUi,'function can(order,key)','Sales UI');
for(const token of ["can(o,'edit')","can(o,'confirm')","can(o,'allocate_load')","can(o,'close')","can(o,'cancel')","$('newOrder').hidden=!writeAccess"]){
  requireText(salesUi,token,'Sales UI');
}
forbidText(salesUi,'function hasUnallocated','Sales UI');
forbidText(salesUi,"if(o.status==='draft')acts.push",'Sales UI');
forbidText(salesUi,"if(o.status==='confirmed')",'Sales UI');
if(/\b(?:prompt|alert|confirm)\s*\(/.test(salesUi))errors.push('Sales UI: no debe usar diálogos nativos en el flujo modernizado');
if(/MutationObserver/.test(salesUi))errors.push('Sales UI: no debe usar MutationObserver');

for(const token of [
  'begin;',
  'rollback;',
  'UX5_SALES_DRAFT_CONFIRM_EXPECTED',
  'UX5_SALES_ALLOCATE_EXPECTED',
  'UX5_SALES_CLOSE_BEFORE_DISPATCH_FORBIDDEN',
  'UX5_SALES_REPLACE_DID_NOT_BLOCK',
  'sales_order_fixture_residue',
  'workflow_task_fixture_residue'
]) requireText(fixture,token,'Sales reversible fixture');

if(errors.length){
  console.error('UX5 Sales canonical actions check failed:');
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}
console.log('UX5 Sales canonical actions check passed.');
