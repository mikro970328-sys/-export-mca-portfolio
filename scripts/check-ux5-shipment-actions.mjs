import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260831235500_ux5_shipment_action_capabilities.sql');
const helper=read('api/_shipment-actions.js');
const api=read('api/shipments.js');
const tracking=read('api/manual-tracking-event.js');
const loader=read('admin/admin-data-loader.js');
const ui=read('admin/containers-module.js');
const fixture=read('supabase/tests/ux5_shipment_actions.sql');
const errors=[];
const requireText=(source,needle,label)=>{if(!source.includes(needle))errors.push(`${label}: falta ${needle}`);};
const forbidText=(source,needle,label)=>{if(source.includes(needle))errors.push(`${label}: conserva ${needle}`);};

for(const token of [
  'function public.shipment_action_state',
  'function public.assert_shipment_action',
  'view public.shipment_action_capabilities',
  "'assign_client'",
  "'manual_tracking'",
  "'release'",
  "'deliver'",
  "'reactivate'",
  "'delete'",
  "'SHIPMENT_LINKED_TO_LOAD'",
  'grant select on public.shipment_action_capabilities to service_role',
  "set search_path to 'public','pg_temp'"
])requireText(migration,token,'DB shipment action owner');

for(const token of [
  'loadAdminAccessContext',
  "admin?.role==='master_admin'",
  "'logistics.read'",
  "'logistics.write'",
  "'documents.read'",
  'shipment_action_capabilities',
  'assertShipmentBusinessAction'
])requireText(helper,token,'Shipment permission helper');
forbidText(helper,'hasPermission(','Shipment permission helper');

for(const token of [
  "from './_shipment-actions.js'",
  'loadShipmentActionCapabilityMap',
  'capabilities:capabilityBundle.map.get',
  "assertShipmentBusinessAction(shipment.id,'delete')",
  "assertShipmentBusinessAction(shipment.id,'release')",
  'assertShipmentBusinessAction(shipment.id,action)',
  "assertShipmentBusinessAction(shipment.id,assigningClient?'assign_client':'edit')"
])requireText(api,token,'Shipments API');
forbidText(api,'assertShipmentCanBeDeleted','Shipments API');

requireText(tracking,"from './_shipment-actions.js'",'Manual tracking API');
requireText(tracking,"assertShipmentBusinessAction(shipment.id,'manual_tracking')",'Manual tracking API');

requireText(loader,'window.shipmentWriteAccess = shipmentPayload ? shipmentPayload.write_access === true','Admin data loader');
requireText(loader,'shipment_write_access:window.shipmentWriteAccess === true','Admin data loader');

for(const token of [
  'function capability(shipment,key)',
  'function actionAllowed(shipment,key)',
  "['view_info','info','Información','']",
  "['assign_client','assign_client','Asignar cliente','orange']",
  "['manual_tracking','manual_update','Actualizar / corregir estado','']",
  "['release','release','Liberar','orange']",
  "['deliver','deliver','Entregado','success']",
  "['reactivate','reactivate','Reactivar','success']",
  "['delete','delete','Eliminar','danger']",
  'return defs.filter(([cap])=>actionAllowed(shipment,cap))',
  'register.hidden=!shipmentWriteAccess()',
  "if(!actionAllowed(shipment,'manual_tracking'))return",
  "if(!actionAllowed(shipment,'delete'))return"
])requireText(ui,token,'Containers UI');
for(const token of [
  "if(!shipment.client_id)actions.push",
  "if(!delivered)actions.push",
  "if(delivered)actions.push",
  "Boolean(shipment.released_at)||status.includes('liberad')"
])forbidText(ui,token,'Containers UI state inference');
if(/\b(?:prompt|alert|confirm)\s*\(/.test(ui))errors.push('Containers UI: no debe usar diálogos nativos en el flujo modernizado');
forbidText(ui,'openExpediente','Containers UI');
forbidText(ui,'expediente','Containers UI');

for(const token of [
  'begin;',
  'rollback;',
  'UX5_SHIPMENT_LINKED_DELETE_FORBIDDEN',
  'UX5_SHIPMENT_REPEAT_RELEASE_FORBIDDEN',
  'UX5_SHIPMENT_DELIVERED_TRACKING_FORBIDDEN',
  'UX5_SHIPMENT_REACTIVATE_EXPECTED',
  'shipment_fixture_residue',
  'load_fixture_residue'
])requireText(fixture,token,'Shipment reversible fixture');

if(errors.length){
  console.error('UX5 Shipment canonical actions check failed:');
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}
console.log('UX5 Shipment canonical actions check passed.');
