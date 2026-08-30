import fs from 'node:fs';

const read = path => fs.readFileSync(path, 'utf8');
const requireText = (source, needle, label) => {
  if (!source.includes(needle)) throw new Error(`${label}: falta ${needle}`);
};
const forbidText = (source, needle, label) => {
  if (source.includes(needle)) throw new Error(`${label}: no se permite ${needle}`);
};

const salesHtml = read('admin/sales.html');
const ui = read('admin/sales-customer-finance.js');
const advancesApi = read('api/customer-advances.js');
const proformasApi = read('api/proformas.js');
const foundation = read('supabase/migrations/20260830054000_p2_customer_advances_proformas.sql');
const integrity = read('supabase/migrations/20260830054800_p2_customer_financial_integrity.sql');

for (const needle of [
  '/admin/sales-customer-finance.css',
  'id="openCustomerFinance"',
  '/admin/sales-customer-finance.js'
]) requireText(salesHtml, needle, 'sales.html');

for (const forbidden of ['prompt(', 'confirm(', 'alert(', 'MutationObserver']) {
  forbidText(ui, forbidden, 'sales-customer-finance.js');
}
for (const needle of [
  '/api/customer-advances',
  '/api/proformas',
  'advance_cash_received',
  'advance_available_amount',
  'cash_received_net',
  'advance_applied_amount',
  "paid:'Pagada'",
  "partial:'Pago parcial'",
  "overdue:'Vencida'",
  "activeWorkspaceTab() !== 'billing'",
  'row.client?.company',
  'row.importer?.legal_name'
]) requireText(ui, needle, 'sales-customer-finance.js');

for (const needle of [
  "supabase('sales_order_customer_financial_progress'",
  "supabase('customer_advance_progress'",
  "supabase('invoice_financial_progress'",
  "rpc/register_customer_advance",
  "rpc/apply_customer_advance",
  "rpc/refund_customer_advance",
  "rpc/reverse_customer_advance",
  "rpc/reverse_customer_advance_application",
  "rpc/reverse_customer_advance_refund"
]) requireText(advancesApi, needle, 'customer-advances.js');
for (const forbidden of [
  "supabase('payments',{method:'POST'",
  "supabase('payments', { method:'POST'"
]) forbidText(advancesApi, forbidden, 'customer-advances.js');

for (const needle of [
  "supabase('proformas'",
  "supabase('proforma_financial_totals'",
  "supabase('proforma_items'",
  'client:clients(',
  'importer:importers(',
  "rpc/create_proforma",
  "rpc/transition_proforma"
]) requireText(proformasApi, needle, 'proformas.js');
for (const forbidden of ["rpc/create_invoice_plan", "supabase('invoices'"]) {
  forbidText(proformasApi, forbidden, 'proformas.js');
}

for (const needle of [
  'create table if not exists public.customer_advances',
  'create table if not exists public.customer_advance_applications',
  'create table if not exists public.customer_advance_refunds',
  'create table if not exists public.proformas',
  'create table if not exists public.proforma_items',
  'CUSTOMER_ADVANCE_APPLICATION_CONTEXT_MISMATCH',
  'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_AVAILABLE',
  'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE',
  'CUSTOMER_ADVANCE_REFUND_EXCEEDS_AVAILABLE',
  'create or replace view public.customer_advance_progress',
  'create or replace view public.sales_order_customer_financial_progress',
  'create or replace view public.proforma_financial_totals',
  'security_invoker=true'
]) requireText(foundation.toLowerCase(), needle.toLowerCase(), 'P2 foundation migration');

for (const needle of [
  'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE',
  'INVOICE_HAS_ACTIVE_ADVANCE_APPLICATIONS',
  'SO_HAS_ACTIVE_CUSTOMER_ADVANCES'
]) requireText(integrity, needle, 'P2 integrity migration');

console.log('P2 customer advances/proformas ownership and integrity checks passed.');
