import { fail, normalizeContainer, ok, readJson, requireAdmin, sendWhatsApp, supabase, writeAudit } from './_lib.js';

const listSelect = [
  '*',
  'client:clients(id,name,company,phone,email)',
  'supplier:suppliers(id,name,email,phone)',
  'importer:importers(id,name,email,phone)',
  'shipment:shipments(id,container_number,booking_number,bol_number,carrier,operational_status)'
].join(',');

const detailSelect = [
  listSelect,
  'items:operation_items(id,product_id,description,quantity,unit,unit_cost,unit_price,net_weight_kg,gross_weight_kg,volume_m3,packages,product:products(id,name,sku,hs_code))',
  'invoices(id,invoice_number,issue_date,due_date,currency,subtotal,tax_total,total,paid_amount,status,notes)',
  'payments(id,invoice_id,client_id,amount,currency,payment_date,method,reference_number,status,notes)',
  'expenses(id,supplier_id,category,description,amount,currency,expense_date,reference_number,status)',
  'documents(id,document_type,file_name,storage_bucket,storage_path,mime_type,file_size_bytes,version,notes,created_at)'
].join(',');

function required(value, name) {
  if (!String(value || '').trim()) throw new Error(`${name}_REQUIRED`);
  return String(value).trim();
}

function cleanNullable(value) {
  const result = String(value ?? '').trim();
  return result || null;
}

function numeric(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

async function writeShipmentHistory(shipment, eventType, title, details = null, source = 'system') {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{
        shipment_id: shipment.id,
        client_id: shipment.client_id,
        event_type: eventType,
        title,
        details,
        source
      }]
    });
  } catch (error) {
    console.error('SHIPMENT_HISTORY_FAILED', error.message);
  }
}

