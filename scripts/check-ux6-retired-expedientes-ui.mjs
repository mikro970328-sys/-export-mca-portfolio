import fs from 'node:fs';

const retired=[
  'admin/expedientes-module.js',
  'admin/invoice-expediente.js',
  'admin/commercial-documents-shell.js',
  'admin/commercial-documents-loads.js',
  'admin/commercial-documents-invoices.js'
];
const failures=[];
for(const file of retired) if(fs.existsSync(file)) failures.push(`${file} no puede permanecer en la UI activa`);
const loader=fs.readFileSync('admin/erp.js','utf8');
const index=fs.readFileSync('admin/index.html','utf8');
const containers=fs.readFileSync('admin/containers-module.js','utf8');
const sales=fs.readFileSync('admin/sales-workspace.js','utf8');
for(const file of retired){
  const route='/'+file;
  if(loader.includes(route)||index.includes(route)) failures.push(`${route} no puede cargarse`);
}
for(const text of ['Documentos Cuba','packing_list_cuba','commercial_invoice_cuba','shipment-document-readiness']){
  if(!containers.includes(text) && !sales.includes(text)) failures.push(`el owner vigente no conserva ${text}`);
}
if(failures.length){
  console.error('UX6 retired Expedientes UI gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 retired Expedientes UI gate passed.');
