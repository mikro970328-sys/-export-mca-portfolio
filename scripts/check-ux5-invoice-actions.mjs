import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const migration=read('supabase/migrations/20260831160000_ux5_invoice_financial_action_capabilities.sql');
const helper=read('api/_invoice-actions.js');
const invoicesApi=read('api/invoices.js');
const paymentsApi=read('api/invoice-payments.js');
const ui=read('admin/invoices.js');
const html=read('admin/invoices.html');
const fixture=read('supabase/tests/ux5_invoice_actions.sql');
const errors=[];
const requireText=(source,needle,label)=>{if(!source.includes(needle))errors.push(`${label}: falta ${needle}`);};
const forbidText=(source,needle,label)=>{if(source.includes(needle))errors.push(`${label}: conserva ${needle}`);};

for(const token of [
  'function public.invoice_action_state',
  'function public.assert_invoice_action',
  'function public.payment_action_state',
  'function public.assert_payment_action',
  'view public.invoice_action_capabilities',
  'view public.payment_action_capabilities',
  "perform public.assert_invoice_action(v_invoice.id,'edit')",
  'perform public.assert_invoice_action(v_invoice.id,v_action)',
  "perform public.assert_invoice_action(p_invoice_id,'record_payment')",
  "perform public.assert_payment_action(v_payment.id,'reverse')",
  'INVOICE_HAS_POSTED_PAYMENTS',
  'INVOICE_HAS_POSTED_ADVANCE_APPLICATIONS',
  'PAYMENT_INVOICE_ALREADY_SETTLED',
  'grant select on public.invoice_action_capabilities to service_role',
  'grant select on public.payment_action_capabilities to service_role'
])requireText(migration,token,'DB canonical owner');

requireText(helper,'loadAdminAccessContext','Finance permission helper');
requireText(helper,"includes('finance.write')",'Finance permission helper');
requireText(helper,'loadInvoiceFinanceCapabilityMaps','Finance permission helper');
requireText(helper,"entry.required_permission='finance.write'",'Finance permission helper');
forbidText(helper,'hasPermission(','Finance permission helper');

requireText(invoicesApi,"from './_invoice-actions.js'",'Invoices API');
requireText(invoicesApi,'loadInvoiceFinanceCapabilityMaps','Invoices API');
requireText(invoicesApi,'capabilities:capabilityBundle.invoice_capabilities.get','Invoices API');
requireText(invoicesApi,'capabilities:capabilityBundle.payment_capabilities.get','Invoices API');
requireText(invoicesApi,'write_access:invoiceData.write_access','Invoices API');

requireText(ui,'const capability=(entity,key)','Invoices UI');
requireText(ui,'const can=(entity,key)','Invoices UI');
requireText(ui,'const canPayment=(payment,key)','Invoices UI');
for(const token of ["can(invoice,'record_payment')","can(invoice,'edit')","can(invoice,'issue')","can(invoice,'void')","canPayment(payment,'reverse')","$('newInvoice').hidden=!state.writeAccess"]){requireText(ui,token,'Invoices UI');}
forbidText(ui,"invoice.status==='issued'&&num(f.balance_due)>0",'Invoices UI');
forbidText(ui,"if(invoice.status==='draft')actions.push",'Invoices UI');
forbidText(ui,"if(invoice.status==='draft'||invoice.status==='issued')",'Invoices UI');
if(/\b(?:prompt|alert|confirm)\s*\(/.test(ui))errors.push('Invoices UI: no debe usar diálogos nativos en el flujo modernizado');
if(/MutationObserver/.test(ui))errors.push('Invoices UI: no debe usar MutationObserver');
requireText(html,'id="decisionModal"','Invoices decision UI');
requireText(html,'id="decisionReason"','Invoices decision UI');

for(const token of [
  'begin;',
  'rollback;',
  'UX5_INVOICE_DRAFT_ISSUE_EXPECTED',
  'UX5_INVOICE_ISSUED_PAYMENT_EXPECTED',
  'UX5_INVOICE_VOID_WITH_PAYMENT_FORBIDDEN',
  'UX5_PAYMENT_REVERSE_EXPECTED',
  'UX5_INVOICE_PAID_PAYMENT_MUST_DISAPPEAR',
  'invoice_fixture_residue',
  'invoice_item_fixture_residue',
  'payment_fixture_residue'
])requireText(fixture,token,'Invoice reversible fixture');

requireText(paymentsApi,"supabase('rpc/register_invoice_payment'",'Payments API');
requireText(paymentsApi,"supabase('rpc/reverse_invoice_payment'",'Payments API');

if(errors.length){
  console.error('UX5 Invoice canonical actions check failed:');
  for(const error of errors)console.error(`- ${error}`);
  process.exit(1);
}
console.log('UX5 Invoice canonical actions check passed.');
