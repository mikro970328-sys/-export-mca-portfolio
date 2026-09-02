import fs from 'node:fs';
import vm from 'node:vm';

const read = path => fs.readFileSync(path, 'utf8');
const dashboardPath = 'admin/dashboard-operational-state.js';
const erpPath = 'admin/erp.js';
const compensatorPath = 'admin/dashboard-alert-cleanup.js';

const dashboard = read(dashboardPath);
const erp = read(erpPath);

const fail = message => {
  console.error(`UX6 dashboard presentation gate failed: ${message}`);
  process.exitCode = 1;
};

const forbiddenVisibleTokens = [
  'snapshot actual',
  'Sin conversión FX',
  'Calculado por backend',
  'cash posted',
  'public.executive_dashboard_rollup',
  'Routing incompatible'
];

for (const token of forbiddenVisibleTokens) {
  if (dashboard.includes(token)) fail(`technical implementation copy remains: ${token}`);
}

if (/renderError\s*\(\s*error\s*\)/.test(dashboard)) fail('renderError still receives the raw error object');
if (/\$\{\s*(?:esc\()?error\?\.message/.test(dashboard)) fail('raw error.message is still rendered into the dashboard');
if (!dashboard.includes("console.error('[executive dashboard]',error)")) fail('technical dashboard errors must remain in diagnostics');
if (!dashboard.includes('No pudimos actualizar los indicadores en este momento.')) fail('dashboard needs a stable operational error message');
if (!dashboard.includes('Datos financieros consolidados por la plataforma.')) fail('dashboard footer must use operational provenance copy');
if (!dashboard.includes('Cobros contabilizados menos pagos contabilizados')) fail('net cash-flow explanation must be operational');
if (!dashboard.includes('Sin conversión de moneda')) fail('currency presentation must be understandable without FX jargon');
if (!dashboard.includes('Cuentas por cobrar') || !dashboard.includes('Cuentas por pagar')) fail('finance labels must use operational Spanish');
if (/\b(?:prompt|alert|confirm)\s*\(/.test(dashboard)) fail('native dialogs are not allowed in the dashboard flow');
if (!dashboard.includes('id="dashboardGreeting"')) fail('dashboard greeting needs a stable update target');
if (!dashboard.includes('scheduleGreetingRefresh()')) fail('dashboard greeting must refresh when the local time period changes');
if (dashboard.includes('<h1>Buenos días,')) fail('dashboard greeting must not be hard-coded');

try {
  const heading={textContent:''};
  let scheduledDelay=0;
  class EveningDate extends Date {
    constructor(...args){ super(...(args.length?args:['2026-09-02T18:45:00.000'])); }
  }
  const testWindow={addEventListener:()=>{}};
  const testDocument={
    hidden:false,
    addEventListener:()=>{},
    getElementById:id=>id==='dashboardGreeting'?heading:null,
    querySelectorAll:()=>[]
  };
  vm.runInNewContext(dashboard,{
    window:testWindow,
    document:testDocument,
    localStorage:{getItem:()=>JSON.stringify({full_name:'Daniel Export MCA'})},
    console,
    Intl,
    URLSearchParams,
    Date:EveningDate,
    clearTimeout:()=>{},
    setTimeout:(_callback,delay)=>{ scheduledDelay=delay; return 1; }
  });
  const greeting=testWindow.ExecutiveDashboard;
  const expected=[[4,'Buenas noches'],[5,'Buenos días'],[11,'Buenos días'],[12,'Buenas tardes'],[18,'Buenas tardes'],[19,'Buenas noches']];
  for(const [hour,label] of expected){
    if(greeting?.greetingForHour?.(hour)!==label)fail(`incorrect local greeting at ${hour}:00`);
  }
  greeting?.refreshGreeting?.();
  if(heading.textContent!=='Buenas tardes, Daniel')fail('18:45 local greeting must read "Buenas tardes, Daniel"');
  if(scheduledDelay!==15*60*1000)fail('18:45 greeting refresh must be scheduled for the 19:00 boundary');
} catch(error) {
  fail(`local-time greeting regression test crashed: ${error.message}`);
}

if (fs.existsSync(compensatorPath)) fail('orphan dashboard-alert-cleanup.js compensator must stay removed');
if (erp.includes('dashboard-alert-cleanup.js')) fail('ERP boot must not load the removed dashboard compensator');
if (!erp.includes('/admin/operational-alert-center.js')) fail('operational-alert-center.js must remain the active alert owner');

if (!process.exitCode) console.log('UX6 dashboard presentation gate passed.');
