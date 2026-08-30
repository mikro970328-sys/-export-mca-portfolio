import crypto from 'node:crypto';
import { authorizeAdmin, fail, ok, readJson, supabase, writeAudit } from './_lib.js';

const BUCKET = 'erp-documents';
const MAX_BYTES = 25 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMS_TYPES = Object.freeze({
  packing_list_cuba: 'Packing List Cuba',
  'packing list cuba': 'Packing List Cuba',
  commercial_invoice_cuba: 'Commercial Invoice Cuba',
  'commercial invoice cuba': 'Commercial Invoice Cuba',
  'factura comercial cuba': 'Commercial Invoice Cuba'
});
const ALLOWED_MIME = new Set([
  'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg','image/png','image/webp'
]);
const MIME_BY_EXT = {
  pdf:'application/pdf',doc:'application/msword',docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls:'application/vnd.ms-excel',xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webp:'image/webp'
};

const cleanText = (value,max=1000) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max);
const rpcRow = value => Array.isArray(value) ? (value[0] || null) : (value || null);
function cleanUuid(value,label='Identificador') { const id=String(value||'').trim();if(!UUID_RE.test(id))throw new Error(`${label} inválido`);return id; }
function cleanFileName(value) { const fileName=String(value||'').replace(/[\\/]+/g,'-').replace(/[\u0000-\u001f\u007f]+/g,' ').replace(/\s+/g,' ').trim().slice(0,180);if(!fileName)throw new Error('Nombre de archivo inválido');return fileName; }
function extension(fileName) { return String(fileName||'').toLowerCase().match(/\.([a-z0-9]{1,8})$/)?.[1] || ''; }
function normalizedMime(fileName,provided) { const raw=String(provided||'').trim().toLowerCase(),mime=ALLOWED_MIME.has(raw)?raw:MIME_BY_EXT[extension(fileName)];if(!mime||!ALLOWED_MIME.has(mime))throw new Error('Tipo de archivo no permitido. Usa PDF, Word, Excel, JPG, PNG o WEBP.');return mime; }
function validSize(value) { const size=Number(value||0);if(!Number.isFinite(size)||size<=0)throw new Error('El archivo está vacío');if(size>MAX_BYTES)throw new Error('El archivo supera el límite de 25 MB');return Math.trunc(size); }
function canonicalTypeOrNull(value) { return CUSTOMS_TYPES[cleanText(value,80).toLowerCase()] || null; }
function canonicalType(value) { const canonical=canonicalTypeOrNull(value);if(!canonical)throw new Error('Selecciona Packing List Cuba o Commercial Invoice Cuba');return canonical; }
function storageConfig() { const url=String(process.env.SUPABASE_URL||'').replace(/\/$/,''),key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error('SUPABASE_CONFIG_MISSING');return {root:`${url}/storage/v1`,key}; }
function encodePath(path) { return String(path||'').split('/').map(encodeURIComponent).join('/'); }
async function signedUpload(path) { const {root,key}=storageConfig();const response=await fetch(`${root}/object/upload/sign/${BUCKET}/${encodePath(path)}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:'{}'}),data=await response.json().catch(()=>({}));if(!response.ok||!data.url)throw new Error('No se pudo preparar la carga del documento');return String(data.url).startsWith('http')?data.url:`${root}${data.url}`; }
async function signedPreview(path) { const {root,key}=storageConfig();const response=await fetch(`${root}/object/sign/${BUCKET}/${encodePath(path)}`,{method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({expiresIn:3600})}),data=await response.json().catch(()=>({}));if(!response.ok||!data.signedURL)return null;return String(data.signedURL).startsWith('http')?data.signedURL:`${root}${data.signedURL}`; }
async function deleteObject(path) { const {root,key}=storageConfig();const response=await fetch(`${root}/object/${BUCKET}/${encodePath(path)}`,{method:'DELETE',headers:{apikey:key,Authorization:`Bearer ${key}`}});if(!response.ok&&response.status!==404)throw new Error('No se pudo borrar el archivo del almacenamiento'); }
async function getShipment(id) { const shipmentId=cleanUuid(id,'Contenedor');const rows=await supabase('shipments',{query:`?select=id,client_id,container_number,active,operational_status,last_status,departure_date,delivered_at&id=eq.${encodeURIComponent(shipmentId)}&limit=1`});if(!rows?.[0])throw new Error('Contenedor no encontrado');return rows[0]; }
async function getReadiness(id) { const rows=await supabase('shipment_customs_document_readiness',{query:`?select=*&shipment_id=eq.${encodeURIComponent(id)}&limit=1`});return rows?.[0]||null; }
async function getDocument(id) { const rows=await supabase('documents',{query:`?select=id,shipment_id,client_id,document_type,file_name,storage_bucket,storage_path,mime_type,file_size_bytes,version,notes,generated,uploaded_by_admin_id,uploaded_by_username,created_at,superseded_at,superseded_by_document_id,deleted_at,deleted_by_admin_id,deleted_by_username&id=eq.${encodeURIComponent(id)}&limit=1`});return rows?.[0]||null; }
async function listDocuments(shipmentId) {
  const rows=await supabase('documents',{query:`?select=id,shipment_id,client_id,document_type,file_name,storage_bucket,storage_path,mime_type,file_size_bytes,version,notes,generated,uploaded_by_admin_id,uploaded_by_username,created_at,superseded_at,superseded_by_document_id,deleted_at,deleted_by_admin_id,deleted_by_username&shipment_id=eq.${encodeURIComponent(shipmentId)}&generated=eq.false&order=version.desc,created_at.desc&limit=200`})||[];
  const official=rows.filter(row=>canonicalTypeOrNull(row.document_type)).map(row=>({...row,document_type:canonicalTypeOrNull(row.document_type),is_current:!row.deleted_at&&!row.superseded_at,state:row.deleted_at?'deleted':row.superseded_at?'superseded':'current'}));
  return Promise.all(official.map(async row=>({...row,signed_url:row.deleted_at?null:await signedPreview(row.storage_path)})));
}
async function payloadForShipment(shipment) { const [readiness,documents]=await Promise.all([getReadiness(shipment.id),listDocuments(shipment.id)]);return {shipment,readiness,documents}; }
async function prepare(body) {
  const shipment=await getShipment(body.shipment_id),documentType=canonicalType(body.document_type),fileName=cleanFileName(body.file_name),mimeType=normalizedMime(fileName,body.mime_type),fileSizeBytes=validSize(body.file_size_bytes),ext=extension(fileName);
  const storagePath=`shipments/${shipment.id}/cuba-customs/${Date.now()}-${crypto.randomUUID()}${ext?`.${ext}`:''}`;
  return {shipment,document_type:documentType,file_name:fileName,mime_type:mimeType,file_size_bytes:fileSizeBytes,notes:cleanText(body.notes,1000)||null,storage_path:storagePath,signed_url:await signedUpload(storagePath)};
}
async function finalize(admin,body) {
  const shipment=await getShipment(body.shipment_id),documentType=canonicalType(body.document_type),fileName=cleanFileName(body.file_name),mimeType=normalizedMime(fileName,body.mime_type),fileSizeBytes=validSize(body.file_size_bytes),storagePath=String(body.storage_path||'').trim(),expectedPrefix=`shipments/${shipment.id}/cuba-customs/`;
  if(!storagePath.startsWith(expectedPrefix)||storagePath.includes('..'))throw new Error('Ruta de documento inválida');
  try {
    const result=rpcRow(await supabase('rpc/create_shipment_customs_document',{method:'POST',body:{
      p_shipment_id:shipment.id,p_client_id:shipment.client_id||null,p_document_type:documentType,p_file_name:fileName,
      p_storage_bucket:BUCKET,p_storage_path:storagePath,p_mime_type:mimeType,p_file_size_bytes:fileSizeBytes,
      p_notes:cleanText(body.notes,1000)||null,p_uploaded_by_admin_id:admin.admin_id||null,p_uploaded_by_username:admin.username||null
    }}));
    if(!result?.document_id)throw new Error('No se pudo registrar el documento');
    const document=await getDocument(result.document_id);
    if(!document)throw new Error('No se pudo recuperar el documento registrado');
    await writeAudit(admin,'shipment_customs_document_uploaded','document',document.id,{shipment_id:shipment.id,container_number:shipment.container_number,document_type:documentType,file_name:fileName,version:result.document_version});
    return {...document,is_current:true,state:'current',signed_url:await signedPreview(storagePath)};
  } catch(error) {
    try { await deleteObject(storagePath); } catch {}
    throw error;
  }
}
async function discard(body) { const shipment=await getShipment(body.shipment_id),path=String(body.storage_path||'').trim(),expectedPrefix=`shipments/${shipment.id}/cuba-customs/`;if(!path.startsWith(expectedPrefix)||path.includes('..'))throw new Error('Ruta de documento inválida');await deleteObject(path); }
async function remove(admin,id) {
  const documentId=cleanUuid(id,'Documento'),document=await getDocument(documentId);
  if(!document||!document.shipment_id)throw new Error('Documento de contenedor no encontrado');
  if(document.generated)throw new Error('Un documento generado no puede eliminarse desde este flujo');
  canonicalType(document.document_type);
  if(document.deleted_at)throw new Error('Este documento ya fue eliminado');
  if(document.superseded_at)throw new Error('Una versión histórica no se elimina desde este flujo');
  if(document.storage_bucket!==BUCKET)throw new Error('Almacenamiento de documento inválido');
  const deleted=rpcRow(await supabase('rpc/soft_delete_shipment_customs_document',{method:'POST',body:{p_document_id:document.id,p_deleted_by_admin_id:admin.admin_id||null,p_deleted_by_username:admin.username||null}}));
  if(!deleted?.document_id)throw new Error('No se pudo eliminar el documento');
  let storageCleanupPending=false;
  try { await deleteObject(document.storage_path); } catch(error) { storageCleanupPending=true;console.error('[shipment-documents storage cleanup]',error); }
  await writeAudit(admin,'shipment_customs_document_deleted','document',document.id,{shipment_id:document.shipment_id,document_type:canonicalType(document.document_type),file_name:document.file_name,version:document.version,storage_cleanup_pending:storageCleanupPending});
  return {...document,deleted_at:new Date().toISOString(),state:'deleted',is_current:false,storage_cleanup_pending:storageCleanupPending};
}

export default async function handler(req,res) {
  const admin=await authorizeAdmin(req,res,req.method==='GET'?'documents.read':'documents.write');
  if(!admin)return;
  try {
    if(req.method==='GET') { const shipment=await getShipment(req.query?.shipment_id||req.query?.id);return ok(res,await payloadForShipment(shipment)); }
    if(req.method==='POST') {
      const body=await readJson(req),action=cleanText(body.action,40).toLowerCase();
      if(action==='prepare_upload') { const prepared=await prepare(body);return ok(res,{upload:{signed_url:prepared.signed_url,storage_path:prepared.storage_path,shipment_id:prepared.shipment.id,document_type:prepared.document_type,file_name:prepared.file_name,mime_type:prepared.mime_type,file_size_bytes:prepared.file_size_bytes,notes:prepared.notes}}); }
      if(action==='finalize_upload') { const document=await finalize(admin,body),shipment=await getShipment(document.shipment_id);return ok(res,{document,...await payloadForShipment(shipment)}); }
      if(action==='discard_upload') { await discard(body);return ok(res,{discarded:true}); }
      return fail(res,400,'Acción de documento inválida');
    }
    if(req.method==='DELETE') { const body=await readJson(req),document=await remove(admin,body.document_id),shipment=await getShipment(document.shipment_id);return ok(res,{deleted:true,document_id:document.id,storage_cleanup_pending:document.storage_cleanup_pending,...await payloadForShipment(shipment)}); }
    return fail(res,405,'Método no permitido');
  } catch(error) {
    console.error('[shipment-documents]',error);
    const raw=String(error.message||'');
    const friendly=raw.includes('CUBA_DOCUMENT_HISTORICAL_DELETE_FORBIDDEN')?'Una versión histórica no puede eliminarse desde este flujo.':raw.includes('CUBA_DOCUMENT_ALREADY_DELETED')?'Este documento ya fue eliminado.':raw.includes('CUBA_DOCUMENT_NOT_FOUND')?'Documento no encontrado.':raw;
    return fail(res,400,friendly||'No se pudieron procesar los documentos del contenedor');
  }
}
