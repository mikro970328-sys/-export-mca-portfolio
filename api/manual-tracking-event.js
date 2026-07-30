import { fail, ok, readJson, requireAdmin, sendWhatsApp, supabase } from './_lib.js';

const EVENTS = {
  load: {
    order: 1,
    status: 'Cargado en el buque',
    eventType: 'LOAD',
    templateEnv: 'TWILIO_CONTENT_SID',
    templateType: 'tracking'
  },
  departed: {
    order: 2,
    status: 'Salió del puerto',
    eventType: 'DEPA',
    templateEnv: 'TWILIO_CONTENT_SID',
    templateType: 'tracking'
  },
  arrived: {
    order: 3,
    status: 'Llegó al puerto',
    eventType: 'ARRV',
    templateEnv: 'TWILIO_CONTENT_SID',
    templateType: 'tracking'
  },
  discharged: {
    order: 4,
    status: 'Descargado del buque',
    eventType: 'DISC',
    templateEnv: 'TWILIO_CONTENT_SID',
    templateType: 'tracking'
  },
  released: {
    order: 5,
    status: 'Liberado',
    eventType: 'RELEASE',
    templateEnv: 'TWILIO_RELEASE_CONTENT_SID',
    templateType: 'release'
  },
  delivered: {
    order: 6,
    status: 'Entregado',
    eventType: 'DELIVERED',
    templateEnv: 'TWILIO_DELIVERED_CONTENT_SID',
    templateType: 'delivered'
  }
};

async function claimNotification(shipmentId, eventStatus, source) {
  try {
    await supabase('notification_dispatch_claims', {
      method: 'POST',
      body: [{ shipment_id: shipmentId, event_status: eventStatus, source }]
    });
    return true;
  } catch (error) {
    if (String(error.message || '').includes('SUPABASE_409')) return false;
    throw error;
  }
}

async function releaseClaim(shipmentId, eventStatus) {
  try {
    await supabase('notification_dispatch_claims', {
      method: 'DELETE',
      query: `?shipment_id=eq.${encodeURIComponent(shipmentId)}&event_status=eq.${encodeURIComponent(eventStatus)}`
    });
  } catch (error) {
    console.error('MANUAL_NOTIFICATION_CLAIM_RELEASE_FAILED', error.message);
  }
}

async function writeHistory(shipment, event, admin, details) {
  try {
    await supabase('shipment_history', {
      method: 'POST',
      body: [{
        shipment_id: shipment.id,
        client_id: shipment.client_id,
        event_type: `manual_${event.eventType.toLowerCase()}`,
        title: `Tracking manual · ${event.status}`,
        details,
        source: 'admin'
      }]
    });
  } catch (error) {
    console.error('MANUAL_TRACKING_HISTORY_FAILED', error.message);
  }
}

async function writeAudit(shipment, event, admin, details = {}) {
  try {
    await supabase('audit_log', {
      method: 'POST',
      body: [{
        actor_admin_id: admin.admin_id || null,
        actor_username: admin.username || null,
        action: 'manual_tracking_event_confirmed',
        entity_type: 'shipment',
        entity_id: shipment.id,
        details: { event: event.eventType, status: event.status, ...details }
      }]
    });
  } catch (error) {
    console.error('MANUAL_TRACKING_AUDIT_FAILED', error.message);
  }
}

async function logNotification(shipment, event, data = {}) {
  try {
    await supabase('notifications', {
      method: 'POST',
      body: [{
        shipment_id: shipment.id,
        client_id: shipment.client_id,
        event_type: event.templateType,
        event_status: event.status,
        channel: 'whatsapp',
        recipient: shipment.clients?.phone || null,
        recipient_phone: shipment.clients?.phone || null,
        status: data.status || 'pending',
        delivery_status: data.status || 'pending',
        provider_message_id: data.sid || null,
        twilio_message_sid: data.sid || null,
        template_sid: data.templateSid || null,
        payload: {
          container_number: shipment.container_number,
          client_name: shipment.clients?.name || null,
          status: event.status,
          location: data.location || null,
          manual_tracking: true,
          event_code: event.eventType
        },
        error_message: data.error || null,
        sent_at: data.sentAt || null,
        attempt_count: 1,
        last_attempt_at: new Date().toISOString()
      }]
    });
  } catch (error) {
    console.error('MANUAL_TRACKING_NOTIFICATION_LOG_FAILED', error.message);
  }
}

function variablesFor(event, shipment) {
  if (event.templateType === 'tracking') {
    return { '1': shipment.container_number, '2': event.status };
  }
  return {
    '1': shipment.clients?.name || 'Cliente',
    '2': shipment.container_number
  };
}

