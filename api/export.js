import { fail, requireAdmin, supabase } from './_lib.js';

const csv = value => `"${String(value ?? '').replaceAll('"','""')}"`;
const dateStamp = () => new Date().toISOString().slice(0,10);

function sendCsv(res, filename, headers, rows) {
  const lines = [headers.map(csv).join(',')];
  for (const row of rows || []) lines.push(row.map(csv).join(','));
  res.statusCode = 200;
  res.setHeader('Content-Type','text/csv; charset=utf-8');
  res.setHeader('Content-Disposition',`attachment; filename="${filename}-${dateStamp()}.csv"`);
  res.end('\ufeff' + lines.join('\n'));
}

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');

  try {
    const mode = String(req.query?.mode || 'shipments').toLowerCase();

    if (mode === 'clients') {
      const rows = await supabase('clients', { query: '?select=*&order=created_at.desc' });
      return sendCsv(res, 'export-mca-clientes',
        ['Nombre','Importadora por la que importa','Nombre de la MIPYME','Identificador interno','WhatsApp','Correo','Estado bienvenida','Creado'],
        (rows || []).map(x => [x.name,x.company,x.mipyme_name,x.importer_name,x.phone,x.email,x.welcome_status,x.created_at])
      );
    }

    if (mode === 'operations') {
      const select = '*,client:clients(name,company),shipment:shipments(container_number,carrier,operational_status)';
      const rows = await supabase('operations', { query: `?select=${encodeURIComponent(select)}&order=created_at.desc` });
      return sendCsv(res, 'export-mca-expedientes',
        ['Expediente','Cliente','Importadora por la que importa','Estado','Incoterm','Moneda','Origen','Destino','Contenedor','Booking','B/L','Buque','Viaje','ETD','ETA','Venta','Costos','Gastos','Pagado','Creado'],
        (rows || []).map(x => [x.operation_code,x.client?.name,x.client?.company,x.status,x.incoterm,x.currency,x.origin_port,x.destination_port,x.container_number,x.booking_number,x.bol_number,x.vessel_name,x.voyage_number,x.etd,x.eta,x.sale_total,x.cost_total,x.expense_total,x.paid_total,x.created_at])
      );
    }

    if (mode === 'notifications') {
      const select = '*,clients(name,phone),shipments(container_number)';
      const rows = await supabase('notifications', { query: `?select=${encodeURIComponent(select)}&order=created_at.desc` });
      return sendCsv(res, 'export-mca-notificaciones',
        ['Fecha','Cliente','Destinatario','Tipo','Canal','Contenedor','Estado','Estado entrega','Proveedor ID','Error'],
        (rows || []).map(x => [x.created_at,x.clients?.name,x.recipient || x.clients?.phone,x.event_type,x.channel,x.shipments?.container_number,x.status,x.delivery_status,x.provider_message_id,x.error_message])
      );
    }

    const rows = await supabase('shipments', { query: '?select=*,clients(name,company,phone,email)&order=created_at.desc' });
    return sendCsv(res, 'export-mca-tracking',
      ['Contenedor','Cliente','Importadora por la que importa','WhatsApp','Correo','Booking','B/L','Naviera','Producto','Estado','Ubicación','ETA','ShipsGo','Creado','Liberado','Entregado'],
      (rows || []).map(x => [x.container_number,x.clients?.name,x.clients?.company,x.clients?.phone,x.clients?.email,x.booking_number,x.bol_number,x.carrier,x.product,x.operational_status || x.last_status,x.last_location,x.eta || x.estimated_arrival || x.arrival_estimate,x.shipsgo_status,x.created_at,x.released_at,x.delivered_at])
    );
  } catch (error) {
    return fail(res, 400, error.message);
  }
}
