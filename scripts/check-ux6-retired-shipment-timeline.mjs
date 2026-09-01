import fs from 'node:fs';

const failures=[];
if(fs.existsSync('admin/shipment-timeline.js')) failures.push('shipment-timeline.js huérfano no puede permanecer');
const containers=fs.readFileSync('admin/containers-module.js','utf8');
const integrations=fs.readFileSync('scripts/check-integrations.mjs','utf8');
for(const text of ['async function openHistory(shipment)',"action==='history'",'No hay historial disponible.']){
  if(!containers.includes(text))failures.push(`containers-module.js no conserva ${text}`);
}
if(integrations.includes("'admin/shipment-timeline.js'")) failures.push('P19 conserva allowlist para el timeline retirado');
if(failures.length){
  console.error('UX6 retired shipment timeline gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 retired shipment timeline gate passed.');
