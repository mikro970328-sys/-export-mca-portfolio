import assert from 'node:assert/strict';
import fs from 'node:fs';
const source=fs.readFileSync('admin/containers-module.js','utf8');
const fn=source.slice(source.indexOf('  async function uploadCustomsDocument('),source.indexOf('  async function deleteCustomsDocument('));
let checks=0;
for(const scenario of ['success','saved_refresh_failed','response_lost_found','response_lost_missing','read_failed','historical','deleted','storage_failed','different_file','different_shipment','recovery_refresh_failed']){
 let change,feedback=[],calls=[],refreshes=0;
 const prepared={storage_path:'shipments/qa/cuba-customs/unique.pdf',signed_url:'https://isolated.invalid',document_type:'Packing List Cuba',file_name:'file.pdf',file_size_bytes:10};
 const input={files:[{name:'file.pdf',size:10,type:'application/pdf'}],remove(){},click(){},addEventListener(event,fn){change=fn;}};
 const deps={window:{ExportMcaAccessControl:{can:()=>true}},CUSTOMS_TYPES:[{key:'packing',type:'Packing List Cuba',label:'Packing List Cuba'}],
 document:{createElement:()=>input,body:{appendChild(){}}},FormData:class{append(){}},console:{error(){}},
 setCustomsFeedback:(message,ok)=>feedback.push({message,ok}),safeContainerMessage:(_error,fallback)=>fallback,
 fetch:async()=>({ok:scenario!=='storage_failed'}),
 request:async(url,options)=>{
  const action=options?JSON.parse(options.body).action:'read';calls.push(action);
  if(action==='prepare_upload')return {upload:prepared};
  if(action==='discard_upload')return {};
  if(action==='finalize_upload'){if(['success','saved_refresh_failed'].includes(scenario))return {document:{id:'new'}};throw new Error('response lost');}
  if(scenario==='read_failed')throw new Error('read failed');
  return {documents:scenario==='response_lost_missing'?[]:[{id:'new',shipment_id:scenario==='different_shipment'?'other':'qa',document_type:prepared.document_type,storage_path:scenario==='different_file'?'other.pdf':prepared.storage_path,is_current:scenario!=='historical',deleted_at:scenario==='deleted'?'now':null}]};
 },loadShipmentDocuments:async()=>deps.request('/read'),
 refreshAfterCustomsChange:async()=>{refreshes++;if(['saved_refresh_failed','recovery_refresh_failed'].includes(scenario))throw new Error('refresh failed');}};
 const upload=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;${fn};return uploadCustomsDocument;`)(deps);
 await upload({id:'qa'},'packing');await change();
 const last=feedback.at(-1);
 assert.equal(calls.filter(x=>x==='finalize_upload').length,scenario==='storage_failed'?0:1,'Never retry the write');
 if(scenario==='success')assert.equal(last.ok,true);
 if(['saved_refresh_failed','recovery_refresh_failed'].includes(scenario))assert.match(last.message,/guardado.*actualizar/i);
 if(scenario==='response_lost_found')assert.equal(last.ok,true,'Recover a confirmed stored path');
 if(['response_lost_missing','read_failed','deleted','different_file','different_shipment'].includes(scenario)){assert.match(last.message,/confirmar|verificar/i);assert.doesNotMatch(last.message,/Intenta nuevamente/);}
 if(scenario==='historical')assert.match(last.message,/versión posterior/i);
 if(scenario!=='storage_failed')assert.equal(calls.includes('discard_upload'),false);
 checks++;
}
console.log(`Customs upload recovery: ${checks}/${checks} isolated UI scenarios passed`);
