import fs from 'node:fs';

const foundationPath='admin/embedded-foundation.css';
const foundationRef='/admin/embedded-foundation.css?v=20260902-ux6b2';
const modules={
  sales:'admin/sales.html',
  purchases:'admin/purchases.html',
  warehouse:'admin/warehouse.html',
  inventory:'admin/inventory.html',
  loads:'admin/loads.html',
  publications:'admin/publications.html'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

if(!fs.existsSync(foundationPath))failures.push(`falta ${foundationPath}`);
for(const file of Object.values(modules))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const css=read(foundationPath);
for(const text of [
  '--navy-strong:#09182e',
  '--orange:#f97316',
  '--surface:#ffffff',
  '--font-sans:Inter,ui-sans-serif',
  'body.erp-module-page',
  '.erp-module-page .module-hero',
  '.erp-module-page .module-kicker',
  '.erp-module-page .panel > .toolbar',
  '.erp-module-page .metrics > .metric',
  '.erp-module-page input:focus',
  '.erp-module-page .modal',
  '.erp-module-page .drawer',
  '.erp-module-page.erp-module-inventory .tabs',
  '.erp-module-page.erp-module-publications .layout',
  '@media(max-width:980px)',
  '@media(max-width:720px)',
  '@media(max-width:520px)',
  '@media(prefers-reduced-motion:reduce)'
])requireText(css,text,`base visual ${text}`);

forbid(css,/font-family\s*:\s*Arial/i,'la base visual vuelve a usar Arial');
forbid(css,/!important/i,'la base visual usa sobrescrituras !important');
forbid(css,/@import/i,'la base visual depende de una importación tardía');
forbid(css,/\b(?:fetch|MutationObserver|prompt|alert|confirm)\b/,'la base visual mezcla comportamiento de JavaScript');

const openingBraces=(css.match(/{/g)||[]).length;
const closingBraces=(css.match(/}/g)||[]).length;
if(openingBraces!==closingBraces)failures.push(`CSS desbalanceado: ${openingBraces} aperturas y ${closingBraces} cierres`);

for(const [module,file] of Object.entries(modules)){
  const html=read(file);
  const refCount=html.split(foundationRef).length-1;
  if(refCount!==1)failures.push(`${file} debe cargar una sola vez ${foundationRef}; encontró ${refCount}`);
  requireText(html,`<body class="erp-module-page erp-module-${module}">`,`${module}: scope visual del body`);
  requireText(html,'module-hero',`${module}: cabecera del módulo`);
  if(!html.includes('module-kicker')&&!html.includes('sales-page-kicker'))failures.push(`${file} no declara jerarquía contextual`);

  const foundationIndex=html.indexOf(foundationRef);
  const lastInlineStyle=html.lastIndexOf('</style>');
  const headEnd=html.indexOf('</head>');
  if(foundationIndex<0||foundationIndex<lastInlineStyle||headEnd<foundationIndex){
    failures.push(`${file} debe cargar la base visual al final de head, después de sus estilos propietarios`);
  }
}

const publications=read(modules.publications);
forbid(publications,/<body[^>]*>\s*<header[^>]*>\s*<img/i,'Publicaciones conserva una segunda marca encima del shell embebido');
requireText(publications,'rel="noopener"','enlace seguro a la app pública');

if(failures.length){
  console.error(`UX6B embedded foundation gate failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX6B embedded foundation gate passed for six operational modules.');
