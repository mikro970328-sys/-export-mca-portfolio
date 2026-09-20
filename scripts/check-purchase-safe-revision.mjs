import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration=fs.readFileSync('supabase/migrations/20260904105512_purchase_order_safe_revision.sql','utf8');
const api=fs.readFileSync('api/purchases.js','utf8');
const ui=fs.readFileSync('admin/purchases.js','utf8');
const supplyApi=fs.readFileSync('api/sales-supply.js','utf8');
const supplyUi=fs.readFileSync('admin/sales-supply-workspace.js','utf8');
const cancelMigration=fs.readFileSync('supabase/migrations/20260904113104_purchase_cancel_guard_direct_ship.sql','utf8');
const apCancelMigration=fs.readFileSync('supabase/migrations/20260904113928_purchase_cancel_preserve_ap_history.sql','utf8');

assert.match(migration,/v_edit_allowed:=v_po\.status in \('draft','issued','confirmed'\)/);
assert.match(migration,/v_po\.status='draft' then 'full' else 'protected'/);
assert.match(migration,/PO_CONFIRMED_STRUCTURE_LOCKED/);
assert.match(migration,/PO_QUANTITY_BELOW_COMMITTED/);
assert.match(migration,/PO_RECEIVED_MEASURE_LOCKED/);
assert.match(migration,/set_config\('export_mca\.po_revision_id',v_po\.id::text,true\)/);
assert.match(migration,/revoke all on function public\.replace_purchase_order_plan[\s\S]*?from public,anon,authenticated/);
assert.match(api,/id:text\(line\.id,80\)\|\|null/);
assert.match(ui,/div\.dataset\.itemId=seed\.id\|\|''/);
assert.match(ui,/supplier_locked/);
assert.match(ui,/destination_locked/);
assert.match(ui,/Puedes corregir cantidades, costos, fechas, referencia y notas/);
assert.match(supplyApi,/action==='quick_direct'/);
assert.match(supplyApi,/sales_supply_plan_lines[\s\S]*?sales_procurement_allocations/);
assert.match(supplyUi,/Paso 1 de 2 · Elegir compra/);
assert.match(supplyUi,/Paso 2 de 2 · Registrar contenedor nuevo/);
assert.match(ui,/data-cancel-order/);
assert.match(ui,/Cancelar compra/);
assert.match(cancelMigration,/v_has_direct_shipments/);
assert.match(cancelMigration,/PO_HAS_DIRECT_SHIPMENTS/);
assert.match(cancelMigration,/delete from public\.sales_procurement_allocations/);
assert.match(cancelMigration,/has_finance_links/);
assert.doesNotMatch(apCancelMigration,/PO_HAS_ACTIVE_AP/);
assert.match(apCancelMigration,/PO_HAS_ACTIVE_SALES_PROCUREMENT/);

console.log('Purchase safe revision contract: OK');
