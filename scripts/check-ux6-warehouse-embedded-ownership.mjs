import fs from 'node:fs';

const read=path=>fs.readFileSync(path,'utf8');
const shell=read('admin/navigation-shell.js');
const html=read('admin/warehouse.html');
const embedded=read('admin/warehouse-embedded.js');
const errors=[];
const requireText=(source,needle,label)=>{if(!source.includes(needle))errors.push(`${label}: falta ${needle}`);};
const forbidText=(source,needle,label)=>{if(source.includes(needle))errors.push(`${label}: conserva ${needle}`);};

requireText(shell,"src:'/admin/warehouse.html?embedded=1'",'Navigation shell');
for(const token of [
  'applyWarehouseCatalogBoundary',
  'contentDocument',
  '__warehouseCatalogObserver',
  "[navigation-shell] warehouse catalog boundary"
])forbidText(shell,token,'Navigation shell cross-frame ownership');
if(/warehouseSection[\s\S]{0,300}addEventListener\(['\"]load['\"]/.test(shell))errors.push('Navigation shell: no debe instalar load handlers para mutar Warehouse.');

requireText(html,'<script src="/admin/warehouse-embedded.js"></script>','Warehouse HTML');

for(const token of [
  'new URLSearchParams(window.location.search)',
  "params.get('embedded') !== '1'",
  "document.body.classList.add('warehouse-embedded')",
  '.tab[data-tab="products"]',
  '#productsPane',
  '#quickProductModal',
  '.product-picker button',
  'Administración → Productos',
  "owner: 'warehouse-embedded.js'"
])requireText(embedded,token,'Warehouse embedded owner');

for(const token of [
  'MutationObserver',
  'parent.document',
  'contentDocument',
  'window.parent.document'
])forbidText(embedded,token,'Warehouse embedded owner');
if(/\b(?:prompt|alert|confirm)\s*\(/.test(embedded))errors.push('Warehouse embedded owner: no debe usar diálogos nativos.');
if(/expediente/i.test(embedded))errors.push('Warehouse embedded owner: no debe reintroducir Expedientes.');

const embeddedCheck=embedded.indexOf("params.get('embedded') !== '1'");
const firstMutation=Math.min(...[
  embedded.indexOf("document.body.classList.add('warehouse-embedded')"),
  embedded.indexOf('document.head.appendChild(style)')
].filter(index=>index>=0));
if(embeddedCheck<0||firstMutation<0||embeddedCheck>firstMutation)errors.push('Warehouse embedded owner: standalone debe salir antes de cualquier mutación visual.');

if(errors.length){
  console.error('UX6 Warehouse embedded ownership check failed:');
  errors.forEach(error=>console.error(`- ${error}`));
  process.exit(1);
}
console.log('UX6 Warehouse embedded ownership check passed: el shell navega y Warehouse posee su presentación embedded.');
