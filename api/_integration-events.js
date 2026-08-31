import crypto from 'node:crypto';
import { reconcileAlert } from './_alert-lifecycle.js';
import { supabase } from './_lib.js';

const TRACKING_MILESTONES=new Set(['LOAD','DEPA','ARRV','DISC','GTOT','RELEASE','DELIVERED']);

export function trackingDeliveryKey(eventCode){
  const code=String(eventCode||'').trim().toUpperCase();
  return TRACKING_MILESTONES.has(code)?`tracking:${code}`:null;
}

export function providerEventKey({provider='shipsgo',trackingId=null,container,eventCode=null,eventTime,location=null,status=null}){
  const identity=[
    String(provider||'').trim().toLowerCase(),
    String(trackingId||'').trim(),
    String(container||'').trim().toUpperCase(),
    String(eventCode||'').trim().toUpperCase(),
    new Date(eventTime).toISOString(),
    String(location||'').trim(),
    String(status||'').trim()
  ];
  return crypto.createHash('sha256').update(JSON.stringify(identity)).digest('hex');
}

export async function ingestShipsGoObservation({shipment,event,payload,receivedAt=null}){
  const eventKey=providerEventKey({
    provider:'shipsgo',
    trackingId:event.trackingId||shipment.shipsgo_tracking_id||null,
    container:event.container,
    eventCode:event.code,
    eventTime:event.eventTime,
    location:event.location,
    status:event.status
  });
  const result=await supabase('rpc/ingest_external_tracking_observation',{
    method:'POST',
    body:{
      p_provider:'shipsgo',
      p_provider_event_key:eventKey,
      p_shipment_id:shipment.id,
      p_container_number:event.container,
      p_provider_tracking_id:event.trackingId||shipment.shipsgo_tracking_id||null,
      p_event_code:event.code||null,
      p_status_label:event.status,
      p_location:event.location||null,
      p_observed_at:event.eventTime,
      p_raw_payload:payload||{},
      ...(receivedAt?{p_received_at:receivedAt}:{})
    },
    prefer:'return=representation'
  });
  const row=Array.isArray(result)?result[0]||null:result;
  return {eventKey,...row};
}

export async function claimNotificationDelivery(shipmentId,eventCode,eventStatus,source){
  const deliveryKey=trackingDeliveryKey(eventCode);
  if(!deliveryKey)return{claimed:false,deliveryKey:null,reason:'unmapped_milestone'};
  const result=await supabase('rpc/claim_notification_dispatch',{
    method:'POST',
    body:{p_shipment_id:shipmentId,p_delivery_key:deliveryKey,p_event_status:eventStatus,p_source:source}
  });
  return{claimed:Boolean(Array.isArray(result)?result[0]:result),deliveryKey};
}

export async function releaseNotificationDelivery(shipmentId,deliveryKey){
  if(!deliveryKey)return false;
  const result=await supabase('rpc/release_notification_dispatch_claim',{
    method:'POST',body:{p_shipment_id:shipmentId,p_delivery_key:deliveryKey}
  });
  return Boolean(Array.isArray(result)?result[0]:result);
}

export async function resolveTrackingStaleCondition(shipment,reason='tracking_updated',now=null){
  return reconcileAlert({
    dedupeKey:`shipment_stale_tracking:${shipment.id}`,
    conditionActive:false,
    eventType:'shipment_stale_tracking',
    clientId:shipment.client_id||null,
    shipmentId:shipment.id,
    entityType:'shipment',
    entityId:shipment.id,
    severity:'critical',
    title:'Tracking actualizado',
    message:`El contenedor ${shipment.container_number} recibió una actualización de tracking.`,
    payload:{container_number:shipment.container_number,required_action:'review_or_enable_manual'},
    resolutionReason:reason,
    now
  });
}
