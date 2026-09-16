import assert from 'node:assert/strict';
import fs from 'node:fs';

// Execute each existing finalizer with explicit isolated transports/helpers.
// Simulate commits followed by transport loss, not a real storage service.
let checks=0;
for(const [file,name,next] of [['api/shipment-documents.js','finalize','discard'],['api/documents.js','finalizeUpload','discardUpload']]) {
 const source=fs.readFileSync(file,'utf8');
 const fn=source.slice(source.indexOf(`async function ${name}(`),source.indexOf(`async function ${next}(`));
 for(const failure of ['none','commit_response','document_read','preview','audit','empty_response']) {
  if(name==='finalizeUpload'&&failure==='document_read')continue;
  let committed=false,deletes=0;
  const document={id:'document-qa',storage_path:'shipments/shipment-qa/cuba-customs/file.pdf'};
  const error=()=>{throw Object.assign(new Error('isolated transport failure'),{retryable:true});};
  const deps={BUCKET:'erp-documents',getShipment:async()=>({id:'shipment-qa'}),getOperation:async()=>({id:'operation-qa'}),
   resolveScope:async()=>({}),validateSharedScope:async()=>({}),nextVersion:async()=>1,
   canonicalType:x=>x,cleanDocumentType:x=>x,cleanFileName:x=>x,normalizedMime:()=> 'application/pdf',validSize:Number,validateSize:Number,cleanText:x=>x,cleanNotes:x=>x,
   rpcRow:x=>Array.isArray(x)?x[0]:x,
   supabase:async()=>{committed=true;if(failure==='commit_response')error();if(failure==='empty_response')return [];return [{document_id:document.id,document_version:1,...document}];},
   getDocument:async()=>{if(failure==='document_read')error();return document;},
   writeAudit:async()=>{if(failure==='audit')error();},
   signedPreview:async()=>{if(failure==='preview')error();return 'https://isolated.invalid/file';},
   createSignedPreview:async()=>{if(failure==='preview')error();return 'https://isolated.invalid/file';},
   deleteObject:async()=>{deletes++;},deleteStorageObject:async()=>{deletes++;}};
  const finalize=new Function('deps',`const {${Object.keys(deps).join(',')}}=deps;${fn};return ${name};`)(deps);
  let rejected=false;
  try {await finalize({admin_id:'qa'},{shipment_id:'shipment-qa',operation_id:'operation-qa',document_type:'Packing List Cuba',file_name:'file.pdf',file_size_bytes:10,storage_path:file.includes('shipment-')?document.storage_path:'operations/operation-qa/file.pdf'});}catch{rejected=true;}
  assert.equal(committed,true);
  assert.equal(deletes,0,`${name}: ${failure} must not delete an object after a possibly committed write`);
  if(['commit_response','preview','audit'].includes(failure))assert.equal(rejected,true);
  if(failure==='none')assert.equal(rejected,false);
  checks++;
 }
}
console.log(`Document upload preservation: ${checks}/${checks} isolated finalizer scenarios passed`);
