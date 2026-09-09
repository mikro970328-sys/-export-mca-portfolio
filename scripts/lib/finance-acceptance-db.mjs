import fs from 'node:fs';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { salesLogisticsAcceptanceMigrations } from './sales-logistics-acceptance-db.mjs';

const extra = [
  '20260828215000_b8_executive_kpi_sources.sql',
  '20260828215500_b8_executive_kpi_privilege_hardening.sql',
  '20260828220500_b8_executive_dashboard_rollup.sql',
  '20260830021003_ux2c_create_posted_cost_charge.sql',
  '20260830223000_p11_executive_dashboard_profitability.sql',
  '20260830225000_p12_executive_report_datasets.sql',
  '20260831160000_ux5_invoice_financial_action_capabilities.sql',
  '20260831160100_ux5_invoice_currency_precision.sql',
  '20260831223500_ux5_customer_finance_action_capabilities.sql',
  '20260901184000_ux6_cost_charge_action_capabilities.sql',
  '20260909185121_finance_cash_reconciliation.sql'
].map(file => `supabase/migrations/${file}`);

// Preserve the historical August 29 ordering established in the logistics slice.
export const financeAcceptanceMigrations = [...salesLogisticsAcceptanceMigrations];
for (const file of extra) {
  const i = financeAcceptanceMigrations.findIndex(existing => path.basename(existing) > path.basename(file));
  financeAcceptanceMigrations.splice(i < 0 ? financeAcceptanceMigrations.length : i, 0, file);
}

export async function createFinanceAcceptanceDb() {
  const db = new PGlite({ extensions:{ pgcrypto } });
  await db.waitReady;
  try {
    for (const file of ['supabase/tests/fixtures/purchase_acceptance_legacy.sql',
      'supabase/tests/fixtures/sales_logistics_acceptance_legacy.sql',
      'supabase/tests/fixtures/finance_acceptance_legacy.sql', ...financeAcceptanceMigrations]) {
      let sql = fs.readFileSync(file,'utf8');
      if (file.endsWith('20260830223000_p11_executive_dashboard_profitability.sql')) {
        // Execute the complete, unchanged financial view/RPC and their grants.
        // The trailing operational attention view belongs to tasks/alerts and is
        // outside this acceptance scope. Do not replace it with an empty mock.
        const marker = 'create or replace view public.executive_operational_attention';
        if (sql.split(marker).length !== 2) throw Error('Review P11 financial boundary');
        sql = sql.slice(0,sql.indexOf(marker));
      }
      try { await db.exec(sql); }
      catch (error) { throw new Error(`Finance migration ${file}: ${error.message}`); }
    }
    return db;
  } catch (error) { await db.close(); throw error; }
}
