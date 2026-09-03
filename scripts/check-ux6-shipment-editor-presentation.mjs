import fs from 'node:fs';

const read=file=>fs.readFileSync(file,'utf8');
const js=read('admin/shipment-editor.js');
const css=read('admin/shipment-editor.css');
const erp=read('admin/erp.js');
const failures=[];
const requireText=(src,text,label=text)=>{if(!src.includes(text))failures.push(`falta ${label}`);};
const forbid=(src,re,label)=>{if(re.test(src))failures.push(label);};

forbid(js,/document\.createElement\(['"]style['"]\)|style\.textContent|function\s+installStyles\s*\(|shipmentEditorStyles/,'shipment-editor.js no puede inyectar estilos');
forbid(js,/\b(?:prompt|alert|confirm)\s*\(/,'ShipmentEditor no puede usar diálogos nativos');
forbid(js,/setError\(error\.message\)/,'ShipmentEditor no puede mostrar error.message crudo');
forbid(js,/\bexpediente\b/i,'ShipmentEditor no puede reintroducir Expedientes');

for(const text of ['SAFE_EDITOR_ERRORS','safeEditorMessage(error, fallback','SHIPMENT_EDITOR_SAVE_FAILED','SHIPMENT_EDITOR_IMPORTERS_LOAD_FAILED',"owner:'containers-module.js'"]) requireText(js,text);
for(const text of ['.shipment-editor-grid','.shipment-editor-info','.shipment-editor-footer','.shipment-editor-error']) requireText(css,text,`selector CSS ${text}`);
requireText(css,'@media(max-width:720px)','responsive móvil');
requireText(css,':focus-visible','foco accesible');

const styleLoad="loadStylesheet('/admin/shipment-editor.css?v=20260902-ux7tracking1', 'data-shipment-editor-style')";
const scriptLoad="loadScript('/admin/shipment-editor.js?v=20260902-ux7tracking1', 'data-shipment-editor')";
requireText(erp,styleLoad,'carga stylesheet del editor');
requireText(erp,scriptLoad,'carga JavaScript del editor');
const styleIndex=erp.indexOf(styleLoad),scriptIndex=erp.indexOf(scriptLoad);
if(styleIndex<0||scriptIndex<0||styleIndex>scriptIndex) failures.push('erp.js debe cargar shipment-editor.css antes del JavaScript');

for(const contract of [
  "request('/api/shipments', { method:'PATCH', body:JSON.stringify(payload()) })",
  "action:'assign_shipment'",
  'window.ContainersModule?.syncImporters?.()',
  'validReference(reference)'
]) requireText(js,contract);

if(failures.length){
  console.error('UX6 Shipment editor presentation gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Shipment editor presentation gate passed.');
