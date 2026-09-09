import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

// Execute the real migration files, unchanged, on an empty database. The legacy
// fixture supplies external master tables only, never purchase/inventory rules.
export const purchaseAcceptanceMigrations = [
  '20260818014507_f1_warehouses_products_receipts.sql',
  '20260818125215_f2_inventory_ledger.sql',
  '20260818130716_f2_inventory_source_balance_view.sql',
  '20260819020312_f2_inventory_traceability.sql',
  '20260819121000_a1_loads_core.sql',
  '20260819130000_a2_load_reservations.sql',
  '20260819135000_a3_load_container_lifecycle.sql',
  '20260819203000_fix_quantity_units.sql',
  '20260819204500_normalize_pallet_allocations.sql',
  '20260820143000_b2_supplier_master_integrity.sql',
  '20260820153000_b2_purchase_orders_core.sql',
  '20260820162000_b2_purchase_receiving.sql',
  '20260821220000_b3_sales_orders_core.sql',
  '20260822001000_b3_sales_order_operations.sql',
  '20260822142500_b5_supplier_bills_core.sql',
  '20260822150000_b5_ap_operations.sql',
  '20260828225500_ap_direct_supplier_bill_payment.sql',
  '20260828231800_supplier_bill_total_entry.sql',
  '20260830043500_p1_supply_fulfillment_foundation.sql',
  '20260830044200_p1_supply_integrity_hardening.sql',
  '20260831122500_ux5_purchase_order_action_capabilities.sql',
  '20260831122600_ux5_purchase_order_edit_assertion.sql',
  '20260901001500_ux5_supplier_ap_action_capabilities.sql',
  '20260901002000_ux5_supplier_ap_view_privilege_hardening.sql',
  '20260901004000_ux5_warehouse_receipt_action_capabilities.sql',
  '20260904011201_purchase_line_total_measurement_consistency.sql',
  '20260904013221_purchase_direct_ship_no_wr.sql',
  '20260904013835_purchase_destination_supply_consistency.sql',
  '20260904105512_purchase_order_safe_revision.sql',
  '20260904113104_purchase_cancel_guard_direct_ship.sql',
  '20260904113928_purchase_cancel_preserve_ap_history.sql'
];

export async function createPurchaseAcceptanceDb() {
  const db = new PGlite({ extensions:{ pgcrypto } });
  await db.waitReady;
  try {
    await db.exec(fs.readFileSync('supabase/tests/fixtures/purchase_acceptance_legacy.sql','utf8'));
    for (const file of purchaseAcceptanceMigrations) {
      try {
        await db.exec(fs.readFileSync(`supabase/migrations/${file}`,'utf8'));
      } catch (error) {
        throw new Error(`Acceptance migration ${file}: ${error.message}`, { cause:error });
      }
    }
    return db;
  } catch (error) {
    await db.close();
    throw error;
  }
}
