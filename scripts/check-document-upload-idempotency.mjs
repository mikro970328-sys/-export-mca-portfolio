import assert from 'node:assert/strict';
import { createSalesLogisticsAcceptanceDb } from './lib/sales-logistics-acceptance-db.mjs';
const db=await createSalesLogisticsAcceptanceDb();
try{
 const one=async(sql,args=[]) => (await db.query(sql,args)).rows[0];
 const shipment=await one("insert into shipments(container_number,departure_date) values('QA-IDEMPOTENT',current_date) returning id");
 const sql='select * from create_shipment_customs_document($1,null,$2,$3,\'erp-documents\',$4,\'application/pdf\',10,null,null,null)';
 const args=[shipment.id,'Packing List Cuba','first.pdf','qa/first.pdf'];
 const first=await one(sql,args),replay=await one(sql,args);assert.deepEqual(replay,first);
 assert.equal(Number((await one('select count(*) from documents')).count),1);
 const second=await one(sql,[shipment.id,'Packing List Cuba','second.pdf','qa/second.pdf']);
 assert.equal(second.document_version,2);
 assert.deepEqual(await one(sql,args),first,'Late replay keeps the original historical version');
 assert.equal((await one('select superseded_by_document_id from documents where id=$1',[first.document_id])).superseded_by_document_id,second.document_id);
 await assert.rejects(one(sql,[shipment.id,'Packing List Cuba','changed.pdf','qa/first.pdf']),/CUBA_DOCUMENT_UPLOAD_CONFLICT/);
 await assert.rejects(one(sql,[shipment.id,'Commercial Invoice Cuba','first.pdf','qa/first.pdf']),/CUBA_DOCUMENT_UPLOAD_CONFLICT/);
 await one('select * from soft_delete_shipment_customs_document($1,null,null)',[second.document_id]);
 await assert.rejects(one(sql,[shipment.id,'Packing List Cuba','second.pdf','qa/second.pdf']),/CUBA_DOCUMENT_ALREADY_DELETED/);
 assert.equal(Number((await one('select count(*) from documents')).count),2);
 const grants=await one("select has_function_privilege('anon','create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text)','execute') as anon,has_function_privilege('authenticated','create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text)','execute') as authenticated,has_function_privilege('service_role','create_shipment_customs_document(uuid,uuid,text,text,text,text,text,bigint,text,uuid,text)','execute') as service");
 assert.deepEqual(grants,{anon:false,authenticated:false,service:true});
 console.log('Document upload idempotency: replay, version history, conflicting metadata, deleted object and grants passed (isolated PostgreSQL semantics)');
}finally{await db.close();}
