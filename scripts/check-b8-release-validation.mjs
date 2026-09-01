import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const read = p => fs.readFileSync(p,'utf8');
const assert = (c,m) => { if(!c) throw new Error(m); };
const fixture = read('supabase/tests/b8_release_validation.sql');
const dashApi = read('api/dashboard.js');
const dashOwner = read('api/_executive-dashboard.js');
const reportApi = read('api/reports.js');
const reportUi = read('admin/reports.js');
const dashUi = read('admin/dashboard-operational-state.js');
const p11 = read('supabase/migrations/20260830223000_p11_executive_dashboard_profitability.sql');
const p12 = read('supabase/migrations/20260830225000_p12_executive_report_datasets.sql');

for (const file of ['api/dashboard.js','api/_executive-dashboard.js','api/reports.js','admin/reports.js','admin/dashboard-operational-state.js']) {
  const r=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  assert(r.status===0,`P13: sintaxis inválida en ${file}: ${r.stderr||r.stdout}`);
}

assert(/^\s*begin\s*;/im.test(fixture),'P13: fixture debe iniciar transacción');
assert(/^\s*rollback\s*;/im.test(fixture),'P13: fixture debe terminar con ROLLBACK');
assert(!/^\s*commit\s*;/im.test(fixture),'P13: fixture reversible no puede contener COMMIT');
for (const marker of ['P13-B8-EUR','P13-B8-GBP','EUR','GBP','executive_purchase_order_kpi_source','executive_dashboard_rollup','executive_report_dataset','currency_policy','separate_no_fx','fixture_residue']) {
  assert(fixture.includes(marker),`P13: fixture incompleta: ${marker}`);
}
assert(fixture.includes("v_eur<>125") && fixture.includes("v_gbp<>80"),'P13: fixture no valida importes deterministas EUR/GBP');
assert(fixture.includes("current_date-1,current_date") && fixture.includes("'EUR'"),'P13: fixture no valida período y moneda');

assert(dashApi.includes("authorizeAdmin(req,res,'dashboard.read')"),'P13: Dashboard perdió dashboard.read');
assert(reportApi.includes("authorizeAdmin(req,res,'reports.read')"),'P13: Reportes perdió reports.read');
assert(dashOwner.includes('rpc/executive_dashboard_rollup'),'P13: Dashboard no usa rollup B8');
assert(reportApi.includes('rpc/executive_report_dataset'),'P13: Reportes no usa dataset B8.4');
assert(p11.includes("'balance_basis', 'current_snapshot'"),'P13: AR/AP perdió semántica snapshot en backend');
assert(p12.includes("'currency_policy','separate_no_fx'"),'P13: Reportes perdió política no-FX');
assert(p12.includes("v_basis := 'current_snapshot'"),'P13: inventario no conserva snapshot actual');

for (const ui of [dashUi,reportUi]) {
  assert(!/cash_collected\s*[-+]\s*.*cash_paid|gross_margin\s*\/|contribution_margin\s*\//.test(ui),'P13: frontend contiene matemática financiera prohibida');
}
assert(dashUi.includes('Saldos de cuentas: <b>actuales</b>'),'P13: Dashboard no comunica saldos actuales');
assert(reportUi.includes('snapshot actual'),'P13: Reportes no etiqueta snapshot');
assert(dashUi.includes('Conversión de moneda: <b>no aplicada</b>') && dashUi.includes('Sin conversión de moneda'),'P13: Dashboard no declara política sin conversión');
assert(reportUi.includes('FX: no se aplica'),'P13: Reportes no declara no-FX');
assert(!dashUi.includes('public.executive_dashboard_rollup'),'P13: Dashboard expone nombre SQL interno');
assert(!/error\?\.message/.test(dashUi),'P13: Dashboard expone error técnico crudo');
assert(reportUi.includes('response.blob()') && reportUi.includes('Authorization:`Bearer ${token()}`'),'P13: CSV no conserva descarga autenticada');
assert(!/[?&]token=/.test(reportUi),'P13: frontend expone token en URL');

console.log('P13 B8.5 release validation gate: OK');
console.log('- Fixture es transaccional, determinista y termina en ROLLBACK.');
console.log('- Dashboard y Reportes conservan owners B8 y permisos separados.');
console.log('- Monedas permanecen separadas; no hay conversión ni matemática financiera en frontend.');
console.log('- Saldos actuales y CSV autenticado permanecen explícitos.');