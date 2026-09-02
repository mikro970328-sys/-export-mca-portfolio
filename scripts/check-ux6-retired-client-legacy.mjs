import fs from 'node:fs';

const index=fs.readFileSync('admin/index.html','utf8');
const owner=fs.readFileSync('admin/clients-module.js','utf8');
const loader=fs.readFileSync('admin/admin-data-loader.js','utf8');
const failures=[];
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

forbid(index,/function\s+renderClients\s*\(/,'index.html conserva renderClients legacy');
forbid(index,/function\s+editClient\s*\(/,'index.html conserva editClient legacy');
forbid(index,/function\s+welcome\s*\(/,'index.html conserva welcome legacy');
forbid(index,/function\s+delClient\s*\(/,'index.html conserva delClient legacy');
forbid(index,/function\s+clientHistory\s*\(/,'index.html conserva clientHistory legacy');
forbid(index,/\$\(['"]saveClient['"]\)\.onclick/,'index.html conserva el guardado legacy de Clientes');
forbid(index,/onclick=['"][^'"]*(?:editClient|welcome|clientHistory|delClient)\s*\(/,'index.html conserva acciones inline de Clientes');

for(const text of ['window.renderClients=render',"owner:'clients-module.js'",'async function sendWelcome(id)','async function openHistory(id,title)','async function deleteClient(id,name)']){
  if(!owner.includes(text))failures.push(`ClientsModule no conserva ${text}`);
}
if(!loader.includes("typeof window.renderClients === 'function'"))failures.push('admin-data-loader debe delegar render de Clientes al owner cuando esté disponible');
if(/function\s+loadAll\s*\(/.test(index))failures.push('index.html no puede conservar el cargador legacy de datos');

if(failures.length){
  console.error('UX6 retired client legacy gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 retired client legacy gate passed.');
