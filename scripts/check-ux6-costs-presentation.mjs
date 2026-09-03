import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const migration=read('supabase/migrations/20260901184000_ux6_cost_charge_action_capabilities.sql');
const fixture=read('supabase/tests/ux6_cost_charge_actions.sql');
const helper=read('api/_cost-actions.js');
const api=read('api/costs.js');
const profitabilityApi=read('api/profitability.js');
const ui=read('admin/costs.js');
const css=read('admin/costs.css');
const html=read('admin/costs.html');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

for(const text of [
  'function public.cost_charge_action_state',
  'function public.assert_cost_charge_action',
  'view public.cost_charge_action_capabilities',
  'replace_cost_charge_canonical',
  'post_cost_charge_canonical',
  'void_cost_charge_canonical',
  "'edit'", "'post'", "'void'",
  'COST_CHARGE_HAS_NO_ALLOCATIONS',
  'COST_CHARGE_NOT_FULLY_ALLOCATED',
  'COST_CHARGE_CANNOT_VOID',
  'revoke execute on function public.replace_cost_charge',
  'revoke execute on function public.post_cost_charge',
  'revoke execute on function public.void_cost_charge',
  "set search_path to 'public','pg_temp'",
  'grant select on public.cost_charge_action_capabilities to service_role'
]) requireText(migration,text,`owner DB ${text}`);

for(const text of [
  "from './_invoice-actions.js'",
  'loadFinanceWriteAccess',
  'cost_charge_action_capabilities',
  "entry.required_permission='finance.write'",
  "entry.reason='PERMISSION_REQUIRED'",
  'loadCostChargeCapabilityMap'
]) requireText(helper,text,`overlay de permisos ${text}`);
forbid(helper,/\bhasPermission\s*\(/,'Costos no puede reintroducir un helper ficticio de permisos');

for(const text of [
  "from './_cost-actions.js'",
  'loadCostChargeCapabilityMap(admin)',
  'capabilities:capabilityBundle.map.get',
  'write_access:capabilityBundle.write_access',
  "'rpc/replace_cost_charge_canonical'",
  "'rpc/post_cost_charge_canonical'",
  "'rpc/void_cost_charge_canonical'",
  "supabase('shipments', { query:'?select=id,container_number,operation_id&order=id.desc&limit=3000' })",
  'COST_ERROR_TRANSLATIONS',
  'SAFE_COST_INPUT_PATTERNS',
  "code:'COST_UNEXPECTED_ERROR'",
  "message:'No se pudo procesar Costos. Intenta nuevamente.'",
  'fail(res, failure.status, failure.message, { code:failure.code })'
]) requireText(api,text,`backend seguro ${text}`);
forbid(api,/['"]rpc\/(?:replace_cost_charge|post_cost_charge|void_cost_charge)['"]/,'Costos API no puede invocar mutaciones legacy');
forbid(api,/supabase\('shipments',\s*\{\s*query:'\?select=[^']*\bstatus\b[^']*'\s*\}\)/,'Costos API no puede consultar shipments.status porque esa columna no existe');
forbid(api,/return fail\(res,\s*(?:400|500),\s*raw/,'Costos API no puede devolver errores internos crudos');

for(const text of [
  "const actionAllowed = (charge, action) => charge?.capabilities?.actions?.[action]?.allowed === true",
  "actionAllowed(charge, 'edit')",
  "actionAllowed(charge, 'post')",
  "actionAllowed(charge, 'void')",
  'state.writeAccess = data.write_access === true',
  'function safeCostMessage(error, fallback =',
  'function costDecision({ title, copy, accept =',
  'function closeCostDecision(accepted = false)',
  'COSTS_UI_FAILED',
  'function reportCostError(',
  'COSTS_REFRESH_FAILED',
  'COSTS_INITIAL_LOAD_FAILED',
  "owner: 'costs.js'",
  'function startCosts(',
  'function handleStoredSession('
]) requireText(ui,text,`owner de presentación ${text}`);
forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Costos no puede usar diálogos nativos');
forbid(ui,/(?:innerHTML|textContent)\s*=.*error(?:\?\.)?\.message/,'Costos no puede mostrar error.message crudo');
forbid(ui,/if\s*\(charge\.status\s*(?:===|!==)/,'Costos no puede inferir acciones desde status');
forbid(ui,/\bexpediente(?:s)?\b/i,'Costos no puede reintroducir Expedientes');

for(const text of [
  'SAFE_PROFIT_ERROR_PATTERNS',
  'safeProfitabilityMessage(error)',
  'PROFITABILITY_LOAD_FAILED',
  'Rentabilidad calculada por el ERP.',
  'Órdenes de venta',
  'Costo de mercancía',
  'Cobertura'
]) requireText(ui,text,`Rentabilidad segura ${text}`);
forbid(ui,/(?:innerHTML|textContent)\s*=.*error(?:\?\.)?\.message/,'Rentabilidad no puede mostrar error.message crudo');
forbid(ui,/Cost Charges|PostgreSQL|Warehouse Receipt|Purchase Order|Supplier Bill posted|\bCoverage\b|\bCOGS\b|\bFX\b/,'Rentabilidad no puede exponer terminología de implementación');
requireText(profitabilityApi,"return fail(res, 500, 'No se pudo cargar la rentabilidad')",'fallback seguro de API Rentabilidad');

for(const text of [
  'id="pageMsg"',
  'id="costDecisionModal"',
  'role="dialog"',
  'aria-modal="true"',
  'id="costDecisionCancel"',
  'id="costDecisionAccept"',
  '<body class="erp-module-page erp-module-costs" data-owner="costs.js">',
  '/admin/costs.css?v=20260903-ux7costs1',
  '/admin/costs.js?v=20260903-ux7costs1',
  '/admin/embedded-auto-refresh.js?v=20260903-ux7costs1'
]) requireText(html,text,`HTML ${text}`);

for(const text of ['.cost-decision-dialog','.cost-decision-actions','.costs-feedback','.profit-sub-spaced','.profit-grid','@media(max-width:720px)']) requireText(css,text,`CSS ${text}`);
forbid(css,/@import|purchases\.css/i,'Costos conserva dependencia visual de Compras');
if(fs.existsSync('admin/profitability.js')||fs.existsSync('admin/profitability.css'))failures.push('los owners visuales paralelos de Rentabilidad deben permanecer retirados');

for(const text of [
  'begin;',
  'rollback;',
  'UX6_COST_EMPTY_POST_FORBIDDEN',
  'UX6_COST_PARTIAL_POST_FORBIDDEN',
  'UX6_COST_ALLOCATED_POST_EXPECTED',
  'UX6_COST_POSTED_VOID_EXPECTED',
  'UX6_COST_REPEAT_VOID_FORBIDDEN',
  'cost_charge_fixture_residue',
  'cost_allocation_fixture_residue'
]) requireText(fixture,text,`fixture reversible ${text}`);

if(failures.length){
  console.error('UX6 Costs presentation gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Costs presentation gate passed.');
