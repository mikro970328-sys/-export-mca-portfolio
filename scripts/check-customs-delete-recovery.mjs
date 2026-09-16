import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('admin/containers-module.js','utf8');
const fn=source.slice(source.indexOf('  async function deleteCustomsDocument('),source.indexOf('  function progressHtml('));
let checks=0;
for(const scenario of ['success','cleanup_pending','refresh_failed','response_lost_deleted','response_lost_current','missing','read_failed','other_document','other_shipment','recovery_refresh_failed','declined','no_permission','historical']){
 let deletes=0,reads=0,feedback=[];
 const deps={window:{ExportMcaAccessControl:{can:()=>scenario!=='no_permission'}},decision:async()=>scenario!=='declined',
 setCustomsFeedback:(message,ok)=>feedback.push({message,ok}),safeContainerMessage:(_e,fallback)=>fallback,console:{error(){}},
 request:async()=>{deletes++;if(['success','cleanup_pending','refresh_failed'].includes(scenario))return {deleted:true,storage_cleanup_pending:scenario==='cleanup_pending'};throw new Error('lost response');},
 loadShipmentDocuments:async()=>{reads++;if(scenario==='read_failed')throw new Error('read failed');return {documents:scenario==='missing'?[]:[{id:scenario==='other_document'?'other':'doc',shipment_id:scenario==='other_shipment'?'other':'shipment',deleted_at:scenario==='response_lost_current'?null:'now'}]};},
 refreshAfterCustomsChange:async()=>{if(['refresh_failed','recovery_refresh_failed'].includes(scenario))throw new Error('refresh failed');}};
 const remove=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;${fn};return deleteCustomsDocument;`)(deps);
 await remove({id:'shipment',container_number:'QA'},{id:'doc',file_name:'doc.pdf',is_current:scenario!=='historical'});
 assert.equal(deletes,['declined','no_permission','historical'].includes(scenario)?0:1,'Do not repeat DELETE');
 const last=feedback.at(-1);
 if(scenario==='success')assert.equal(last.ok,true);
 if(scenario==='cleanup_pending')assert.match(last.message,/limpieza física.*pendiente/i);
 if(['refresh_failed','recovery_refresh_failed'].includes(scenario))assert.match(last.message,/retirado.*actualizar/i);
 if(scenario==='response_lost_deleted'){assert.equal(last.ok,true);assert.match(last.message,/retirado/i);assert.doesNotMatch(last.message,/limpieza física.*complet/);}
 if(['response_lost_current','missing','read_failed','other_document','other_shipment'].includes(scenario)){assert.match(last.message,/confirmar/i);assert.doesNotMatch(last.message,/Intenta nuevamente/);}
 if(['declined','no_permission','historical'].includes(scenario))assert.equal(reads,0);
 checks++;
}
console.log(`Customs delete recovery: ${checks}/${checks} isolated UI scenarios passed`);
