import { fail, requireAdmin, supabase } from './_lib.js';

const csv = (value) => `"${String(value ?? '').replaceAll('"','""')}"`;

export default async function handler(req, res) {
  if (!requireAdmin(req, res)) return;
  if (req.method !== 'GET') return fail(res, 405, 'Método no permitido');
  try {
    const rows = await supabase('shipments', { query: '?select=*,clients(name,company,phone,email)&order=created_at.desc' });
    const headers = ['Contenedor','Cliente','Empresa','WhatsApp','Correo','Booking','B/L','Naviera','Producto','Estado','Ubicación','Creado','Liberado','Entregado'];
    const lines = [headers.map(csv).join(',')];
    for (const x of rows || []) lines.push([
      x.container_number,x.clients?.name,x.clients?.company,x.clients?.phone,x.clients?.email,x.booking_number,x.bol_number,x.carrier,x.product,x.operational_status || x.last_status,x.last_location,x.created_at,x.released_at,x.delivered_at
    ].map(csv).join(','));
    res.statusCode = 200;
    res.setHeader('Content-Type','text/csv; charset=utf-8');
    res.setHeader('Content-Disposition',`attachment; filename="export-mca-operaciones-${new Date().toISOString().slice(0,10)}.csv"`);
    res.end('\ufeff' + lines.join('\n'));
  } catch (error) { return fail(res, 400, error.message); }
}