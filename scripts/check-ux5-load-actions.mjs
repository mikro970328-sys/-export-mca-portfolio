import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260831233000_ux5_load_action_capabilities.sql');
const helper=read('api/_load-actions.js');
const api=read('api/loads.js');
const ui=read('admin/loads.js');
const html=read('admin/loads.html');
const fixture=read('supabase/tests/ux5_load_actions.sql');
const errors=[];
const requireText=(source,needle,label)=>{if(!source.includes(needle))errors.push(`${label}: falta ${needle}`);};
const forbidText=(source,needle,label)=>{if(source.includes(needle))errors.push(`${label}: conserva ${needle}`);};

for(const token of [
  'function public.load_action_state',
  'function public.assert_load_action',
  'view public.load_action_capabilities',
  'function public.execute_load_action',
  'function public.replace_load_plan_canonical',
  'function public.assign_load_shipment_canonical',
  'function public.create_load_shipment_canonical',
  "perform public.assert_load_action(v_load.id,v_action)",
  "perform public.assert_load_action(v_load.id,'edit')",
  "perform public.assert_load_action(v_load.id,'assign_container')",
  "perform public.assert_load_action(v_load.id,'create_container')",
  'grant select on public.load_action_capabilities to service_role',
  "set search_path to 'public','pg_temp'"
])requireText(migration,token,'DB canonical owner');

requireText(helper,'loadAdminAccessContext','Load permission helper');
requireText(helper,"'logistics.read'",'Load permission helper');
requireText(helper,"'logistics.write'",'Load permission helper');
requireText(helper,"admin?.role==='master_admin'",'Load permission helper');
requireText(helper,"key==='view_tracking'?'logistics.read':'logistics.write'",'Load permission helper');
requireText(helper,'load_action_capabilities','Load permission helper');
forbidText(helper,'hasPermission(','Load permission helper');

requireText(api,"from './_load-actions.js'",'Loads API');
requireText(api,'loadLoadActionCapabilityMap','Loads API');
requireText(api,'loadLoadActionCapabilities','Loads API');
requireText(api,'capabilities:capabilityMap.get','Loads API');
requireText(api,"supabase('rpc/execute_load_action'",'Loads API');
requireText(api,"supabase('rpc/replace_load_plan_canonical'",'Loads API');
requireText(api,"supabase('rpc/create_load_shipment_canonical'",'Loads API');
requireText(api,"supabase('rpc/assign_load_shipment_canonical'",'Loads API');
for(const legacy of ["supabase('rpc/reserve_load'","supabase('rpc/release_load'","supabase('rpc/start_load_loading'","supabase('rpc/mark_load_loaded'","supabase('rpc/dispatch_load'","supabase('rpc/cancel_load'","supabase('rpc/unassign_load_shipment'","supabase('rpc/replace_load_plan'","supabase('rpc/create_load_shipment'","supabase('rpc/assign_load_shipment'"]){forbidText(api,legacy,'Loads API canonical routing');}
forbidText(api,'load_expediente_documents','Loads API');
forbidText(api,'expediente_documents','Loads API');

requireText(ui,'const capability=(load,key)','Loads UI');
requireText(ui,'const can=(load,key)','Loads UI');
for(const token of ["can(l,'reserve')","can(l,'release')","can(l,'start_loading')","can(l,'mark_loaded')","can(l,'dispatch')","can(l,'edit')","can(l,'cancel')","can(l,'assign_container')","can(l,'unassign_container')","can(l,'view_tracking')","$('newLoad').hidden=state.write_access!==true"]){requireText(ui,token,'Loads UI');}
forbidText(ui,"if(l.status==='draft')",'Loads UI');
forbidText(ui,"if(l.status==='reserved')",'Loads UI');
forbidText(ui,"if(l.status==='loading')",'Loads UI');
forbidText(ui,"if(l.status==='loaded'",'Loads UI');
forbidText(ui,'openExpediente','Loads UI');
forbidText(ui,'expediente','Loads UI');
if(/\b(?:prompt|alert|confirm)\s*\(/.test(ui))errors.push('Loads UI: no debe usar diálogos nativos en el flujo modernizado');
requireText(html,'id="decisionModal"','Loads decision UI');
requireText(html,'id="decisionAccept"','Loads decision UI');
requireText(html,'src="/admin/loads.js"','Loads external UI owner');
forbidText(html,'openExpediente','Loads HTML');

for(const token of [
  'begin;',
  'rollback;',
  'UX5_LOAD_DRAFT_RESERVE_EXPECTED',
  'UX5_LOAD_START_LOADING_EXPECTED',
  'UX5_LOAD_DISPATCH_WITHOUT_CONTAINER_FORBIDDEN',
  'UX5_LOAD_DISPATCH_EXPECTED',
  'UX5_LOAD_FINAL_STATE_ACTION_LEAK',
  'load_fixture_residue',
  'load_item_fixture_residue',
  'load_allocation_fixture_residue',
  'inventory_movement_fixture_residue',
  'shipment_fixture_residue'
])requireText(fixture,token,'Load reversible fixture');

if(errors.length){
  console.error('UX5 Load canonical actions check failed:');
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}
console.log('UX5 Load canonical actions check passed.');
