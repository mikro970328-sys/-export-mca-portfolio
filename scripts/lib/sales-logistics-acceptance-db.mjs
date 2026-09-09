import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { purchaseAcceptanceMigrations } from './purchase-acceptance-db.mjs';

// Same purchase/stock foundation plus the real sales/logistics dependency slice.
// Files are executed unchanged. Legacy fixtures supply table shape, not rules.
const extraMigrations = [
  '20260819143000_a4_load_tracking_creation.sql',
  '20260819145000_a4_load_shipment_guards.sql',
  '20260819152000_a5_load_expedientes.sql',
  '20260819160000_a6_load_traceability.sql',
  '20260819180000_load_ui_transaction_contract.sql',
  '20260821233000_b3_sales_load_linking.sql',
  '20260822113000_b3_create_load_from_sales_order.sql',
  '20260822114500_b3_load_plan_positive_insert.sql',
  '20260822115500_b3_internalize_load_item_helper.sql',
  '20260822121000_b4_invoice_core.sql',
  '20260822122000_b4_invoice_progress_semantics.sql',
  '20260822122500_b4_invoice_backend_only.sql',
  '20260822124000_b4_invoice_payment_operations.sql',
  '20260824141801_b6_cost_core.sql',
  '20260827215033_b6_cost_core_hardening.sql',
  '20260827215146_b6_cost_core_privilege_hardening.sql',
  '20260828012246_b6_cost_operations.sql',
  '20260828013350_b6_cogs_propagation.sql',
  '20260828133335_b6_profitability_traceability.sql',
  '20260828134203_b6_profitability_traceability_hardening.sql',
  '20260828134635_b6_profitability_privilege_hardening.sql',
  '20260828205000_b7_generated_document_metadata.sql',
  '20260828210600_b7_invoice_operation_integrity.sql',
  '20260828210800_b7_invoice_issue_requires_operation.sql',
  '20260829232000_sales_order_exact_total.sql',
  '20260829_allow_load_shipment_link_until_dispatch.sql',
  '20260829_flexible_load_container_reference.sql',
  '20260829_loads_optional_container_until_dispatch.sql',
  '20260830014049_ux2a_sales_direct_cost_targets.sql',
  '20260830015022_ux2b_sales_workspace_read_models.sql',
  '20260830031800_ux2d_container_customs_document_readiness.sql',
  '20260830043800_harden_shipment_customs_readiness_view.sql',
  '20260830053000_p1_direct_shipment_dispatch_lifecycle.sql',
  '20260830054000_p2_customer_advances_proformas.sql',
  '20260830054800_p2_customer_financial_integrity.sql',
  '20260830183000_p7_cuba_document_version_lifecycle.sql',
  '20260830183500_p7_cuba_document_version_rpc_fix.sql',
  '20260831133000_ux5_sales_order_action_capabilities.sql',
  '20260831233000_ux5_load_action_capabilities.sql',
  '20260909175528_load_plan_container_consistency.sql'
];

// These historical migrations live outside supabase/migrations and precede P1.
const august29 = [
  'migrations/20260829_link_existing_load_to_sales_order.sql',
  'migrations/20260829_sales_load_context_tracking.sql',
  'migrations/20260829_sync_load_shipment_merchandise.sql'
];
export const salesLogisticsAcceptanceMigrations = [...new Set([...purchaseAcceptanceMigrations, ...extraMigrations])]
  .sort()
  .flatMap(file => file === '20260830014049_ux2a_sales_direct_cost_targets.sql'
    ? [...august29, `supabase/migrations/${file}`] : [`supabase/migrations/${file}`]);

export async function createSalesLogisticsAcceptanceDb() {
  const db = new PGlite({ extensions:{ pgcrypto } });
  await db.waitReady;
  try {
    for (const file of ['supabase/tests/fixtures/purchase_acceptance_legacy.sql',
      'supabase/tests/fixtures/sales_logistics_acceptance_legacy.sql', ...salesLogisticsAcceptanceMigrations]) {
      try { await db.exec(fs.readFileSync(file, 'utf8')); }
      catch (error) { throw new Error(`Acceptance migration ${file}: ${error.message}`); }
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}
