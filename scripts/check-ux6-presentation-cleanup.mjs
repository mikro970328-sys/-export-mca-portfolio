import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const adminDir=path.join(root,'admin');
const errors=[];
const textFiles=[];

function walk(dir){
  for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())walk(full);
    else if(/\.(?:js|html|css)$/.test(entry.name))textFiles.push(full);
  }
}
walk(adminDir);

const rel=file=>path.relative(root,file).replaceAll(path.sep,'/');
const read=file=>fs.readFileSync(file,'utf8');
const references=needle=>textFiles.filter(file=>read(file).includes(needle)).map(rel);
const forbidFile=(name,label)=>{if(fs.existsSync(path.join(adminDir,name)))errors.push(`${label} todavía existe: admin/${name}`);};
const forbidRefs=(needle,label)=>{const refs=references(needle);if(refs.length)errors.push(`${label}: ${refs.join(', ')}`);};

forbidFile('sales-existing-load-link.js','El V1 supersedido de vinculación de Cargues');
forbidRefs('/admin/sales-existing-load-link.js','Referencias al V1 de Cargues');

forbidFile('financial-traceability-dedupe.js','El dedupe compensatorio de trazabilidad financiera');
forbidRefs('financial-traceability-dedupe.js','Referencias al dedupe compensatorio');
forbidFile('financial-traceability-loader.js','El loader financiero huérfano');
forbidRefs('financial-traceability-loader.js','Referencias al loader financiero huérfano');
forbidFile('financial-traceability.js','El owner financiero huérfano');
forbidRefs('/admin/financial-traceability.js','Referencias al owner financiero huérfano');

const linkV2=read(path.join(adminDir,'sales-existing-load-link-v2.js'));
if(/\b(?:prompt|alert|confirm)\s*\(/.test(linkV2))errors.push('Sales load-link V2 todavía usa diálogo nativo.');
for(const token of ['function decision(','statusLabel(row.load_status)','sales-existing-load-link-v2.js']){
  if(!linkV2.includes(token))errors.push(`Sales load-link V2 falta ${token}`);
}
if(linkV2.includes('Estado: ${esc(row.load_status'))errors.push('Sales load-link V2 todavía expone el código de estado crudo.');
if(/function\s+ensureStyles|createElement\(['"]style|style\.textContent/.test(linkV2))errors.push('Sales load-link V2 todavía inyecta estilos en runtime.');
if(/function\s+hasPending|order\?\.status\s*===|unallocated_(?:quantity|pallets)/.test(linkV2))errors.push('Sales load-link V2 todavía infiere disponibilidad desde estado o saldos frontend.');
if(!linkV2.includes("order?.capabilities?.actions?.allocate_load?.allowed === true"))errors.push('Sales load-link V2 no consume allocate_load canónico.');
if(/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?error(?:\?\.)?\.message/.test(linkV2))errors.push('Sales load-link V2 todavía muestra error.message crudo.');
if(/expediente/i.test(linkV2))errors.push('Sales load-link V2 no debe exponer Expedientes.');

if(errors.length){
  console.error('UX6 presentation cleanup check failed:');
  errors.forEach(error=>console.error(`- ${error}`));
  process.exit(1);
}
console.log('UX6 presentation cleanup check passed: owners compensatorios eliminados y flujo de Ventas limpio.');
