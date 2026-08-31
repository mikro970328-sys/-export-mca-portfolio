import { supabase } from './_lib.js';

const WHATSAPP_MILESTONES = new Set(['DEPA', 'RELEASE']);

export function whatsappDeliveryKey(eventCode) {
  const code = String(eventCode || '').trim().toUpperCase();
  return WHATSAPP_MILESTONES.has(code) ? `tracking:${code}` : null;
}

export function whatsappMilestoneAllowed(eventCode) {
  return Boolean(whatsappDeliveryKey(eventCode));
}

export async function claimNotificationDelivery(shipmentId, eventCode, eventStatus, source) {
  const deliveryKey = whatsappDeliveryKey(eventCode);
  if (!deliveryKey) return { claimed:false, deliveryKey:null, reason:'whatsapp_event_not_allowed' };
  const result = await supabase('rpc/claim_notification_dispatch', {
    method:'POST',
    body:{
      p_shipment_id:shipmentId,
      p_delivery_key:deliveryKey,
      p_event_status:eventStatus,
      p_source:source
    }
  });
  return { claimed:Boolean(Array.isArray(result) ? result[0] : result), deliveryKey };
}

export async function releaseNotificationDelivery(shipmentId, deliveryKey) {
  if (!deliveryKey) return false;
  const result = await supabase('rpc/release_notification_dispatch_claim', {
    method:'POST',
    body:{ p_shipment_id:shipmentId, p_delivery_key:deliveryKey }
  });
  return Boolean(Array.isArray(result) ? result[0] : result);
}
