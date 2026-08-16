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
  const text = String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (!text) throw new Error('Selecciona o escribe el tipo de documento');
  return text;
}

function cleanNotes(value) {
  return String(value || '')
    .replace(/[\u0000\u000b\u000c\u000e-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, 1000) || null;
}

function cleanBol(value) {
  return String(value || '')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120) || null;
}

function cleanUuid(value, label) {
  const text = String(value || '').trim();
  if (!text) return null;
  if (!UUID_RE.test(text)) throw new Error(`${label} inválido`);
  return text;
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

async function getOperation(id) {
  if (!UUID_RE.test(String(id || ''))) throw new Error('Expediente inválido');
  const rows = await supabase('operations', {
    query: `?select=id,operation_code,client_id,status&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Expediente no encontrado');
  return rows[0];
}

async function getOperationBols(operationId) {
  const rows = await supabase('shipments', {
    query: `?select=bol_number&operation_id=eq.${encodeURIComponent(operationId)}&bol_number=not.is.null&limit=1000`
  }) || [];
  return [...new Set(rows.map(row => cleanBol(row.bol_number)).filter(Boolean))];
}

async function getBolRelation(bolNumber) {
  const bol = cleanBol(bolNumber);
  if (!bol) return { bol_number: null, containers: 0, clients: 0, operations: 0, shared: false, shipments: [] };
  const rows = await supabase('shipments', {
    query: `?select=id,client_id,operation_id,container_number,bol_number,active&bol_number=eq.${encodeURIComponent(bol)}&limit=1000`
  }) || [];
  const clients = new Set(rows.map(row => row.client_id).filter(Boolean).map(String));
  const operations = new Set(rows.map(row => row.operation_id).filter(Boolean).map(String));
  return {
    bol_number: bol,
    containers: rows.length,
    clients: clients.size,
    operations: operations.size,
    shared: clients.size > 1,
    shipments: rows
  };
}

async function validateBol(operationId, bolNumber) {
  if (!bolNumber) return null;
  const rows = await supabase('shipments', {
    query: `?select=id,bol_number&operation_id=eq.${encodeURIComponent(operationId)}&bol_number=eq.${encodeURIComponent(bolNumber)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Ese B/L no pertenece al expediente');
  return rows[0].bol_number;
}

async function validateShipment(operation, shipmentId) {
  if (!shipmentId) return null;
  const id = cleanUuid(shipmentId, 'Contenedor');
  const rows = await supabase('shipments', {
    query: `?select=id,operation_id,client_id,container_number,bol_number&id=eq.${encodeURIComponent(id)}&operation_id=eq.${encodeURIComponent(operation.id)}&limit=1`
  });
  const shipment = rows?.[0];
  if (!shipment) throw new Error('Ese contenedor no pertenece al expediente');
  if (shipment.client_id && operation.client_id && shipment.client_id !== operation.client_id) {
    throw new Error('El contenedor no pertenece al cliente del expediente');
  }
  return shipment;
}

async function resolveScope(operation, body) {
  const shipmentId = cleanUuid(body.shipment_id, 'Contenedor');
  const requestedBol = cleanBol(body.bol_number);
  if (shipmentId && requestedBol) throw new Error('Selecciona un B/L o un contenedor específico, no ambos');

  if (shipmentId) {
    const shipment = await validateShipment(operation, shipmentId);
    return { shipment_id: shipment.id, bol_number: null, shipment };
  }

  if (requestedBol) {
    const bolNumber = await validateBol(operation.id, requestedBol);
    return { shipment_id: null, bol_number: bolNumber, shipment: null };
  }

  return { shipment_id: null, bol_number: null, shipment: null };
}

async function validateSharedScope(scope, requestedShared) {
  const sharedBl = Boolean(requestedShared);
  if (!sharedBl) return { shared_bl: false, relation: null };
  if (!scope.bol_number || scope.shipment_id) throw new Error('Solo se puede compartir un documento asociado a un B/L');
  const relation = await getBolRelation(scope.bol_number);
  if (!relation.shared) throw new Error('Ese B/L no está compartido entre clientes');
  return { shared_bl: true, relation };
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

const DOCUMENT_SELECT = [
  'id', 'operation_id', 'client_id', 'shipment_id', 'bol_number', 'shared_bl',
  'document_type', 'file_name', 'storage_bucket', 'storage_path',
  'mime_type', 'file_size_bytes', 'version', 'notes',
  'uploaded_by_admin_id', 'uploaded_by_username', 'created_at'
].join(',');

async function getDocument(id) {
  if (!UUID_RE.test(String(id || ''))) throw new Error('Documento inválido');
  const rows = await supabase('documents', {
    query: `?select=${DOCUMENT_SELECT}&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  if (!rows?.[0]) throw new Error('Documento no encontrado');
  return rows[0];
}

async function listOwnedDocuments(operationId) {
  return await supabase('documents', {
    query: `?select=${DOCUMENT_SELECT}&operation_id=eq.${encodeURIComponent(operationId)}&order=created_at.desc&limit=1000`
  }) || [];
}

async function listSharedDocumentsForOperation(operationId) {
  const bols = await getOperationBols(operationId);
  if (!bols.length) return [];
  const found = [];
  for (const bol of bols) {
    const rows = await supabase('documents', {
      query: `?select=${DOCUMENT_SELECT}&shared_bl=eq.true&shipment_id=is.null&bol_number=eq.${encodeURIComponent(bol)}&order=created_at.desc&limit=1000`
    }) || [];
    found.push(...rows);
  }
  return found;
}

async function listDocuments(operationId) {
  if (!operationId) {
    return await supabase('documents', {
      query: `?select=${DOCUMENT_SELECT}&order=created_at.desc&limit=1000`
    }) || [];
  }

  const [owned, shared] = await Promise.all([
    listOwnedDocuments(operationId),
    listSharedDocumentsForOperation(operationId)
  ]);
  const unique = new Map();
  [...owned, ...shared].forEach(document => unique.set(String(document.id), document));
  return Promise.all([...unique.values()].map(async document => ({
    ...document,
    signed_url: await createSignedPreview(document.storage_path)
  })));
}

function scopeVersionFilter(scope) {
  if (scope.shipment_id) return `&shipment_id=eq.${encodeURIComponent(scope.shipment_id)}&bol_number=is.null`;
  if (scope.bol_number) return `&shipment_id=is.null&bol_number=eq.${encodeURIComponent(scope.bol_number)}`;
  return '&shipment_id=is.null&bol_number=is.null';
}

async function prepareUpload(body) {
  const operation = await getOperation(body.operation_id);
  const scope = await resolveScope(operation, body);
  const shared = await validateSharedScope(scope, body.shared_bl);
  const documentType = cleanDocumentType(body.document_type);
  const fileName = cleanFileName(body.file_name);
  const mimeType = normalizedMime(fileName, body.mime_type);
  const fileSizeBytes = validateSize(body.file_size_bytes);
  const notes = cleanNotes(body.notes);
  const extension = fileExtension(fileName);
  const suffix = extension ? `.${extension}` : '';
  const storagePath = `operations/${operation.id}/${Date.now()}-${crypto.randomUUID()}${suffix}`;
  const signedUrl = await createSignedUpload(storagePath);

  return {
    operation,
    shipment_id: scope.shipment_id,
    bol_number: scope.bol_number,
    shared_bl: shared.shared_bl,
    shared_context: shared.relation,
    document_type: documentType,
    file_name: fileName,
    mime_type: mimeType,
    file_size_bytes: fileSizeBytes,
    notes,
    storage_path: storagePath,
    signed_url: signedUrl
  };
}

async function nextVersion(operation, scope, documentType, sharedBl) {
  const query = sharedBl
    ? `?select=version&shared_bl=eq.true&shipment_id=is.null&bol_number=eq.${encodeURIComponent(scope.bol_number)}&document_type=eq.${encodeURIComponent(documentType)}&order=version.desc&limit=1`
    : `?select=version&operation_id=eq.${encodeURIComponent(operation.id)}&document_type=eq.${encodeURIComponent(documentType)}${scopeVersionFilter(scope)}&order=version.desc&limit=1`;
  const previous = await supabase('documents', { query }) || [];
  return Number(previous[0]?.version || 0) + 1;
}

async function finalizeUpload(admin, body) {
  const operation = await getOperation(body.operation_id);
  const scope = await resolveScope(operation, body);
  const shared = await validateSharedScope(scope, body.shared_bl);
  const documentType = cleanDocumentType(body.document_type);
  const fileName = cleanFileName(body.file_name);
  const mimeType = normalizedMime(fileName, body.mime_type);
  const fileSizeBytes = validateSize(body.file_size_bytes);
  const notes = cleanNotes(body.notes);
  const storagePath = String(body.storage_path || '').trim();
  const expectedPrefix = `operations/${operation.id}/`;

  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) throw new Error('Ruta de documento inválida');

  const version = await nextVersion(operation, scope, documentType, shared.shared_bl);

  try {
    const created = await supabase('documents', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        operation_id: operation.id,
        client_id: operation.client_id,
        shipment_id: scope.shipment_id,
        bol_number: scope.bol_number,
        shared_bl: shared.shared_bl,
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
    await writeAudit(admin, shared.shared_bl ? 'shared_bl_document_uploaded' : 'document_uploaded', 'document', document?.id || null, {
      operation_id: operation.id,
      operation_code: operation.operation_code,
      client_id: operation.client_id,
      shipment_id: scope.shipment_id,
      container_number: scope.shipment?.container_number || null,
      bol_number: scope.bol_number,
      shared_bl: shared.shared_bl,
      shared_clients: shared.relation?.clients || null,
      shared_containers: shared.relation?.containers || null,
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
  const operation = await getOperation(body.operation_id);
  const storagePath = String(body.storage_path || '').trim();
  const expectedPrefix = `operations/${operation.id}/`;
  if (!storagePath.startsWith(expectedPrefix) || storagePath.includes('..')) throw new Error('Ruta de documento inválida');
  await deleteStorageObject(storagePath);
}

async function deleteDocument(admin, documentId) {
  const document = await getDocument(documentId);
  if (document.storage_bucket !== BUCKET) throw new Error('Almacenamiento de documento inválido');

  const operation = document.operation_id ? await getOperation(document.operation_id) : null;
  await deleteStorageObject(document.storage_path);

  const deleted = await supabase('documents', {
    method: 'DELETE',
    prefer: 'return=representation',
    query: `?id=eq.${encodeURIComponent(document.id)}`
  });
  if (!deleted?.[0]) throw new Error('No se pudo eliminar el registro del documento');

  await writeAudit(admin, document.shared_bl ? 'shared_bl_document_deleted' : 'document_deleted', 'document', document.id, {
    operation_id: document.operation_id || null,
    operation_code: operation?.operation_code || null,
    client_id: document.client_id || null,
    shipment_id: document.shipment_id || null,
    bol_number: document.bol_number || null,
    shared_bl: Boolean(document.shared_bl),
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
      const operationId = String(req.query?.operation_id || '').trim();
      if (operationId) await getOperation(operationId);
      return ok(res, { documents: await listDocuments(operationId || null) });
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
            operation_id: prepared.operation.id,
            shipment_id: prepared.shipment_id,
            bol_number: prepared.bol_number,
            shared_bl: prepared.shared_bl,
            shared_context: prepared.shared_context,
            document_type: prepared.document_type,
            file_name: prepared.file_name,
            mime_type: prepared.mime_type,
            file_size_bytes: prepared.file_size_bytes,
            notes: prepared.notes
          }
        });
      }

      if (action === 'finalize_upload') return ok(res, { document: await finalizeUpload(admin, body) });

      if (action === 'discard_upload') {
        await discardUpload(body);
        return ok(res, { discarded: true });
      }

      return fail(res, 400, 'Acción de documento inválida');
    }

    if (req.method === 'DELETE') {
      const body = await readJson(req);
      const document = await deleteDocument(admin, body.document_id);
      return ok(res, { deleted: true, document_id: document.id, shared_bl: Boolean(document.shared_bl) });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('[documents]', error);
    return fail(res, 400, error.message || 'No se pudo procesar el documento');
  }
}
