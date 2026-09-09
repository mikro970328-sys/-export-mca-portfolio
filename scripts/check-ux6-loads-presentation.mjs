import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const read=file=>fs.readFileSync(file,'utf8');
const api=read('api/loads.js');
const ui=read('admin/loads.js');
const css=read('admin/loads.css');
const html=read('admin/loads.html');
const canonicalGate=read('scripts/check-ux5-load-actions.mjs');
const workflow=read('.github/workflows/ux6-loads-presentation.yml');
const failures=[];
const requireText=(source,text,label=text)=>{if(!source.includes(text))failures.push(`falta ${label}`);};
const forbid=(source,re,label)=>{if(re.test(source))failures.push(label);};

for(const text of [
  '/admin/loads.css?v=20260904-loadflow1',
  '/admin/loads.js?v=20260909-loadcard1',
  'id="pageMsg"',
  'role="status"',
  'aria-live="polite"',
  'role="dialog"',
  'aria-modal="true"',
  'aria-labelledby="decisionTitle"'
])requireText(html,text,`HTML ${text}`);
forbid(html,/<style\b/i,'loads.html conserva la hoja de estilos embebida');
forbid(html,/\sstyle=/i,'loads.html conserva estilos inline');

for(const text of [
  '.load-form-notes',
  '.load-form-actions',
  '.load-section-actions',
  '.load-detail-actions',
  '.load-feedback.bad',
  '.load-action-feedback.bad',
  ':focus-visible',
  '@media(max-width:840px)',
  '@media(max-width:620px)'
])requireText(css,text,`CSS ${text}`);

