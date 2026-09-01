import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const adminDir=path.join(root,'admin');
const errors=[];
const info=[];
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

if(fs.existsSync(path.join(adminDir,'sales-existing-load-link.js')))errors.push('El V1 supersedido de vinculación de Cargues todavía existe.');
const oldLoadRefs=references('/admin/sales-existing-load-link.js');
if(oldLoadRefs.length)errors.push(`Referencias al V1 de Cargues: ${oldLoadRefs.join(', ')}`);

if(fs.existsSync(path.join(adminDir,'financial-traceability-dedupe.js')))errors.push('El dedupe compensatorio de trazabilidad financiera todavía existe.');
const dedupeRefs=references('financial-traceability-dedupe.js');
if(dedupeRefs.length)errors.push(`Referencias al dedupe compensatorio: ${dedupeRefs.join(', ')}`);

const linkV2=read(path.join(adminDir,'sales-existing-load-link-v2.js'));
if(/\b(?:prompt|alert|confirm)\s*\(/.test(linkV2))errors.push('Sales load-link V2 todavía usa diálogo nativo.');
for(const token of ['function decision(','statusLabel(row.load_status)','sales-existing-load-link-v2.js']){
  if(!linkV2.includes(token))errors.push(`Sales load-link V2 falta ${token}`);
}

const loader=read(path.join(adminDir,'financial-traceability-loader.js'));
if(loader.includes('dedupe'))errors.push('financial-traceability-loader conserva lógica dedupe.');
if(!loader.includes('/admin/financial-traceability.js?v=20260901-ux6'))errors.push('financial-traceability-loader no apunta al owner UX6.');

const loaderConsumers=references('/admin/financial-traceability-loader.js');
info.push(`financial-traceability-loader consumers: ${loaderConsumers.length?loaderConsumers.join(', '):'none'}`);
const ownerConsumers=references('/admin/financial-traceability.js');
info.push(`financial-traceability owner refs: ${ownerConsumers.join(', ')}`);

console.log(info.join('\n'));
if(errors.length){
  console.error('UX6 presentation cleanup check failed:');
  errors.forEach(error=>console.error(`- ${error}`));
  process.exit(1);
}
console.log('UX6 presentation cleanup check passed.');
