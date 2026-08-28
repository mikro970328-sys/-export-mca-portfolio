import crypto from 'node:crypto';
import { fail, ok, readJson, requireAdmin, supabase, writeAudit } from './_lib.js';
import { buildCommercialInvoicePdf, buildPackingListPdf } from './_commercial-pdf.js';

const BUCKET = 'erp-documents';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const text = (value, max = 2000) => String(value ?? '').trim().slice(0, max);
const numeric = value => {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

function cleanUuid(value, label) {
  const id = text(value, 80);
  if (!UUID_RE.test(id)) throw new Error(`${label} inválido`);
  return id;
}

function safeFilePart(value) {
  return text(value, 120).replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'document';
}

function storageConfig() {
  const url = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_CONFIG_MISSING');
  return { root:`${url}/storage/v1`, key };
}

function storagePath(path) {
  return String(path || '').split('/').map(part => encodeURIComponent(part)).join('/');
}

async function uploadPdf(path, buffer) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/${BUCKET}/${storagePath(path)}`, {
    method:'POST',
    headers:{
      apikey:key,
      Authorization:`Bearer ${key}`,
      'Content-Type':'application/pdf',
      'cache-control':'3600',
      'x-upsert':'false'
    },
    body:buffer
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`STORAGE_GENERATED_UPLOAD_${response.status}:${data?.message || data?.error || 'No se pudo guardar el PDF'}`);
}

async function deletePdf(path) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/${BUCKET}/${storagePath(path)}`, {
    method:'DELETE',
    headers:{ apikey:key, Authorization:`Bearer ${key}` }
  });
  if (!response.ok && response.status !== 404) throw new Error(`STORAGE_GENERATED_DELETE_${response.status}`);
}