async function createShipmentForOperation(operation, body, admin) {
  if (!operation?.id || !operation.container_number) return null;

  const containerNumber = normalizeContainer(operation.container_number);
  const existing = await supabase('shipments', {
    query: `?select=*&container_number=eq.${encodeURIComponent(containerNumber)}&limit=1`
  });

  let shipment = existing?.[0] || null;
  if (!shipment) {
    const created = await supabase('shipments', {
      method: 'POST',
      body: [{
        client_id: operation.client_id,
        container_number: containerNumber,
        booking_number: operation.booking_number,
        bol_number: operation.bol_number,
        carrier: cleanNullable(body.carrier),
        product: cleanNullable(body.product) || cleanNullable(body.items?.[0]?.description),
        active: true,
        last_status: 'Registrado',
        operational_status: 'Registrado',
        last_location: null,
        last_event_at: null
      }]
    });
    shipment = created?.[0] || null;

    if (shipment) {
      await writeShipmentHistory(shipment, 'created', 'Contenedor registrado', containerNumber);
      await writeAudit(admin, 'create', 'shipment', shipment.id, { container_number: containerNumber, operation_id: operation.id });
    }
  }

  if (!shipment) return null;

  await supabase('operations', {
    method: 'PATCH',
    query: `?id=eq.${encodeURIComponent(operation.id)}`,
    body: { shipment_id: shipment.id, container_number: containerNumber }
  });

  const clients = await supabase('clients', {
    query: `?select=id,name,phone&id=eq.${encodeURIComponent(operation.client_id)}&limit=1`
  });
  const client = clients?.[0];
  const contentSid = process.env.TWILIO_REGISTERED_CONTENT_SID;

  if (client?.phone && contentSid) {
    const existingNotifications = await supabase('notifications', {
      query: `?select=id&shipment_id=eq.${encodeURIComponent(shipment.id)}&event_type=eq.registered&limit=1`
    });

    if (!existingNotifications?.length) {
      try {
        const sent = await sendWhatsApp({
          to: client.phone,
          contentSid,
          variables: { '1': client.name, '2': containerNumber }
        });

        await supabase('notifications', {
          method: 'POST',
          body: [{
            shipment_id: shipment.id,
            client_id: client.id,
            event_type: 'registered',
            channel: 'whatsapp',
            recipient: client.phone,
            status: sent.status || 'queued',
            provider_message_id: sent.sid,
            template_sid: contentSid,
            payload: { container_number: containerNumber, operation_id: operation.id },
            sent_at: new Date().toISOString()
          }]
        });
        await writeShipmentHistory(shipment, 'notification_sent', 'WhatsApp de contenedor registrado enviado', sent.sid);
      } catch (error) {
        try {
          await supabase('notifications', {
            method: 'POST',
            body: [{
              shipment_id: shipment.id,
              client_id: client.id,
              event_type: 'registered',
              channel: 'whatsapp',
              recipient: client.phone,
              status: 'failed',
              template_sid: contentSid,
              payload: { container_number: containerNumber, operation_id: operation.id },
              error_message: error.message
            }]
          });
        } catch {}
        await writeShipmentHistory(shipment, 'notification_failed', 'Falló WhatsApp de contenedor registrado', error.message);
      }
    }
  }

  return shipment;
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;

  try {
    if (req.method === 'GET') {
      const id = cleanNullable(req.query?.id);
      const select = id ? detailSelect : listSelect;
      const query = id
        ? `?select=${encodeURIComponent(select)}&id=eq.${encodeURIComponent(id)}&limit=1`
        : `?select=${encodeURIComponent(select)}&order=created_at.desc`;
      const rows = await supabase('operations', { query });
      return ok(res, id ? { operation: rows?.[0] || null } : { operations: rows || [] });
    }

    if (req.method === 'POST') {
      const body = await readJson(req);
      const operation = {
        client_id: required(body.client_id, 'CLIENT'),
        supplier_id: cleanNullable(body.supplier_id),
        importer_id: cleanNullable(body.importer_id),
        shipment_id: cleanNullable(body.shipment_id),
        operation_type: cleanNullable(body.operation_type) || 'container',
        status: cleanNullable(body.status) || 'draft',
        currency: cleanNullable(body.currency) || 'USD',
        incoterm: cleanNullable(body.incoterm),
        origin_port: cleanNullable(body.origin_port),
        destination_port: cleanNullable(body.destination_port),
        vessel_name: cleanNullable(body.vessel_name),
        voyage_number: cleanNullable(body.voyage_number),
        booking_number: cleanNullable(body.booking_number),
        bol_number: cleanNullable(body.bol_number),
        container_number: cleanNullable(body.container_number),
        seal_number: cleanNullable(body.seal_number),
        etd: cleanNullable(body.etd),
        eta: cleanNullable(body.eta),
        notes: cleanNullable(body.notes),
        created_by: admin.admin_id
      };
      const created = await supabase('operations', { method: 'POST', body: operation, prefer: 'return=representation' });
      const row = created?.[0];

      if (Array.isArray(body.items) && row?.id) {
        const items = body.items
          .filter(item => String(item.description || '').trim())
          .map(item => ({
            operation_id: row.id,
            product_id: cleanNullable(item.product_id),
            description: required(item.description, 'ITEM_DESCRIPTION'),
            quantity: numeric(item.quantity, 1),
            unit: cleanNullable(item.unit),
            unit_cost: numeric(item.unit_cost),
            unit_price: numeric(item.unit_price),
            net_weight_kg: item.net_weight_kg === '' ? null : numeric(item.net_weight_kg),
            gross_weight_kg: item.gross_weight_kg === '' ? null : numeric(item.gross_weight_kg),
            volume_m3: item.volume_m3 === '' ? null : numeric(item.volume_m3),
            packages: item.packages === '' ? null : Math.trunc(numeric(item.packages))
          }));
        if (items.length) await supabase('operation_items', { method: 'POST', body: items });
      }

      if (row?.id && row.container_number && !row.shipment_id) {
        await createShipmentForOperation(row, body, admin);
      }

      await writeAudit(admin, 'create', 'operation', row?.id, { operation_code: row?.operation_code });
      const full = await supabase('operations', { query: `?select=${encodeURIComponent(detailSelect)}&id=eq.${encodeURIComponent(row.id)}&limit=1` });
      return ok(res, { operation: full?.[0] || row });
    }

    if (req.method === 'PATCH') {
      const body = await readJson(req);
      const id = required(body.id, 'ID');
      const allowed = ['client_id','supplier_id','importer_id','shipment_id','operation_type','status','currency','incoterm','origin_port','destination_port','vessel_name','voyage_number','booking_number','bol_number','container_number','seal_number','etd','eta','notes'];
      const updates = Object.fromEntries(allowed.filter(k => body[k] !== undefined).map(k => [k, body[k] === '' ? null : body[k]]));
      const rows = await supabase('operations', { method: 'PATCH', query: `?id=eq.${encodeURIComponent(id)}`, body: updates, prefer: 'return=representation' });
      await writeAudit(admin, 'update', 'operation', id, updates);
      return ok(res, { operation: rows?.[0] || null });
    }

    if (req.method === 'DELETE') {
      const id = required(req.query?.id, 'ID');
      await supabase('operations', { method: 'DELETE', query: `?id=eq.${encodeURIComponent(id)}` });
      await writeAudit(admin, 'delete', 'operation', id);
      return ok(res, { deleted: true });
    }

    return fail(res, 405, 'Método no permitido');
  } catch (error) {
    console.error('OPERATIONS_API_ERROR', error);
    return fail(res, 400, 'No se pudo procesar la operación', error.message);
  }
}
