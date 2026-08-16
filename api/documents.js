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

function requireUuid(value, label) {
  const id = String(value || '').trim();
  if (!UUID_RE.test(id)) throw new Error(`${label} inválido`);
  return id;
}

async function getClient(id) {
  const clientId = requireUuid(id, 'Cliente');
  const rows = await supabase('clients', {
    query: `?select=id,name,company,mipyme_name,importer_name,email,phone,created_at&id=eq.${encodeURIComponent(clientId)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Cliente no encontrado');
  return rows[0];
}

async function getShipment(id) {
  const shipmentId = requireUuid(id, 'Contenedor');
  const rows = await supabase('shipments', {
    query: `?select=id,client_id,container_number,booking_number,bol_number,carrier,product,quantity,quantity_unit,departure_date,operational_status,last_status&id=eq.${encodeURIComponent(shipmentId)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Contenedor no encontrado');
  return rows[0];
}

async function optionalShipmentForClient(clientId, shipmentId) {
  const raw = String(shipmentId || '').trim();
  if (!raw) return null;
  const shipment = await getShipment(raw);
  if (String(shipment.client_id || '') !== String(clientId)) {
    throw new Error('El contenedor seleccionado no pertenece a este cliente');
  }
  return shipment;
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

async function createSignedPreview(storagePath) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/sign/${BUCKET}/${encodeStoragePath(storagePath)}`, {
    method: 'POST',
    headers: storageHeaders(key),
    body: JSON.stringify({ expiresIn: 3600 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.signedURL) return null;
  return String(data.signedURL).startsWith('http') ? data.signedURL : `${root}${data.signedURL}`;
}

async function deleteStorageObject(storagePath) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/${BUCKET}/${encodeStoragePath(storagePath)}`, {
    method: 'DELETE',
    headers: { apikey: key, Authorization: `Bearer ${key}` }
  });
  if (!response.ok && response.status !== 404) throw new Error(`STORAGE_DELETE_${response.status}`);
}

const documentSelect = [
  'id', 'shipment_id', 'client_id', 'document_type', 'file_name',
  'storage_bucket', 'storage_path', 'mime_type', 'file_size_bytes',
  'version', 'notes', 'uploaded_by_admin_id', 'uploaded_by_username', 'created_at'
].join(',');

async function getDocument(id) {
  const documentId = requireUuid(id, 'Documento');
  const rows = await supabase('documents', {
    query: `?select=${documentSelect}&id=eq.${encodeURIComponent(documentId)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Documento no encontrado');
  return rows[0];
}

async function listDocuments(clientId) {
  const filter = clientId ? `&client_id=eq.${encodeURIComponent(clientId)}` : '';
  const documents = await supabase('documents', {
    query: `?select=${documentSelect}${filter}&order=created_at.desc&limit=500`
  }) || [];

  if (!clientId) return documents;
  return Promise.all(documents.map(async document => ({
    ...document,
    signed_url: await createSignedPreview(document.storage_path)
  })));
}

async function prepareUpload(body) {
  const client = await getClient(body.client_id);
  const shipment = await optionalShipmentForClient(client.id, body.shipment_id);
  const documentType = cleanDocumentType(body.document_type);
  const fileName = cleanFileName(body.file_name);
  const mimeType = normalizedMime(fileName, body.mime_type);
  const fileSizeBytes = validateSize(body.file_size_bytes);
  const notes = cleanNotes(body.notes);
  const extension = fileExtension(fileName);
  const suffix = extension ? `.${extension}` : '';
  const storagePath = `clients/${client.id}/${Date.now()}-${crypto.randomUUID()}${suffix}`;
  const signedUrl = await createSignedUpload(storagePath);

  return {
    client,
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
  const client = await getClient(body.client_id);
  const shipment = await optionalShipmentForClient(client.id, body.shipment_id);
  const documentType = cleanDocumentType(body.document_type);
  const fileName = cleanFileName(body.file_name);
  const mimeType = normalizedMime(fileName, body.mime_type);
  const fileSizeBytes = validateSize(body.file_size_bytes);
  const notes = cleanNotes(body.notes);
  const storagePath = String(body.storage_path || '').trim();
  const expectedPrefix = `clients/${client.id}/`;

  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) throw new Error('Ruta de documento inválida');

  const previous = await supabase('documents', {
    query: `?select=version&client_id=eq.${encodeURIComponent(client.id)}&document_type=eq.${encodeURIComponent(documentType)}&order=version.desc&limit=1`
  }) || [];
  const version = Number(previous[0]?.version || 0) + 1;

  try {
    const created = await supabase('documents', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        operation_id: null,
        client_id: client.id,
        shipment_id: shipment?.id || null,
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
      client_id: client.id,
      client_name: client.name || null,
      shipment_id: shipment?.id || null,
      container_number: shipment?.container_number || null,
      document_type: documentType,
      file_name: fileName,
      version
    });

    return {
      ...document,
      signed_url: document ? await createSignedPreview(document.storage_path) : null
    };
  } catch (error) {
    try { await deleteStorageObject(storagePath); } catch {}
    throw error;
  }
}

async function discardUpload(body) {
  const client = await getClient(body.client_id);
  const storagePath = String(body.storage_path || '').trim();
  const expectedPrefix = `clients/${client.id}/`;
  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) throw new Error('Ruta de documento inválida');
  await deleteStorageObject(storagePath);
  return true;
}

async function deleteDocument(admin, documentId) {
  const document = await getDocument(documentId);
  if (document.storage_bucket !== BUCKET) throw new Error('Almacenamiento de documento inválido');

  const client = document.client_id ? await getClient(document.client_id) : null;
  const shipment = document.shipment_id ? await getShipment(document.shipment_id) : null;

  await deleteStorageObject(document.storage_path);
  const deleted = await supabase('documents', {
    method: 'DELETE',
    prefer: 'return=representation',
    query: `?id=eq.${encodeURIComponent(document.id)}`
  });
  if (!deleted?.[0]) throw new Error('No se pudo eliminar el registro del documento');

  await writeAudit(admin, 'document_deleted', 'document', document.id, {
    client_id: document.client_id || null,
    client_name: client?.name || null,
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
      const clientId = String(req.query?.client_id || '').trim();
      if (clientId) await getClient(clientId);
      const documents = await listDocuments(clientId || null);
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
            client_id: prepared.client.id,
            shipment_id: prepared.shipment?.id || null,
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
