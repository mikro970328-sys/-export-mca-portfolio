import crypto from 'node:crypto';
import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';

const BUCKET = 'erp-documents';
const MAX_BYTES = 25 * 1024 * 1024;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'image/webp',
  'text/plain'
]);

const MIME_BY_EXT = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  txt: 'text/plain'
};

function storageConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIG_MISSING');
  return { root: `${url}/storage/v1`, key };
}

function storageHeaders(key) {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json'
  };
}

function encodeStoragePath(path) {
  return String(path || '').split('/').map(segment => encodeURIComponent(segment)).join('/');
}

function cleanFileName(value) {
  const fileName = String(value || '')
    .replace(/[\\/]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  if (!fileName) throw new Error('Nombre de archivo inválido');
  return fileName;
}

function cleanDocumentType(value) {
  const result = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!result) throw new Error('Selecciona o escribe el tipo de documento');
  return result;
}

function cleanNotes(value) {
  return String(value || '')
    .replace(/[\u0000\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 1000) || null;
}

function fileExtension(fileName) {
  const match = String(fileName || '').toLowerCase().match(/\.([a-z0-9]{1,8})$/);
  return match ? match[1] : '';
}

function normalizedMime(fileName, provided) {
  const ext = fileExtension(fileName);
  const raw = String(provided || '').trim().toLowerCase();
  const mime = ALLOWED_MIME.has(raw) ? raw : MIME_BY_EXT[ext];
  if (!mime || !ALLOWED_MIME.has(mime)) {
    throw new Error('Tipo de archivo no permitido. Usa PDF, Word, Excel, JPG, PNG, WEBP o TXT.');
  }
  return mime;
}

function validateSize(value) {
  const size = Number(value || 0);
  if (!Number.isFinite(size) || size <= 0) throw new Error('El archivo está vacío');
  if (size > MAX_BYTES) throw new Error('El archivo supera el límite de 25 MB');
  return Math.trunc(size);
}

async function getShipment(id) {
  if (!UUID_RE.test(String(id || ''))) throw new Error('Contenedor inválido');
  const rows = await supabase('shipments', {
    query: `?select=id,client_id,container_number,booking_number,bol_number,carrier,product,quantity,quantity_unit,departure_date,operational_status&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Contenedor no encontrado');
  return rows[0];
}

async function createSignedUpload(storagePath) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/upload/sign/${BUCKET}/${encodeStoragePath(storagePath)}`, {
    method: 'POST',
    headers: storageHeaders(key),
    body: '{}'
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.url) {
    throw new Error(`STORAGE_SIGN_UPLOAD_${response.status}:${data?.message || data?.error || 'No se pudo preparar la carga'}`);
  }
  return String(data.url).startsWith('http') ? data.url : `${root}${data.url}`;
}

async function createSignedDownload(storagePath, fileName) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/sign/${BUCKET}/${encodeStoragePath(storagePath)}`, {
    method: 'POST',
    headers: storageHeaders(key),
    body: JSON.stringify({ expiresIn: 3600 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.signedURL) return null;
  const raw = String(data.signedURL).startsWith('http') ? data.signedURL : `${root}${data.signedURL}`;
  const url = new URL(raw);
  url.searchParams.set('download', fileName || 'documento');
  return url.toString();
}

async function deleteStorageObject(storagePath) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/${BUCKET}/${encodeStoragePath(storagePath)}`, {
    method: 'DELETE',
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`
    }
  });
  if (!response.ok && response.status !== 404) {
    throw new Error(`STORAGE_DELETE_${response.status}`);
  }
}

const documentSelect = [
  'id', 'shipment_id', 'client_id', 'document_type', 'file_name',
  'storage_bucket', 'storage_path', 'mime_type', 'file_size_bytes',
  'version', 'notes', 'uploaded_by_admin_id', 'uploaded_by_username', 'created_at'
].join(',');

async function getDocument(id) {
  if (!UUID_RE.test(String(id || ''))) throw new Error('Documento inválido');
  const rows = await supabase('documents', {
    query: `?select=${documentSelect}&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Documento no encontrado');
  return rows[0];
}

async function listDocuments(shipmentId) {
  const filter = shipmentId ? `&shipment_id=eq.${encodeURIComponent(shipmentId)}` : '';
  const documents = await supabase('documents', {
    query: `?select=${documentSelect}${filter}&order=created_at.desc&limit=500`
  }) || [];

  if (!shipmentId) return documents;

  return Promise.all(documents.map(async document => ({
    ...document,
    signed_url: await createSignedDownload(document.storage_path, document.file_name)
  })));
}

async function prepareUpload(body) {
  const shipment = await getShipment(body.shipment_id);
  const documentType = cleanDocumentType(body.document_type);
  const fileName = cleanFileName(body.file_name);
  const mimeType = normalizedMime(fileName, body.mime_type);
  const fileSizeBytes = validateSize(body.file_size_bytes);
  const notes = cleanNotes(body.notes);
  const extension = fileExtension(fileName);
  const suffix = extension ? `.${extension}` : '';
  const storagePath = `shipments/${shipment.id}/${Date.now()}-${crypto.randomUUID()}${suffix}`;
  const signedUrl = await createSignedUpload(storagePath);

  return {
    shipment,
    document_type: documentType,
    file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    notes,
    storage_path: storagePath,
    signed_url: signedUrl
  };
}

async function finalizeUpload(admin, body) {
  const shipment = await getShipment(body.shipment_id);
  const documentType = cleanDocumentType(body.document_type);
  const fileName = cleanFileName(body.file_name);
  const mimeType = normalizedMime(fileName, body.mime_type);
  const fileSizeBytes = validateSize(body.file_size_bytes);
  const notes = cleanNotes(body.notes);
  const storagePath = String(body.storage_path || '').trim();
  const expectedPrefix = `shipments/${shipment.id}/`;

  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) {
    throw new Error('Ruta de documento inválida');
  }

  const previous = await supabase('documents', {
    query: `?select=version&shipment_id=eq.${encodeURIComponent(shipment.id)}&document_type=eq.${encodeURIComponent(documentType)}&order=version.desc&limit=1`
  }) || [];
  const version = Number(previous[0]?.version || 0) + 1;

  try {
    const created = await supabase('documents', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        operation_id: null,
        client_id: shipment.client_id || null,
        shipment_id: shipment.id,
        document_type: documentType,
        file_name: fileName,
        storage_bucket: BUCKET,
        storage_path: storagePath,
        mime_type: mimeType,
        file_size_bytes: fileSizeBytes,
        version,
        notes,
        uploaded_by_admin_id: admin.admin_id,
        uploaded_by_username: admin.username || null
      }
    });

    const document = created?.[0];
    await writeAudit(admin, 'document_uploaded', 'document', document?.id || null, {
      shipment_id: shipment.id,
      container_number: shipment.container_number,
      document_type: documentType,
      file_name: fileName,
      version
    });

    return {
      ...document,
      signed_url: document ? await createSignedDownload(document.storage_path, document.file_name) : null
    };
  } catch (error) {
    try { await deleteStorageObject(storagePath); } catch {}
    throw error;
  }
}

