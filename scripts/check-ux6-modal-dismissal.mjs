import fs from 'node:fs';

const files={
  owner:'admin/modal-dismissal.js',
  styles:'admin/native-workspace-foundation.css',
  index:'admin/index.html',
  loader:'admin/erp.js'
};
const failures=[];
const read=file=>fs.existsSync(file)?fs.readFileSync(file,'utf8'):'';
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,pattern,label)=>{if(pattern.test(source))failures.push(label);};

for(const file of Object.values(files))if(!fs.existsSync(file))failures.push(`falta ${file}`);

const owner=read(files.owner);
const css=read(files.styles);
const index=read(files.index);
const loader=read(files.loader);

for(const text of [
  "owner: 'modal-dismissal.js'",
  'confirmDiscard',
  'modalDismissalDecision',
  "role: 'dialog'",
  "'aria-modal': 'true'",
  "'aria-describedby': 'modalDismissalDescription'",
  'Seguir editando',
  'Descartar cambios',
  "event.key === 'Tab'",
  "event.key === 'Escape'",
  'decisionRestoreFocus',
  'if (closeRequest) return closeRequest',
  'if (decisionPromise) return decisionPromise'
])requireText(owner,text,`contrato de descarte ${text}`);

forbid(owner,/\b(?:confirm|prompt|alert)\s*\(/,'el owner vuelve a usar un diálogo nativo');
forbid(owner,/\.style\.|setAttribute\(['"]style|style\s*=/,'el owner vuelve a mezclar estilos inline');
forbid(owner,/innerHTML\s*=/,'el owner vuelve a construir el diálogo con HTML opaco');
forbid(owner,/\bfetch\s*\(|\/api\//,'el owner invade datos o APIs');

for(const text of [
  '.modal-dismissal-close{',
  '.modal-dismissal-decision{',
  '.modal-dismissal-decision.hidden{display:none}',
  '.modal-dismissal-decision-panel{',
  '.modal-dismissal-actions{',
  'body.modal-dismissal-pending{overflow:hidden}',
  '@media(max-width:760px)',
  '@media(prefers-reduced-motion:reduce)'
])requireText(css,text,`estilo compartido ${text}`);

forbid(css,/!important/i,'el diálogo compartido usa !important');
forbid(css,/(?:linear|radial)-gradient/i,'el diálogo compartido reintroduce degradados');

requireText(index,'/admin/native-workspace-foundation.css?v=20260902-ux6c1','revisión del CSS compartido');
requireText(index,'/admin/erp.js?v=20260905-accessflow1','revisión del loader');
requireText(loader,"/admin/modal-dismissal.js?v=20260902-ux6c1",'revisión del owner de cierre');

if(failures.length){
  console.error('UX-6 modal dismissal gate failed:');
  failures.forEach(failure=>console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UX-6 modal dismissal gate passed.');
console.log('- Un solo owner controla el descarte de cambios sin confirm/alert/prompt nativos.');
console.log('- El diálogo preserva foco, Escape, Tab y deduplica solicitudes simultáneas.');
console.log('- La presentación vive en la base visual compartida y usa revisiones de caché exactas.');
