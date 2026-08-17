import archiver from 'archiver';
import { Readable } from 'node:stream';
import { once } from 'node:events';
import { supabase, writeAudit } from './_lib.js';

const BUCKET = 'erp-documents';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const DOCUMENT_SELECT = [
  'id', 'operation_id', 'client_id', 'shipment_id', 'bol_number', 'shared_bl',
  'document_type', 'file_name', 'storage_bucket', 'storage_path',
  'mime_type', 'file_size_bytes', 'version', 'created_at'
].join(',');

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

function cleanUuid(value, label) {
  const text = String(value || '').trim();
  if (!UUID_RE.test(text)) throw new Error(`${label} inválido`);
  return text;
}

function safeSegment(value, fallback = 'Documento') {
  const text = String(value || '')
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 110);
  return text || fallback;
}

function fileExtension(fileName) {
  const match = String(fileName || '').match(/(\.[a-z0-9]{1,8})$/i);
  return match ? match[1] : '';
}

function baseFileName(fileName) {
  const extension = fileExtension(fileName);
  const raw = extension ? String(fileName || '').slice(0, -extension.length) : String(fileName || '');
  return safeSegment(raw, 'archivo');
}

function uniqueArchiveName(document, shipment, usedNames) {
  const folder = document.shipment_id
    ? `03_Contenedor_${safeSegment(shipment.container_number, 'Contenedor')}`
    : document.bol_number
      ? `02_BL_${safeSegment(shipment.bol_number, 'B-L')}`
      : '01_Documentos_generales';

  const extension = fileExtension(document.file_name);
  const type = safeSegment(document.document_type, 'Documento');
  const original = baseFileName(document.file_name);
  const version = Number(document.version || 1);
  const stem = `${type}__${original}__v${version}`.slice(0, 180);
  let candidate = `${folder}/${stem}${extension}`;
  let suffix = 2;
  while (usedNames.has(candidate.toLowerCase())) {
    candidate = `${folder}/${stem}_${suffix}${extension}`;
    suffix += 1;
  }
  usedNames.add(candidate.toLowerCase());
  return candidate;
}

async function getShipment(shipmentId) {
  const id = cleanUuid(shipmentId, 'Contenedor');
  const rows = await supabase('shipments', {
    query: `?select=id,operation_id,client_id,container_number,bol_number&id=eq.${encodeURIComponent(id)}&limit=1`
  });
  const shipment = rows?.[0];
  if (!shipment) throw new Error('Contenedor no encontrado');
  if (!shipment.operation_id) throw new Error('Este contenedor todavía no pertenece a un expediente');
  return shipment;
}

async function getOperation(operationId) {
  const rows = await supabase('operations', {
    query: `?select=id,operation_code,client_id&id=eq.${encodeURIComponent(operationId)}&limit=1`
  });
  const operation = rows?.[0];
  if (!operation) throw new Error('Expediente no encontrado');
  return operation;
}

async function selectDocuments(query) {
  return await supabase('documents', { query: `?select=${DOCUMENT_SELECT}${query}&order=created_at.asc&limit=1000` }) || [];
}

async function listApplicableDocuments(shipment) {
  const operationId = encodeURIComponent(shipment.operation_id);
  const shipmentId = encodeURIComponent(shipment.id);
  const requests = [
    selectDocuments(`&operation_id=eq.${operationId}&shipment_id=is.null&bol_number=is.null`),
    selectDocuments(`&operation_id=eq.${operationId}&shipment_id=eq.${shipmentId}`)
  ];

  const bol = String(shipment.bol_number || '').trim();
  if (bol) {
    const encodedBol = encodeURIComponent(bol);
    requests.push(
      selectDocuments(`&operation_id=eq.${operationId}&shipment_id=is.null&bol_number=eq.${encodedBol}`),
      selectDocuments(`&shared_bl=eq.true&shipment_id=is.null&bol_number=eq.${encodedBol}`)
    );
  }

  const groups = await Promise.all(requests);
  const unique = new Map();
  groups.flat().forEach(document => {
    if (document?.id) unique.set(String(document.id), document);
  });
  return [...unique.values()];
}

async function createSignedDownload(storagePath) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/sign/${BUCKET}/${encodeStoragePath(storagePath)}`, {
    method: 'POST',
    headers: storageHeaders(key),
    body: JSON.stringify({ expiresIn: 600 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.signedURL) {
    throw new Error(`No se pudo preparar la descarga de un documento (${response.status})`);
  }
  return String(data.signedURL).startsWith('http') ? data.signedURL : `${root}${data.signedURL}`;
}

async function prepareEntries(documents, shipment) {
  const usedNames = new Set();
  const entries = [];
  for (const document of documents) {
    if (document.storage_bucket !== BUCKET || !document.storage_path) {
      throw new Error(`El documento ${document.file_name || document.id} tiene almacenamiento inválido`);
    }
    entries.push({
      document,
      archive_name: uniqueArchiveName(document, shipment, usedNames),
      signed_url: await createSignedDownload(document.storage_path)
    });
  }
  return entries;
}

function archiveFileName(shipment) {
  const container = safeSegment(shipment.container_number, 'Contenedor').replace(/\s+/g, '_');
  return `Documentos_${container}.zip`;
}

export async function streamContainerDocumentBundle(admin, shipmentId, res) {
  const shipment = await getShipment(shipmentId);
  const operation = await getOperation(shipment.operation_id);
  if (shipment.client_id && operation.client_id && String(shipment.client_id) !== String(operation.client_id)) {
    throw new Error('El contenedor no pertenece al cliente del expediente');
  }

  const documents = await listApplicableDocuments(shipment);
  if (!documents.length) throw new Error('Este contenedor todavía no tiene documentación para descargar');
  const entries = await prepareEntries(documents, shipment);

  await writeAudit(admin, 'container_documents_downloaded', 'shipment', shipment.id, {
    operation_id: operation.id,
    operation_code: operation.operation_code,
    client_id: operation.client_id,
    container_number: shipment.container_number || null,
    bol_number: shipment.bol_number || null,
    document_count: documents.length
  });

  const filename = archiveFileName(shipment);
  const asciiFilename = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, '');
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');

  const archive = archiver('zip', { zlib: { level: 6 } });
  archive.on('warning', error => {
    if (error?.code !== 'ENOENT') console.warn('[document-bundle]', error);
  });
  archive.on('error', error => {
    console.error('[document-bundle]', error);
    if (!res.destroyed) res.destroy(error);
  });
  archive.pipe(res);

  for (const entry of entries) {
    const response = await fetch(entry.signed_url);
    if (!response.ok || !response.body) {
      throw new Error(`No se pudo descargar ${entry.document.file_name || 'un documento'} desde el almacenamiento`);
    }
    archive.append(Readable.fromWeb(response.body), { name: entry.archive_name });
  }

  const finished = once(res, 'finish');
  await archive.finalize();
  await finished;
}
