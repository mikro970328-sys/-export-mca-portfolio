import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260901001500_ux5_supplier_ap_action_capabilities.sql');
const hardening=read('supabase/migrations/20260901002000_ux5_supplier_ap_view_privilege_hardening.sql');
const helper=read('api/_supplier-ap-actions.js');
const billsApi=read('api/payables.js');
const paymentsApi=read('api/supplier-payments.js');
const ui=read('admin/payables.js');
const fixture=read('supabase/tests/ux5_supplier_ap_actions.sql');
const errors=[];
const requireText=(source,needle,label)=>{if(!source.includes(needle))errors.push(`${label}: falta ${needle}`);};
const forbidText=(source,needle,label)=>{if(source.includes(needle))errors.push(`${label}: conserva ${needle}`);};

for(const token of [
  'function public.supplier_bill_action_state',
  'function public.assert_supplier_bill_action',
  'function public.supplier_payment_action_state',
  'function public.assert_supplier_payment_action',
  'view public.supplier_bill_action_capabilities',
  'view public.supplier_payment_action_capabilities',
  "'edit'", "'post'", "'void'", "'pay'", "'allocate'", "'reverse'",
  'SUPPLIER_BILL_HAS_ACTIVE_PAYMENTS',
  'SUPPLIER_BILL_ALREADY_PAID',
  'SUPPLIER_PAYMENT_ALREADY_REVERSED',
  'replace_supplier_bill_plan_canonical',
  'transition_supplier_bill_canonical',
  'pay_supplier_bill_canonical',
  'reverse_supplier_payment_canonical',
  'replace_supplier_payment_applications_canonical',
  'revoke execute on function public.replace_supplier_bill_plan',
  'revoke execute on function public.transition_supplier_bill',
  'revoke execute on function public.pay_supplier_bill',
  'revoke execute on function public.reverse_supplier_payment',
  'revoke execute on function public.replace_supplier_payment_applications',
  "set search_path to 'public','pg_temp'"
])requireText(migration,token,'DB supplier AP action owner');

for(const token of [
  'revoke all on public.supplier_bill_action_capabilities from service_role',
  'revoke all on public.supplier_payment_action_capabilities from service_role',
  'grant select on public.supplier_bill_action_capabilities to service_role',
  'grant select on public.supplier_payment_action_capabilities to service_role'
])requireText(hardening,token,'Supplier AP capability view hardening');

for(const token of [
  "from './_invoice-actions.js'",
  'loadFinanceWriteAccess',
  'supplier_bill_action_capabilities',
  'supplier_payment_action_capabilities',
  "entry.required_permission='finance.write'",
  "entry.reason='PERMISSION_REQUIRED'"
])requireText(helper,token,'Supplier AP permission helper');
forbidText(helper,'hasPermission(','Supplier AP permission helper');

for(const token of [
  "from './_supplier-ap-actions.js'",
  'loadSupplierApCapabilityMaps',
  'capabilities:capabilityMap.get',
  "rpc/replace_supplier_bill_plan_canonical",
  "rpc/transition_supplier_bill_canonical",
  'write_access:capabilities.write_access'
])requireText(billsApi,token,'Payables API');
forbidText(billsApi,"rpc/replace_supplier_bill_plan'",'Payables API legacy mutation');
forbidText(billsApi,"rpc/transition_supplier_bill'",'Payables API legacy mutation');

for(const token of [
  "from './_supplier-ap-actions.js'",
  'loadSupplierApCapabilityMaps',
  'capabilities:capabilityMap.get',
  "rpc/pay_supplier_bill_canonical",
  "rpc/reverse_supplier_payment_canonical",
  "rpc/replace_supplier_payment_applications_canonical",
  'write_access:capabilities.write_access'
])requireText(paymentsApi,token,'Supplier payments API');
forbidText(paymentsApi,"rpc/pay_supplier_bill'",'Supplier payments API legacy mutation');
forbidText(paymentsApi,"rpc/reverse_supplier_payment'",'Supplier payments API legacy mutation');
forbidText(paymentsApi,"rpc/replace_supplier_payment_applications'",'Supplier payments API legacy mutation');

for(const token of [
  "const actionAllowed = (row,action) => row?.capabilities?.actions?.[action]?.allowed === true",
  "actionAllowed(bill,'edit')",
  "actionAllowed(bill,'post')",
  "actionAllowed(bill,'void')",
  "actionAllowed(payment,'allocate')",
  "actionAllowed(payment,'reverse')",
  'state.writeAccess = ap.write_access === true && payments.write_access === true'
])requireText(ui,token,'Payables UI');
for(const token of [
  "if (bill.status === 'draft') actions.push",
  "if (bill.status === 'draft' || bill.status === 'posted') actions.push",
  "if (payment.status === 'posted') actions.push",
  "if (!bill || bill.status!=='draft') return",
  "if (!payment || payment.status!=='posted') return"
])forbidText(ui,token,'Payables UI action-state inference');

for(const token of [
  "actionAllowed(bill,'pay')",
  "if(mode==='direct'&&(!bill||!actionAllowed(bill,'pay')))return",
  "if(state.paymentMode==='direct'&&(!bill||!actionAllowed(bill,'pay')))return",
  "body.action='pay_bill'",
  'state.advancePurchaseOrders = Array.isArray(payments.advance_purchase_orders)'
])requireText(ui,token,'Payables direct-payment owner');
forbidText(ui,"bill.status === 'posted' && billBalance",'Payables direct-payment action-state inference');

for(const source of [ui]){
  if(/\b(?:prompt|alert|confirm)\s*\(/.test(source))errors.push('Payables UI: no debe usar diálogos nativos en el flujo modernizado');
  if(/expediente/i.test(source))errors.push('Payables UI: no debe reintroducir Expedientes');
}
if(fs.existsSync('admin/payables-payment-ux.js'))errors.push('Payables UI: el decorador payables-payment-ux.js debe permanecer retirado');

for(const token of [
  'begin;',
  'rollback;',
  'UX5_AP_POST_WITHOUT_INVOICE_FORBIDDEN',
  'UX5_AP_VOID_WITH_ACTIVE_PAYMENT_FORBIDDEN',
  'UX5_AP_REVERSED_ALLOCATE_FORBIDDEN',
  'UX5_AP_REPEAT_REVERSE_FORBIDDEN',
  'purchase_order_fixture_residue',
  'purchase_item_fixture_residue',
  'supplier_bill_fixture_residue',
  'supplier_bill_item_fixture_residue',
  'supplier_payment_fixture_residue',
  'supplier_application_fixture_residue'
])requireText(fixture,token,'Supplier AP reversible fixture');

if(errors.length){
  console.error('UX5 Supplier AP canonical actions check failed:');
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}
console.log('UX5 Supplier AP canonical actions check passed.');
