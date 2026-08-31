import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260831223500_ux5_customer_finance_action_capabilities.sql');
const helper=read('api/_customer-finance-actions.js');
const advances=read('api/customer-advances.js');
const proformas=read('api/proformas.js');
const ui=read('admin/sales-customer-finance.js');
const test=read('supabase/tests/ux5_customer_finance_actions.sql');
const errors=[];
const need=(ok,message)=>{if(!ok)errors.push(message);};

for(const name of [
  'sales_order_customer_finance_action_state','assert_sales_order_customer_finance_action',
  'proforma_action_state','assert_proforma_action','customer_advance_action_state','assert_customer_advance_action',
  'customer_advance_application_action_state','assert_customer_advance_application_action',
  'customer_advance_refund_action_state','assert_customer_advance_refund_action'
]) need(migration.includes(`function public.${name}`),`migration: falta ${name}`);

for(const view of [
  'sales_order_customer_finance_action_capabilities','proforma_action_capabilities','customer_advance_action_capabilities',
  'customer_advance_application_action_capabilities','customer_advance_refund_action_capabilities'
]){
  need(migration.includes(`view public.${view} with (security_invoker=true)`),`migration: ${view} debe usar security_invoker`);
  need(migration.includes(`grant select on public.${view} to service_role`),`migration: falta grant service_role de ${view}`);
}

const rpcOwners=[
  ['create_proforma','assert_sales_order_customer_finance_action'],['transition_proforma','assert_proforma_action'],
  ['register_customer_advance','assert_sales_order_customer_finance_action'],['apply_customer_advance','assert_customer_advance_action'],
  ['refund_customer_advance','assert_customer_advance_action'],['reverse_customer_advance','assert_customer_advance_action'],
  ['reverse_customer_advance_application','assert_customer_advance_application_action'],['reverse_customer_advance_refund','assert_customer_advance_refund_action']
];
for(const [rpc,owner] of rpcOwners){
  const start=migration.indexOf(`function public.${rpc}`);
  const next=migration.indexOf('\ncreate or replace function public.',start+20);
  const body=migration.slice(start,next<0?migration.length:next);
  need(start>=0&&body.includes(`public.${owner}`),`migration: ${rpc} no revalida ${owner}`);
  need(body.includes("search_path to 'public','pg_temp'"),`migration: ${rpc} sin search_path endurecido`);
}

need(helper.includes('loadAdminAccessContext'),'helper: debe releer permisos P3 desde DB');
need(helper.includes("'sales.write'")&&helper.includes("'finance.write'"),'helper: faltan permisos sales.write/finance.write');
need(advances.includes("from './_customer-finance-actions.js'"),'customer-advances API: falta capability loader');
need(proformas.includes("from './_customer-finance-actions.js'"),'proformas API: falta capability loader');
need(advances.includes('sales_order_capabilities')&&advances.includes('capabilities:capabilityBundle.advance_capabilities'),'customer-advances API: faltan capabilities en read model');
need(proformas.includes('sales_order_capabilities')&&proformas.includes('capabilities:capabilityBundle.proforma_capabilities'),'proformas API: faltan capabilities en read model');

need(ui.includes("canSalesOrder('register_advance')"),'UI: registrar anticipo no depende de capability');
need(ui.includes("canSalesOrder('create_proforma')"),'UI: crear proforma no depende de capability');
for(const action of ['apply','refund','reverse','issue','void'])need(ui.includes(`can(row,'${action}')`),`UI: falta capability ${action}`);
need(!ui.includes("const active = row.status === 'posted'"),'UI: conserva inferencia legacy de anticipo activo');
need(!ui.includes("active && Number(row.available_amount) > 0"),'UI: conserva inferencia legacy por saldo');
need(!ui.includes("row.status === 'draft' ? `<button class=\"btn orange\" data-cf-issue-proforma"),'UI: conserva inferencia legacy para emitir proforma');
need(!ui.includes("['draft','issued'].includes(row.status) ? `<button class=\"btn\" data-cf-void-proforma"),'UI: conserva inferencia legacy para anular proforma');
need(!/\b(?:prompt|alert|confirm)\s*\(/.test(ui),'UI: no se permiten diálogos nativos nuevos');

need(test.includes('begin;')&&test.includes('rollback;'),'DB test: debe ser reversible');
for(const residue of ['proforma_fixture_residue','advance_fixture_residue','invoice_fixture_residue','application_fixture_residue','refund_fixture_residue'])need(test.includes(residue),`DB test: falta ${residue}`);

if(errors.length){console.error('UX5 customer finance actions check failed:\n- '+errors.join('\n- '));process.exit(1);}
console.log('UX5 customer finance canonical action ownership: OK');
