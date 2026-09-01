import fs from 'node:fs';

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

if (fs.existsSync(compensatorPath)) fail('orphan dashboard-alert-cleanup.js compensator must stay removed');
if (erp.includes('dashboard-alert-cleanup.js')) fail('ERP boot must not load the removed dashboard compensator');
if (!erp.includes('/admin/operational-alert-center.js')) fail('operational-alert-center.js must remain the active alert owner');

if (!process.exitCode) console.log('UX6 dashboard presentation gate passed.');