async function signedPreview(path) {
  const { root, key } = storageConfig();
  const response = await fetch(`${root}/object/sign/${BUCKET}/${storagePath(path)}`, {
    method:'POST',
    headers:{ apikey:key, Authorization:`Bearer ${key}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ expiresIn:3600 })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.signedURL) return null;
  return String(data.signedURL).startsWith('http') ? data.signedURL : `${root}${data.signedURL}`;
}

async function one(table, query, message) {
  const rows = await supabase(table, { query });
  if (!rows?.[0]) throw new Error(message);
  return rows[0];
}

async function optionalOne(table, query) {
  const rows = await supabase(table, { query });
  return rows?.[0] || null;
}

async function sourceDocuments(sourceType, sourceId) {
  const rows = await supabase('documents', {
    query:`?select=id,operation_id,client_id,shipment_id,load_id,bol_number,shared_bl,document_type,file_name,storage_bucket,storage_path,mime_type,file_size_bytes,version,notes,generated,source_type,source_id,content_sha256,generated_at,uploaded_by_admin_id,uploaded_by_username,created_at&generated=eq.true&source_type=eq.${encodeURIComponent(sourceType)}&source_id=eq.${encodeURIComponent(sourceId)}&order=version.desc&limit=100`
  }) || [];
  return Promise.all(rows.map(async row => ({ ...row, signed_url:await signedPreview(row.storage_path) })));
}

async function nextVersion(sourceType, sourceId, documentType) {
  const rows = await supabase('documents', {
    query:`?select=version&generated=eq.true&source_type=eq.${encodeURIComponent(sourceType)}&source_id=eq.${encodeURIComponent(sourceId)}&document_type=eq.${encodeURIComponent(documentType)}&order=version.desc&limit=1`
  }) || [];
  return Number(rows[0]?.version || 0) + 1;
}

async function getInvoiceSource(invoiceId) {
  const invoice = await one('invoices', `?select=id,invoice_number,sales_order_id,operation_id,client_id,issue_date,due_date,currency,status,notes&id=eq.${encodeURIComponent(invoiceId)}&limit=1`, 'Factura no encontrada');
  if (invoice.status !== 'issued') throw new Error('La Factura Comercial solo se genera desde una factura emitida.');

  const [client, order, items, financial] = await Promise.all([
    one('clients', `?select=id,name,company,mipyme_name,email,phone&id=eq.${encodeURIComponent(invoice.client_id)}&limit=1`, 'Cliente de la factura no encontrado'),
    one('sales_orders', `?select=id,so_number,importer_id,customer_reference&id=eq.${encodeURIComponent(invoice.sales_order_id)}&limit=1`, 'Sales Order de la factura no encontrada'),
    supabase('invoice_items', { query:`?select=id,product_id,description,quantity,unit,unit_price,line_total,notes,product:products(id,sku,name,brand,hs_code,country_of_origin)&invoice_id=eq.${encodeURIComponent(invoice.id)}&order=created_at.asc&limit=1000` }),
    one('invoice_financial_progress', `?select=invoice_id,currency,subtotal,tax_total,total&invoice_id=eq.${encodeURIComponent(invoice.id)}&limit=1`, 'La factura no tiene total financiero consolidado')
  ]);

  if (!items?.length) throw new Error('La factura emitida no tiene líneas.');
  if (items.some(item => numeric(item.line_total) == null || numeric(item.unit_price) == null || numeric(item.quantity) == null)) {
    throw new Error('La factura tiene una línea sin importe consolidado.');
  }
  if (text(financial.currency, 3) !== text(invoice.currency, 3)) throw new Error('La moneda consolidada de la factura no coincide.');
  if (numeric(financial.total) == null) throw new Error('La factura no tiene total consolidado.');

  const [importer, operation] = await Promise.all([
    order.importer_id ? optionalOne('importers', `?select=id,name,legal_name,address,country,email,phone&id=eq.${encodeURIComponent(order.importer_id)}&limit=1`) : null,
    invoice.operation_id ? optionalOne('operations', `?select=id,operation_code,incoterm,origin_port,destination_port,vessel_name,voyage_number,booking_number,bol_number,container_number&id=eq.${encodeURIComponent(invoice.operation_id)}&limit=1`) : null
  ]);

  const clientName = client.company || client.mipyme_name || client.name;
  const importerName = importer?.legal_name || importer?.name || null;
  const importerAddress = [importer?.address, importer?.country].filter(Boolean).join(', ') || null;

  return {
    source_type:'invoice',
    source_id:invoice.id,
    document_type:'Factura comercial',
    fileBase:`Commercial-Invoice-${safeFilePart(invoice.invoice_number)}`,
    scope:{ operation_id:invoice.operation_id || null, client_id:invoice.client_id, shipment_id:null, load_id:null, bol_number:null, shared_bl:false },
    audit_action:'commercial_invoice_generated',
    pdfData:{
      invoice_number:invoice.invoice_number,
      issue_date:String(invoice.issue_date || '').slice(0, 10),
      currency:invoice.currency,
      customer_reference:order.customer_reference || null,
      client_name:clientName,
      client_email:client.email || null,
      client_phone:client.phone || null,
      importer_name:importerName,
      importer_address:importerAddress,
      operation_code:operation?.operation_code || null,
      incoterm:operation?.incoterm || null,
      origin_port:operation?.origin_port || null,
      destination_port:operation?.destination_port || null,
      items:items.map(item => ({
        sku:item.product?.sku || null,
        description:item.description || item.product?.name || 'Producto',
        quantity:item.quantity,
        unit:item.unit,
        unit_price:item.unit_price,
        line_total:item.line_total
      })),
      total:financial.total,
      notes:invoice.notes || null
    }
  };
}

async function getPackingSource(loadId) {
  const load = await one('loads', `?select=id,load_number,client_id,importer_id,shipment_id,status,loaded_at,dispatched_at,notes&id=eq.${encodeURIComponent(loadId)}&limit=1`, 'Cargue no encontrado');
  if (!['loaded','dispatched'].includes(load.status)) throw new Error('El Packing List final requiere un Cargue marcado como Loaded o Dispatched.');
  if (!load.shipment_id) throw new Error('Asigna un contenedor al Cargue antes de generar el Packing List.');

  const shipment = await one('shipments', `?select=id,client_id,importer_id,operation_id,container_number,booking_number,bol_number,carrier,departure_date&id=eq.${encodeURIComponent(load.shipment_id)}&limit=1`, 'Contenedor del Cargue no encontrado');
  const clientId = load.client_id || shipment.client_id || null;
  const importerId = load.importer_id || shipment.importer_id || null;

  const [client, importer, operation, items, trace] = await Promise.all([
    clientId ? optionalOne('clients', `?select=id,name,company,mipyme_name,email,phone&id=eq.${encodeURIComponent(clientId)}&limit=1`) : null,
    importerId ? optionalOne('importers', `?select=id,name,legal_name,address,country,email,phone&id=eq.${encodeURIComponent(importerId)}&limit=1`) : null,
    shipment.operation_id ? optionalOne('operations', `?select=id,operation_code,incoterm,origin_port,destination_port,vessel_name,voyage_number,booking_number,bol_number,container_number&id=eq.${encodeURIComponent(shipment.operation_id)}&limit=1`) : null,
    supabase('load_items', { query:`?select=id,product_id,planned_quantity,planned_pallets,unit,notes,product:products(id,sku,name,brand,hs_code,country_of_origin,unit_weight_kg,package_format)&load_id=eq.${encodeURIComponent(load.id)}&order=created_at.asc&limit=1000` }),
    supabase('load_traceability_sources', { query:`?select=load_item_id,lot_number,receipt_number,allocated_quantity,allocated_pallets&load_id=eq.${encodeURIComponent(load.id)}&order=receipt_number.asc&limit=5000` })
  ]);

  if (!items?.length) throw new Error('El Cargue no tiene mercancía.');
  const lotsByItem = new Map();
  for (const row of trace || []) {
    if (!row.load_item_id || !row.lot_number) continue;
    if (!lotsByItem.has(row.load_item_id)) lotsByItem.set(row.load_item_id, new Set());
    lotsByItem.get(row.load_item_id).add(text(row.lot_number, 100));
  }

  const pdfItems = items.map(item => {
    const quantityValue = numeric(item.planned_quantity);
    const unitWeight = numeric(item.product?.unit_weight_kg);
    const lots = [...(lotsByItem.get(item.id) || [])];
    const baseDescription = [item.product?.brand, item.product?.name].filter(Boolean).join(' ') || 'Producto';
    const details = [item.product?.hs_code ? `HS ${item.product.hs_code}` : null, item.product?.country_of_origin ? `Origin ${item.product.country_of_origin}` : null, lots.length ? `Lot ${lots.join(', ')}` : null].filter(Boolean);
    return {
      sku:item.product?.sku || null,
      description:details.length ? `${baseDescription} - ${details.join(' - ')}` : baseDescription,
      quantity:item.planned_quantity,
      pallets:item.planned_pallets,
      unit:item.unit,
      package_format:item.product?.package_format || null,
      net_weight_kg:quantityValue != null && unitWeight != null ? quantityValue * unitWeight : null
    };
  });

  const totalPallets = pdfItems.reduce((sum, item) => sum + (numeric(item.pallets) || 0), 0);
  const weightsComplete = pdfItems.every(item => numeric(item.quantity) === 0 || item.net_weight_kg != null);
  const totalNetWeight = weightsComplete ? pdfItems.reduce((sum, item) => sum + (numeric(item.net_weight_kg) || 0), 0) : null;
  const clientName = client ? (client.company || client.mipyme_name || client.name) : null;
  const importerName = importer?.legal_name || importer?.name || null;
  const importerAddress = [importer?.address, importer?.country].filter(Boolean).join(', ') || null;

  return {
    source_type:'load',
    source_id:load.id,
    document_type:'Packing List',
    fileBase:`Packing-List-${safeFilePart(load.load_number)}`,
    scope:{ operation_id:shipment.operation_id || null, client_id:clientId, shipment_id:shipment.id, load_id:load.id, bol_number:shipment.bol_number || null, shared_bl:false },
    audit_action:'packing_list_generated',
    pdfData:{
      load_number:load.load_number,
      container_number:shipment.container_number,
      bol_number:shipment.bol_number || null,
      client_name:clientName,
      importer_name:importerName,
      importer_address:importerAddress,
      carrier:shipment.carrier || null,
      booking_number:shipment.booking_number || operation?.booking_number || null,
      origin_port:operation?.origin_port || null,
      destination_port:operation?.destination_port || null,
      items:pdfItems,
      total_pallets:totalPallets,
      total_net_weight_kg:totalNetWeight,
      notes:load.notes || null
    }
  };
}

async function generateDocument(admin, source) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const version = await nextVersion(source.source_type, source.source_id, source.document_type);
    const buffer = source.source_type === 'invoice'
      ? buildCommercialInvoicePdf({ ...source.pdfData, version })
      : buildPackingListPdf({ ...source.pdfData, version });
    const hash = crypto.createHash('sha256').update(buffer).digest('hex');
    const fileName = `${source.fileBase}-v${version}.pdf`;
    const path = `generated/${source.source_type}/${source.source_id}/${Date.now()}-${crypto.randomUUID()}.pdf`;
    await uploadPdf(path, buffer);

    try {
      const created = await supabase('documents', {
        method:'POST',
        prefer:'return=representation',
        body:{
          ...source.scope,
          document_type:source.document_type,
          file_name:fileName,
          storage_bucket:BUCKET,
          storage_path:path,
          mime_type:'application/pdf',
          file_size_bytes:buffer.length,
          version,
          notes:`Generado automáticamente desde ${source.source_type === 'invoice' ? 'Factura' : 'Cargue'} ${source.source_id}.`,
          uploaded_by_admin_id:admin.admin_id,
          uploaded_by_username:admin.username || null,
          generated:true,
          source_type:source.source_type,
          source_id:source.source_id,
          content_sha256:hash,
          generated_at:new Date().toISOString()
        }
      });
      const document = created?.[0];
      if (!document?.id) throw new Error('No se pudo registrar el documento generado.');
      await writeAudit(admin, source.audit_action, 'document', document.id, {
        source_type:source.source_type,
        source_id:source.source_id,
        document_type:source.document_type,
        version,
        file_name:fileName,
        content_sha256:hash,
        operation_id:source.scope.operation_id || null,
        shipment_id:source.scope.shipment_id || null,
        load_id:source.scope.load_id || null
      });
      return { ...document, signed_url:await signedPreview(path) };
    } catch (error) {
      try { await deletePdf(path); } catch {}
      const raw = String(error?.message || '');
      if ((raw.includes('23505') || raw.toLowerCase().includes('duplicate')) && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error('No se pudo asignar una versión al documento.');
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const sourceType = text(req.query?.source_type, 20).toLowerCase();
      const sourceId = cleanUuid(req.query?.source_id, 'Fuente');
      if (!['invoice','load'].includes(sourceType)) return fail(res, 400, 'Tipo de fuente inválido');
      return ok(res, { documents:await sourceDocuments(sourceType, sourceId) });
    }

    if (req.method !== 'POST') return fail(res, 405, 'Método no permitido');
    const body = await readJson(req);
    const action = text(body.action, 40).toLowerCase();

    if (action === 'generate_invoice') {
      const source = await getInvoiceSource(cleanUuid(body.invoice_id, 'Factura'));
      return ok(res, { document:await generateDocument(admin, source) });
    }

    if (action === 'generate_packing_list') {
      const source = await getPackingSource(cleanUuid(body.load_id, 'Cargue'));
      return ok(res, { document:await generateDocument(admin, source) });
    }

    return fail(res, 400, 'Acción de documento comercial inválida');
  } catch (error) {
    const raw = String(error?.message || 'No se pudo generar el documento comercial');
    console.error('[commercial-documents]', error);
    const translated = raw.includes('GENERATED_DOCUMENT_IMMUTABLE')
      ? 'Los documentos generados son inmutables; genera una nueva versión.'
      : raw;
    return fail(res, 400, translated);
  }
}