for(const text of [
  'SAFE_LOAD_ERROR_PATTERNS',
  "function safeLoadMessage(error,fallback='No se pudo completar la operación. Intenta nuevamente.',context='operation')",
  'function reportLoadError(context,error,fallback)',
  'function setFeedback(id,message=',
  "console.error('LOADS_UI_FAILED'",
  "reportLoadError(`action:${action}`,error)",
  "reportLoadError('save_plan',error)",
  "reportLoadError('create_container',error)",
  "reportLoadError('assign_container',error)",
  '.catch(showLoadFailure)',
  "const statusLabel=value=>labels[value]||'Estado no disponible'",
  "can(load,'reserve')",
  "can(load,'release')",
  "can(load,'start_loading')",
  "can(load,'mark_loaded')",
  "can(load,'dispatch')",
  "can(load,'edit')",
  "can(load,'cancel')",
  "can(load,'assign_container')",
  "can(load,'unassign_container')",
  "can(load,'view_tracking')"
])requireText(ui,text,`owner de Cargues ${text}`);
forbid(ui,/\b(?:prompt|alert|confirm)\s*\(/,'Cargues no puede usar diálogos nativos');
forbid(ui,/(?:textContent|innerHTML)\s*=\s*(?:esc\s*\(\s*)?(?:error|e)(?:\?\.)?\.message/,'Cargues no puede mostrar error.message crudo');
forbid(ui,/\sstyle=/i,'Cargues no puede generar estilos inline');
forbid(ui,/labels\[[^\]]+\.status\]\|\|[^;\n]*\.status/,'Cargues no puede exponer códigos de estado desconocidos');
forbid(ui,/if\s*\(l\.status===['"](?:draft|reserved|loading|loaded)['"]\)/,'Cargues no puede inferir acciones desde status');
forbid(ui,/\bexpediente(?:s)?\b/i,'Cargues no puede reintroducir Expedientes');

for(const text of [
  'function translatedError(raw)',
  "['JSON_INVALID','La solicitud no tiene un formato válido.']",
  "['LOAD_QUANTITY_INVALID','La cantidad o los pallets seleccionados no son válidos.']",
  "if(translated)return fail(res,400,translated)",
  "return fail(res,500,'No se pudo procesar Cargues')",
  "supabase('rpc/execute_load_action'",
  "supabase('rpc/replace_load_plan_canonical'",
  "supabase('rpc/create_load_shipment_canonical'",
  "supabase('rpc/assign_load_shipment_canonical'"
])requireText(api,text,`backend seguro ${text}`);
forbid(api,/return matched\?\.[^;]+:\s*raw|\|\|\s*raw\s*;/,'Loads API no puede devolver errores internos crudos');
forbid(api,/return fail\(res,400,translatedError\(raw\)\)/,'Loads API no puede clasificar todo error inesperado como 400');

for(const text of [
  'DB canonical owner',
  'Loads UI',
  'src="/admin/loads.js?v=20260909-loadcard1"',
  "can(load,'dispatch')",
  "can(load,'view_tracking')"
])requireText(canonicalGate,text,`gate UX-5 preservado ${text}`);

for(const text of [
  'node scripts/check-ux6-loads-presentation.mjs',
  'node scripts/check-ux5-load-actions.mjs',
  'node scripts/check-frontend-ownership.mjs',
  'node scripts/check-admin-shell-resilience.mjs',
  'node scripts/audit-b9-api-boundaries.mjs',
  'node scripts/check-b9-database-privileges.mjs',
  'node scripts/check-b9-public-boundaries.mjs',
  'node scripts/check-integrations.mjs'
])requireText(workflow,text,`workflow ${text}`);

// Execute the existing owner, not a duplicate card renderer. Lightweight DOM
// sinks cover every lifecycle stage with/without write capabilities; actual
// mobile visibility and clicking are covered by isolated commercial COM-07.
let cardChecks=0;
for(const status of ['draft','reserved','loading','loaded','dispatched','cancelled']){
  for(const allowed of [false,true]){
    const label=`${status}/${allowed?'writer':'reader'}`;
    try{
      const nodes=new Map();
      const document={getElementById(id){
        if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',textContent:'',classList:{toggle(){}}});
        return nodes.get(id);
      }};
      const opened=[],actions=[];
      const fixture={id:'qa-load',load_number:'CG-QA',status,capabilities:{status,actions:
        Object.fromEntries(['reserve','start_loading','mark_loaded','dispatch'].map(key=>[key,{allowed,reason:'PERMISSION_REQUIRED'}]))}};
      const context=vm.createContext({document,window:{addEventListener(){}},
        localStorage:{getItem(){return '';}},location:{search:'?embedded=1'},
        URLSearchParams,console,fixture,opened,actions});
      vm.runInContext(ui,context,{timeout:1000});
      vm.runInContext('state.loads=[fixture];renderRows();',context,{timeout:1000});
      const cards=document.getElementById('loadCards').innerHTML;
      const buttons=cards.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)||[];
      const details=buttons.filter(button=>button.includes('data-open-load="qa-load"'));
      assert.ok(details.length>0,'mobile card must open detail independently of next action');
      assert.ok(details.some(button=>button.includes('type="button"')&&!/\bdisabled\b|data-quick-action/.test(button)),
        'detail must be a separate enabled native button');
      assert.equal(cards.includes('data-quick-action='),allowed&&['draft','reserved','loading','loaded'].includes(status),
        'quick actions must still obey capabilities');
      vm.runInContext(`openLoad=id=>{opened.push(id);return Promise.resolve(true);};
        handleAction=(...args)=>actions.push(args);
        handleLoadListClick({target:{closest:selector=>selector==='[data-open-load]'?{dataset:{openLoad:fixture.id}}:null}});`,
        context,{timeout:1000});
      assert.deepEqual(opened,['qa-load']);
      assert.equal(actions.length,0,'opening a card must not reserve or advance it');
      cardChecks++;
    }catch(error){failures.push(`mobile card ${label}: ${error.message}`);}
  }
}
console.log(`Loads mobile detail regression: ${cardChecks}/12 passed.`);

if(failures.length){
  console.error('UX6 Loads presentation gate failed:\n'+failures.map(item=>`- ${item}`).join('\n'));
  process.exit(1);
}
console.log('UX6 Loads presentation gate passed.');
