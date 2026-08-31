import { authorizeAdmin, fail, normalizeContainer, ok, readJson, supabase } from './_lib.js';

const CLOSED = ['liberado','released','descargado','discharged','entregado','delivered','cerrado','closed'];
const isClosed = row => row.active === false || CLOSED.includes(String(row.operational_status || row.last_status || '').trim().toLowerCase());

export default async function handler(req,res) {
  const admin = await authorizeAdmin(req,res,'logistics.write');
  if (!admin) return;
  if (req.method !== 'POST') return fail(res,405,'Método no permitido');

  try {
    const body = await readJson(req);
    const clientId = String(body.client_id || '').trim();
    if (!clientId) return fail(res,400,'Selecciona un cliente');
    const containerNumber = normalizeContainer(body.container_number);

    const existing = await supabase('shipments', {
      query:`?select=id,active,operational_status,last_status&container_number=eq.${encodeURIComponent(containerNumber)}&order=created_at.desc`
    });
    const blocking = (existing || []).find(row => !isClosed(row));
    if (blocking) return fail(res,409,'Ese número de contenedor ya tiene una operación activa');

    const created = await supabase('shipments', {
      method:'POST',
      body:[{
        client_id:clientId,
        container_number:containerNumber,
        booking_number:String(body.booking_number || '').trim() || null,
        bol_number:String(body.bol_number || '').trim() || null,
        carrier:String(body.carrier || '').trim() || null,
        product:String(body.product || '').trim() || null,
        active:true,
        last_status:'Registrado',
        operational_status:'Registrado',
        last_location:null,
        last_event_at:null
      }]
    });
    const shipment = created?.[0];
    if (!shipment) return fail(res,400,'No se pudo registrar el contenedor');

    await supabase('shipment_history', {
      method:'POST',
      body:[{
        shipment_id:shipment.id,
        client_id:clientId,
        event_type:'created',
        title:'Contenedor registrado',
        details:existing?.length ? 'Número reutilizado después de operación cerrada' : containerNumber,
        source:'admin'
      }]
    });

    return ok(res,{ shipment,reused_number:Boolean(existing?.length),tracking_source:'erp' });
  } catch (error) {
    const message = error.message === 'CONTAINER_INVALID'
      ? 'Número de contenedor inválido. Debe tener 4 letras y 7 números.'
      : error.message;
    return fail(res,400,message);
  }
}
