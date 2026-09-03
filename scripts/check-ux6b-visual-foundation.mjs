import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const files={
  index:'admin/index.html',
  pwa:'admin/pwa.html',
  manifest:'admin/manifest.webmanifest',
  serviceWorker:'sw.js',
  erp:'admin/erp.js',
  theme:'admin/platform-theme.css',
  navigation:'admin/navigation-shell.css',
  navigationJs:'admin/navigation-shell.js',
  dashboardCss:'admin/dashboard-executive.css',
  dashboardJs:'admin/dashboard-operational-state.js'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const index=read(files.index);
const pwa=read(files.pwa);
const manifest=read(files.manifest);
const serviceWorker=read(files.serviceWorker);
const erp=read(files.erp);
const theme=read(files.theme);
const navigation=read(files.navigation);
const navigationJs=read(files.navigationJs);
const dashboardCss=read(files.dashboardCss);
const dashboardJs=read(files.dashboardJs);

const themeRef='/admin/platform-theme.css?v=20260902-ux7shell1';
const navigationRef='/admin/navigation-shell.css?v=20260903-ux7icons2';
for(const ref of [themeRef,navigationRef])requireText(index,ref,ref);
requireText(index,'<meta name="theme-color" content="#09182e">','color del navegador');
requireText(index,'/admin/manifest.webmanifest?v=4','manifest versionado');
requireText(pwa,'<meta name="theme-color" content="#09182e">','color PWA');
requireText(pwa,'/admin/manifest.webmanifest?v=4','manifest PWA versionado');
requireText(manifest,'"background_color": "#f5f7fb"','fondo del manifest');
requireText(manifest,'"theme_color": "#09182e"','tema del manifest');
requireText(serviceWorker,"const CACHE='export-mca-shell-v5'",'caché PWA renovado');
const themeIndex=index.indexOf(themeRef);
const navigationIndex=index.indexOf(navigationRef);
const headEnd=index.indexOf('</head>');
if(themeIndex<0||navigationIndex<themeIndex||headEnd<navigationIndex){
  failures.push('el sistema visual debe cargar desde sus owners CSS antes de cerrar head');
}
forbid(index,/<style(?:\s|>)/i,'index.html conserva una hoja visual legacy incrustada');
forbid(index,/\sstyle\s*=/i,'index.html conserva estilos inline');

for(const text of [
  'class="sidebar-brand-mark"',
  'class="sidebar-brand-copy"',
  'class="topbar-heading"',
  'class="topbar-eyebrow"',
  'aria-label="Navegación principal"'
])requireText(index,text,`estructura visual ${text}`);

for(const text of [
  '--content-max:1480px',
  '--font-sans:Inter,ui-sans-serif',
  '--surface:#ffffff',
  'button:focus-visible',
  '@media(max-width:520px)',
  '@media(prefers-reduced-motion:reduce)'
])requireText(theme,text,`sistema visual ${text}`);

for(const text of [
  '--sidebar-expanded:272px',
  '--sidebar-collapsed:80px',
  'position:fixed',
  '.sidebar-nav .nav-group.open>.submenu',
  '.sidebar-brand-mark',
  '.topbar-heading',
  '.nav-group>.submenu button.active::before',
  'body.sidebar-collapsed .sidebar',
  '@media(max-width:900px)'
])requireText(navigation,text,`navegación ${text}`);

for(const text of [
  'function dashboardIntro(data)',
  'class="executive-intro"',
  'class="executive-priority-grid"',
  'class="executive-op-icon"',
  'Saldos de cuentas: <b>actuales</b>',
  'Conversión de moneda: <b>no aplicada</b>',
  "${dashboardIntro(data)}${operationalSummary(data)}"
])requireText(dashboardJs,text,`dashboard ${text}`);

for(const text of [
  '.executive-intro',
  '.executive-priority-grid',
  '.executive-ops-grid',
  '.executive-finance-grid',
  '.executive-state-error',
  'linear-gradient(125deg,var(--navy-strong),var(--navy-soft))',
  '@media(max-width:520px)',
  '@media(prefers-reduced-motion:reduce)'
])requireText(dashboardCss,text,`presentación dashboard ${text}`);

requireText(erp,"loadStylesheet('/admin/dashboard-executive.css?v=20260902-ux7shell1'",'CSS versionado de dashboard');
requireText(erp,"loadScript('/admin/dashboard-operational-state.js?v=20260903-ux7icons2'",'owner versionado de dashboard');
forbid(erp,/data-platform-theme|data-navigation-shell-style/,'erp.js no debe volver a cargar tarde la base visual estática');
forbid(navigationJs,/\sstyle\s*=/i,'navigation-shell.js vuelve a crear iframes con estilos inline');
forbid(dashboardJs,/\b(?:prompt|alert|confirm)\s*\(|MutationObserver|createElement\(['"]style['"]\)/,'dashboard introduce diálogo, observer o estilo inyectado');
forbid(theme,/font-family\s*:\s*Arial/i,'el sistema visual vuelve a Arial');
forbid(navigation,/font-family\s*:\s*Arial/i,'la navegación vuelve a Arial');
forbid(dashboardCss,/font-family\s*:\s*Arial/i,'el dashboard vuelve a Arial');

for(const file of [files.erp,files.navigationJs,files.dashboardJs]){
  const result=spawnSync(process.execPath,['--check',file],{encoding:'utf8'});
  if(result.status!==0)failures.push(`error de sintaxis en ${file}: ${result.stderr||result.stdout}`);
}

if(failures.length){
  console.error(`UX7 shell visual owner gate failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX7 shell visual owner gate passed.');
