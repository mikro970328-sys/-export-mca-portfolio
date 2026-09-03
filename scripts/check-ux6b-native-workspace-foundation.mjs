import fs from 'node:fs';

const files={
  foundation:'admin/native-workspace-foundation.css',
  index:'admin/index.html',
  loader:'admin/erp.js',
  clients:'admin/clients-module.js',
  containers:'admin/containers-module.js',
  alerts:'admin/operational-alert-center.js',
  workers:'admin/workers-module.js',
  access:'admin/access-control-administration.js',
  account:'admin/account-administration.js',
  tasks:'admin/tasks-workspace.js'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const css=read(files.foundation);
const index=read(files.index);
const loader=read(files.loader);
const clients=read(files.clients);
const containers=read(files.containers);
const alerts=read(files.alerts);
const access=read(files.access);
const account=read(files.account);
const tasks=read(files.tasks);
const foundationRef='/admin/native-workspace-foundation.css?v=20260902-ux6c1';

for(const text of [
  '.native-workspace-shell{',
  '.native-workspace-shell .native-workspace-hero{',
  '.native-workspace-shell .native-workspace-hero::before{',
  '.native-workspace-shell .native-workspace-hero::after{content:none}',
  '.native-workspace-heading{',
  '.native-workspace-kicker{',
  '.native-workspace-summary{',
  '.native-workspace-grid{',
  '@media(max-width:1050px)',
  '@media(max-width:760px)',
  '@media(max-width:520px)',
  '@media(prefers-reduced-motion:reduce)'
])requireText(css,text,`base nativa ${text}`);

forbid(css,/font-family\s*:\s*Arial/i,'la base nativa vuelve a usar Arial');
forbid(css,/!important/i,'la base nativa usa sobrescrituras !important');
forbid(css,/@import/i,'la base nativa depende de una importación tardía');
forbid(css,/\b(?:fetch|MutationObserver)\b|\b(?:prompt|alert|confirm)\s*\(/,'la base nativa mezcla comportamiento JavaScript');
forbid(css,/(?:linear|radial)-gradient/i,'la base nativa reintroduce cabeceras decorativas degradadas');
forbid(css,/#registerContainerSection|#containersSection/,'la base compartida invade el owner visual de Tracking');

const opening=(css.match(/{/g)||[]).length;
const closing=(css.match(/}/g)||[]).length;
if(opening!==closing)failures.push(`CSS desbalanceado: ${opening} aperturas y ${closing} cierres`);

if(index.split(foundationRef).length-1!==1)failures.push('index.html debe cargar una sola vez la base nativa versionada');
requireText(index,'data-native-workspace-foundation','marcador de precedencia de la base nativa');
const themeIndex=index.indexOf('/admin/platform-theme.css?v=20260902-ux7shell1');
const navigationIndex=index.indexOf('/admin/navigation-shell.css?v=20260903-ux7icons1');
const foundationIndex=index.indexOf(foundationRef);
const headEnd=index.indexOf('</head>');
if(themeIndex<0||navigationIndex<0||foundationIndex<0||headEnd<0||!(themeIndex<navigationIndex&&navigationIndex<foundationIndex&&foundationIndex<headEnd)){
  failures.push('index.html debe cargar tema → navegación → base nativa dentro de head');
}
requireText(index,'/admin/erp.js?v=20260903-ux7icons1','revisión de caché del loader ERP');
requireText(loader,"document.querySelector('link[data-native-workspace-foundation]')",'límite de cascada para estilos dinámicos');
requireText(loader,'insertBefore(link, nativeFoundation)','estilos propietarios antes de la base compartida');

const sectionMarkup=(id,nextId)=>{
  const start=index.indexOf(`<section id="${id}"`);
  const end=nextId?index.indexOf(`<section id="${nextId}"`,start):index.length;
  return start>=0&&end>start?index.slice(start,end):'';
};
for(const [id,next] of [
  ['clientsSection','registerContainerSection'],
  ['workersSection','adminsSection']
]){
  const markup=sectionMarkup(id,next);
  requireText(markup,'native-workspace-shell',`${id}: shell visual compartido`);
  requireText(markup,'native-workspace-hero',`${id}: cabecera visual compartida`);
  requireText(markup,'native-workspace-heading',`${id}: jerarquía de título`);
  requireText(markup,'native-workspace-kicker',`${id}: contexto operativo`);
  forbid(markup,/\sstyle\s*=/i,`${id} conserva estilos inline`);
}

for(const [id,next] of [
  ['registerContainerSection','containersSection'],
  ['containersSection','publicationsSection']
]){
  const markup=sectionMarkup(id,next);
  requireText(markup,'data-owner="containers-module.js"',`${id}: owner visual canónico`);
  requireText(markup,'tracking-hero',`${id}: cabecera propietaria`);
  requireText(markup,'tracking-kicker',`${id}: contexto operativo`);
  forbid(markup,/\sstyle\s*=/i,`${id} conserva estilos inline`);
}

for(const [source,label] of [
  [alerts,'Alertas'],
  [access,'Usuarios y acceso'],
  [account,'Mi cuenta'],
  [tasks,'Mis tareas']
]){
  requireText(source,'native-workspace-shell',`${label}: shell compartido`);
  requireText(source,'native-workspace-hero',`${label}: cabecera compartida`);
  requireText(source,'native-workspace-heading',`${label}: jerarquía compartida`);
  requireText(source,'native-workspace-kicker',`${label}: contexto compartido`);
}

for(const text of ['clients-workspace','clients-hero','clients-kicker','clients-summary']){
  requireText(sectionMarkup('clientsSection','registerContainerSection'),text,`Clientes: owner visual ${text}`);
}
forbid(clients,/function\s+sectionHtml\s*\(|section\.innerHTML\s*=/,'Clientes vuelve a duplicar el markup compartido desde JavaScript');
requireText(clients,"console.error('CLIENTS_MARKUP_MISSING')",'Clientes valida su markup canónico');

forbid(containers,/document\.createElement\(['"]style['"]\)|style\.textContent|function\s+installStyles\s*\(/,'Tracking todavía inyecta CSS desde JavaScript');
requireText(containers,'function syncContainerGuidance()','Registro conserva guía y validación visual');
requireText(containers,"registrationOwner:'containers-module.js'",'Registro pertenece al owner canónico de Tracking');
if(fs.existsSync('admin/registration-form-shell.js'))failures.push('registration-form-shell.js debe permanecer retirado');
forbid(loader,/registration-form-shell/,'el loader conserva el shell visual retirado del registro');

for(const ref of [
  "/admin/clients-module.js?v=20260902-ux7clients1",
  "/admin/containers-module.js?v=20260903-ux7tracking2",
  "/admin/operational-alert-center.js?v=20260903-ux7icons1",
  "/admin/access-control-administration.js?v=20260902-ux6access1",
  "/admin/account-administration.js?v=20260903-ux7icons1",
  "/admin/tasks-workspace.js?v=20260903-ux7icons1"
])requireText(loader,ref,`asset revisado ${ref}`);

for(const source of [index,clients,alerts,access,account,tasks]){
  forbid(source,/\bexpediente\b/i,'una superficie nativa reintroduce Expedientes');
}

if(failures.length){
  console.error(`UX6B native workspace foundation gate failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX6B native workspace foundation gate passed with Tracking isolated in its canonical visual owner.');
