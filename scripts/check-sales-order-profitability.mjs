import fs from 'node:fs';

const failures=[];
const read=file=>fs.readFileSync(file,'utf8');
const api=read('api/sales-workspace.js');
const ui=read('admin/sales-workspace.js');
const costs=read('api/costs.js');
const requireText=(label,source,text)=>{if(!source.includes(text))failures.push(`${label}: falta ${text}`);};
const forbid=(label,source,re,msg)=>{if(re.test(source))failures.push(`${label}: ${msg}`);};

for(const field of [
  'attributed_sales_revenue','cogs_currency','recognized_merchandise_cogs','merchandise_cost_coverage',
  'gross_margin','gross_margin_pct','profitability_status','direct_cost_currency_count','direct_cost_currency',
  'direct_cost_charge_count','direct_cost_amount','contribution_margin','contribution_margin_pct','contribution_status'
]) requireText('backend financial redaction',api,`'${field}'`);
for(const text of [
  "hasPermission(admin,'finance.read')",
  "hasPermission(admin,'finance.write')",
  'financialSummary(authoritativeSummary,financeReadable)',
  'financial_access:{read:financeReadable,write:financeWritable}',
  '!financeReadable?Promise.resolve([])',
  'costs:{allocations:financeReadable?directCosts:[]}'
]) requireText('backend permission contract',api,text);
requireText('sales access remains available',api,"authorizeAdmin(req,res,'sales.read')");

for(const text of [
  'function financialReadable(){return state.data?.financial_access?.read===true;}',
  'function financialWritable(){return state.data?.financial_access?.write===true;}',
  "key!=='costs'||financialReadable()",
  "financialReadable()?`${kpi('Costo mercancía'",
  'COGS, gastos directos y márgenes requieren permiso de Finanzas.',
  "financialWritable()?'<button class=\"btn orange\" data-ws-action=\"new_cost\">+ Agregar gasto</button>':''",
  "if(action==='new_cost'){if(!financialWritable())throw new Error('No tienes permiso para registrar gastos.')",
  "function openCostModal(){if(!financialWritable())throw new Error('No tienes permiso para registrar gastos.')",
  "async function saveCost(){if(!financialWritable())throw new Error('No tienes permiso para registrar gastos.')"
]) requireText('frontend permission contract',ui,text);

requireText('canonical finance write owner',costs,"authorizeAdmin(req, res, req.method === 'GET' ? 'finance.read' : 'finance.write')");
requireText('canonical posted cost owner',costs,"'rpc/create_posted_cost_charge'");

// The UI may format backend values but must never derive profitability itself.
forbid('frontend profitability owner',ui,/\b(?:gross_margin|contribution_margin|recognized_merchandise_cogs)\s*=/,'no debe asignar/calcular métricas B6');
forbid('frontend FX',ui,/exchange[_ -]?rate|fx[_ -]?rate|currency[_ -]?conversion/i,'no debe introducir FX/conversión');
forbid('backend arbitrary proration',api,/prorat|prorrat/i,'no debe introducir prorrateo nuevo');

if(failures.length){console.error('UX4 profitability check failed:\n'+failures.map(x=>`- ${x}`).join('\n'));process.exit(1);}
console.log('UX4 sales-order profitability permission contract passed.');