async function discardUpload(body) {
  const shipment = await getShipment(body.shipment_id);
  const storagePath = String(body.storage_path || '').trim();
  const expectedPrefix = `shipments/${shipment.id}/`;
  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) {
    throw new Error('Ruta de documento inválida');
  }
  await deleteStorageObject(storagePath);
  return true;
}

async function deleteDocument(admin, documentId) {
  const document = await getDocument(documentId);
  if (document.storage_bucket !== BUCKET) throw new Error('Almacenamiento de documento inválido');

  let shipment = null;
  if (document.shipment_id) shipment = await getShipment(document.shipment_id);

  await deleteStorageObject(document.storage_path);

  const deleted = await supabase('documents', {
    method: 'DELETE',
    prefer: 'return=representation',
    query: `?id=eq.${encodeURIComponent(document.id)}`
  });
  if (!deleted?.[0]) throw new Error('No se pudo eliminar el registro del documento');

  await writeAudit(admin, 'document_deleted', 'document', document.id, {
    shipment_id: document.shipment_id || null,
    container_number: shipment?.container_number || null,
    document_type: document.document_type,
    file_name: document.file_name,
    version: document.version || 1
  });

  return document;
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const shipmentId = String(req.query?.shipment_id || '').trim();
      if (shipmentId) await getShipment(shipmentId);
      const documents = await listDocuments(shipmentId || null);
      return ok(res, { documents });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const action = String(body.action || '').trim();

      if (action === 'prepare_upload') {
        const prepared = await prepareUpload(body);
        return ok(res, {
          upload: {
            signed_url: prepared.signed_url,
            storage_path: prepared.storage_path,
            document_type: prepared.document_type,
            file_name: prepared.file_name,
            mime_type: prepared.mime_type,
            file_size_bytes: prepared.file_size_bytes,
            notes: prepared.notes
          }
        });
      }

      if (action === 'finalize_upload') {
        const document = await finalizeUpload(admin, body);
        return ok(res, { document });
      }

      if (action === 'discard_upload') {
        await discardUpload(body);
        return ok(res, { discarded: true });
      }

      return fail(res, 400, 'Acción de documento inválida');
    }

    if (req.method === 'DELETE') {
      const body = await readJson(req);
      const document = await deleteDocument(admin, body.document_id);
      return ok(res, { deleted: true, document_id: document.id });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('[documents]', error);
    return fail(res, 400, error.message || 'No se pudo procesar el documento');
  }
}
