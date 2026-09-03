import fs from 'node:fs';

const foundationPath='admin/embedded-foundation.css';
const foundationRef='/admin/embedded-foundation.css?v=20260902-ux6b3';
const modules={
  invoices:'admin/invoices.html',
  payables:'admin/payables.html',
  costs:'admin/costs.html',
  reports:'admin/reports.html',
  suppliers:'admin/suppliers.html',
  products:'admin/products.html'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};

if(!fs.existsSync(foundationPath))failures.push(`falta ${foundationPath}`);
for(const file of Object.values(modules))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const css=read(foundationPath);
for(const text of [
  '.erp-module-page .module-hero::after{content:none}',
  '.erp-module-page .reports-wrap',
  '.erp-module-page .report-card',
  '.erp-module-page .report-table-card',
  '.erp-module-page .dataset-tabs',
  '.erp-module-page .report-filters',
  '.erp-module-page .supplier-list',
  '.erp-module-page .supplier-row',
  '.erp-module-page .product-list',
  '.erp-module-page .product-row',
  '.erp-module-page .notice',
  '.erp-module-page .meta-chip'
])requireText(css,text,`base compartida ${text}`);

for(const [module,file] of Object.entries(modules)){
  const html=read(file);
  const count=html.split(foundationRef).length-1;
  if(count!==1)failures.push(`${file} debe cargar una sola vez ${foundationRef}; encontró ${count}`);
  requireText(html,`<body class="erp-module-page erp-module-${module}"`,`${module}: scope visual del body`);
  requireText(html,'module-hero',`${module}: cabecera compartida`);
  requireText(html,'module-kicker',`${module}: jerarquía contextual`);

  const foundationIndex=html.indexOf(foundationRef);
  const lastInlineStyle=html.lastIndexOf('</style>');
  const headEnd=html.indexOf('</head>');
  if(foundationIndex<0||foundationIndex<lastInlineStyle||headEnd<foundationIndex){
    failures.push(`${file} debe cargar la base visual después de los estilos propietarios y antes de cerrar head`);
  }
}

const reports=read(modules.reports);
for(const text of [
  'class="reports-head module-hero"',
  'class="reports-actions module-actions"',
  'id="datasetTabs"',
  'id="reportTable"'
])requireText(reports,text,`Reportes ${text}`);

if(failures.length){
  console.error(`UX6B finance/admin foundation gate failed:\n${failures.map(failure=>`- ${failure}`).join('\n')}`);
  process.exit(1);
}

console.log('UX6B finance/admin foundation gate passed for six modules.');