export default async function handler(req, res) {
  const admin = requireAdmin(req, res);
  if (!admin) return;
  if (req.method !== 'PATCH') return fail(res, 405, 'Método no permitido');

  try {
    const body = await readJson(req);
    const id = String(body.id || '').trim();
    const eventKey = String(body.event || '').trim().toLowerCase();
    const event = EVENTS[eventKey];
    const location = String(body.location || '').trim() || null;

    if (!id) return fail(res, 400, 'Falta el identificador del contenedor');
    if (!event) return fail(res, 400, 'Evento manual no válido');

    const rows = await supabase('shipments', {
      query: `?select=*,clients(id,name,phone,active)&id=eq.${encodeURIComponent(id)}&limit=1`
    });
    const shipment = rows?.[0];
    if (!shipment) return fail(res, 404, 'Contenedor no encontrado');
    if (shipment.shipsgo_status !== 'manual') {
      return fail(res, 409, 'El contenedor debe estar en modo manual para confirmar este evento');
    }
    if (!shipment.clients?.active || !shipment.clients?.phone) {
      return fail(res, 400, 'El cliente no tiene un WhatsApp activo');
    }
    if (shipment.last_status === event.status) {
      return fail(res, 409, `El evento “${event.status}” ya fue confirmado`);
    }

    const now = new Date().toISOString();
    const patch = {
      operational_status: event.status,
      last_status: event.status,
      last_location: location,
      last_event_at: now,
      updated_at: now
    };
    if (eventKey === 'discharged') {
      patch.discharged_at = shipment.discharged_at || now;
    }
    if (eventKey === 'released') {
      patch.released_at = shipment.released_at || now;
      patch.release_method = 'manual_tracking';
      patch.released_by_admin_id = admin.admin_id || null;
      patch.released_by_username = admin.username || null;
    }
    if (eventKey === 'delivered') {
      patch.active = false;
      patch.delivered_at = shipment.delivered_at || now;
    }

    await supabase('shipments', {
      method: 'PATCH',
      query: `?id=eq.${encodeURIComponent(id)}`,
      body: patch
    });

    const templateSid = process.env[event.templateEnv];
    if (!templateSid) {
      await logNotification(shipment, event, {
        status: 'pending',
        templateSid: null,
        location,
        error: `Falta ${event.templateEnv} en Vercel`
      });
      await writeHistory(shipment, event, admin, `Confirmado por ${admin.username || 'administrador'} · WhatsApp pendiente: falta ${event.templateEnv}`);
      await writeAudit(shipment, event, admin, { notification_status: 'pending_template', location });
      return ok(res, {
        updated: true,
        event: eventKey,
        status: event.status,
        notification_status: 'pending_template',
        missing_variable: event.templateEnv
      });
    }

    const claimed = await claimNotification(shipment.id, event.status, 'manual');
    if (!claimed) {
      await writeHistory(shipment, event, admin, `Confirmado por ${admin.username || 'administrador'} · WhatsApp no reenviado: esta etapa ya había sido notificada`);
      await writeAudit(shipment, event, admin, { notification_status: 'already_notified', location });
      return ok(res, {
        updated: true,
        event: eventKey,
        status: event.status,
        notification_status: 'already_notified',
        notified: false
      });
    }

    try {
      const sent = await sendWhatsApp({
        to: shipment.clients.phone,
        contentSid: templateSid,
        variables: variablesFor(event, shipment)
      });
      await logNotification(shipment, event, {
        status: sent.status || 'queued',
        sid: sent.sid,
        templateSid,
        sentAt: now,
        location
      });
      await writeHistory(shipment, event, admin, `Confirmado por ${admin.username || 'administrador'} · WhatsApp: ${sent.sid}`);
      await writeAudit(shipment, event, admin, { notification_status: sent.status || 'queued', sid: sent.sid, location });
      return ok(res, {
        updated: true,
        event: eventKey,
        status: event.status,
        notification_status: sent.status || 'queued',
        sid: sent.sid
      });
    } catch (error) {
      await releaseClaim(shipment.id, event.status);
      await logNotification(shipment, event, {
        status: 'failed',
        templateSid,
        location,
        error: error.message
      });
      await writeHistory(shipment, event, admin, `Confirmado por ${admin.username || 'administrador'} · Falló WhatsApp: ${error.message}`);
      await writeAudit(shipment, event, admin, { notification_status: 'failed', error: error.message, location });
      return ok(res, {
        updated: true,
        event: eventKey,
        status: event.status,
        notification_status: 'failed',
        notification_error: error.message
      });
    }
  } catch (error) {
    console.error('MANUAL_TRACKING_EVENT_ERROR', error);
    return fail(res, 400, 'No se pudo confirmar el evento manual', error.message);
  }
}
