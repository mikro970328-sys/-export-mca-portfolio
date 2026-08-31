import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd();
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const failures=[];
const requireText=(file,text,label=text)=>{if(!read(file).includes(text))failures.push(`${file}: falta ${label}`);};
const forbid=(file,re,label)=>{if(re.test(read(file)))failures.push(`${file}: ${label}`);};

const migrations=[
  'supabase/migrations/20260831011500_p18_external_integration_observations.sql',
  'supabase/migrations/20260831011600_p18_webhook_traceability.sql',
  'supabase/migrations/20260831011700_p18_delivery_key_compatibility.sql',
  'supabase/migrations/20260831011800_p18_twilio_delivery_reconcile.sql',
  'supabase/migrations/20260831011900_p18_delivery_key_normalization_fix.sql',
  'supabase/migrations/20260831012000_p18_tracking_observation_fk_index.sql'
];
for(const file of migrations)if(!fs.existsSync(path.join(root,file)))failures.push(`${file}: falta migración P18`);

const observation=read(migrations[0]);
for(const text of [
  'create table if not exists public.external_tracking_observations',
  'unique(provider,provider_event_key)',
  'tracking_provider_observation_id',
  'create unique index if not exists notification_dispatch_claims_shipment_delivery_key_unique',
  'on public.notification_dispatch_claims(shipment_id,delivery_key)',
  'ingest_external_tracking_observation',
  "v_manual := v_shipment.shipsgo_status='manual'",
  "ignored_reason='stale_provider_event'",
  "ignored_reason='manual_mode'",
  'claim_notification_dispatch',
  'release_notification_dispatch_claim'
]) if(!observation.includes(text))failures.push(`${migrations[0]}: falta contrato ${text}`);

const ingestStart=observation.indexOf('create or replace function public.ingest_external_tracking_observation');
const ingestEnd=observation.indexOf('create or replace function public.claim_notification_dispatch');
const ingest=ingestStart>=0&&ingestEnd>ingestStart?observation.slice(ingestStart,ingestEnd):'';
if(!ingest)failures.push('No se pudo aislar ingest_external_tracking_observation');
if(/operational_status/i.test(ingest))failures.push('ingest_external_tracking_observation no puede tocar operational_status');

const trace=read(migrations[1]);
for(const text of ['provider_event_key text','observation_id uuid','webhook_events_observation_id_fkey'])if(!trace.includes(text))failures.push(`${migrations[1]}: falta ${text}`);

const compat=read(migrations[2]);
for(const text of ['tracking_notification_delivery_key','notification_dispatch_delivery_key_guard','tracking:DEPA','tracking:ARRV','tracking:DELIVERED'])if(!compat.includes(text))failures.push(`${migrations[2]}: falta ${text}`);

const twilioSql=read(migrations[3]);
for(const text of ['twilio_delivery_rank','reconcile_twilio_delivery_status',"v_current in ('failed','undelivered','read')","v_current='delivered'","grant execute on function public.reconcile_twilio_delivery_status"])if(!twilioSql.includes(text))failures.push(`${migrations[3]}: falta ${text}`);

const normalizationFix=read(migrations[4]);
for(const text of ["when 'llegó al puerto' then 'tracking:ARRV'","when 'llego al puerto' then 'tracking:ARRV'","revoke all on function public.tracking_notification_delivery_key(text) from public,anon,authenticated,service_role"]){
  if(!normalizationFix.includes(text))failures.push(`${migrations[4]}: falta ${text}`);
}
if(normalizationFix.includes("llego del puerto"))failures.push(`${migrations[4]}: no puede conservar variante incorrecta 'llego del puerto'`);

const fkIndex=read(migrations[5]);
for(const text of ['create index if not exists shipments_tracking_provider_observation_idx','on public.shipments(tracking_provider_observation_id)','where tracking_provider_observation_id is not null']){
  if(!fkIndex.includes(text))failures.push(`${migrations[5]}: falta ${text}`);
}

const webhook=read('api/shipsgo-webhook.js');
for(const text of ['ingestShipsGoObservation','resolveTrackingStaleCondition','claimNotificationDelivery','releaseNotificationDelivery','operational_status_changed: false'])if(!webhook.includes(text))failures.push(`api/shipsgo-webhook.js: falta ${text}`);
forbid('api/shipsgo-webhook.js',/body\s*:\s*\{[^}]*operational_status\s*:/s,'ShipsGo webhook no puede escribir operational_status');
forbid('api/shipsgo-webhook.js',/notification_dispatch_claims/,'ShipsGo webhook no debe reclamar delivery por tabla directa');

const mode=read('api/tracking-mode.js');
requireText('api/tracking-mode.js','resolveTrackingStaleCondition');
forbid('api/tracking-mode.js',/event_type=eq\.tracking_stale/,'tracking-mode no debe usar alerta legacy tracking_stale');
forbid('api/tracking-mode.js',/supabase\(['"]notifications['"][\s\S]{0,180}method:\s*['"]PATCH/,'tracking-mode no debe resolver alertas por PATCH directo');

const manual=read('api/manual-tracking-event.js');
for(const text of ['claimNotificationDelivery','releaseNotificationDelivery','event.eventType'])if(!manual.includes(text))failures.push(`api/manual-tracking-event.js: falta ${text}`);
forbid('api/manual-tracking-event.js',/notification_dispatch_claims/,'tracking manual no debe duplicar owner de claims');

const twilio=read('api/twilio-status.js');
requireText('api/twilio-status.js','rpc/reconcile_twilio_delivery_status');
forbid('api/twilio-status.js',/supabase\(['"]notifications['"][\s\S]{0,200}method:\s*['"]PATCH/,'callback Twilio no debe mutar historial directamente');

const shipsgo=read('api/_shipsgo.js');
for(const text of ['SHIPSGO_TRACKING_ID_MISSING','requireTrackingIdentity','provider_lookup_failed','provider_delete_failed','export async function assertShipmentTrackingCanBeDeleted','domain_block = true'])if(!shipsgo.includes(text))failures.push(`api/_shipsgo.js: falta ${text}`);

const shipments=read('api/shipments.js');
for(const text of ['assertShipmentTrackingCanBeDeleted','shipment_delete_blocked_load','deletion_scope:\'erp_authoritative_provider_cleanup_best_effort\''])if(!shipments.includes(text))failures.push(`api/shipments.js: falta ${text}`);
const guardAt=shipments.indexOf('await assertShipmentTrackingCanBeDeleted(shipment.id)');
const erpDeleteAt=shipments.indexOf("const deleted = await supabase('shipments'");
const providerDeleteAt=shipments.indexOf('const shipsgoResult = await deleteShipsGoTracking(shipment)');
if(!(guardAt>=0&&erpDeleteAt>guardAt&&providerDeleteAt>erpDeleteAt))failures.push('api/shipments.js: orden de borrado debe ser guard ERP -> DELETE ERP -> cleanup proveedor');
forbid('api/shipments.js',/No se pudo borrar el tracking en ShipsGo\. El contenedor no fue eliminado del ERP/,'provider cleanup no debe gobernar el DELETE ERP');

const errorAlerts=read('api/shipsgo-error-alerts.js');
requireText('api/shipsgo-error-alerts.js',"status==='active'&&!shipment.shipsgo_tracking_id",'detección active sin tracking id');

for(const file of ['api/_integration-events.js','api/shipsgo-webhook.js','api/tracking-mode.js','api/manual-tracking-event.js','api/twilio-status.js','api/shipsgo-error-alerts.js','api/shipments.js']){
  forbid(file,/\bMutationObserver\b/,'no usar MutationObserver');
  forbid(file,/\b(?:alert|prompt|confirm)\s*\(/,'no usar diálogos nativos');
}

const changedIntegrationFiles=['api/_integration-events.js','api/_shipsgo.js','api/shipsgo-webhook.js','api/tracking-mode.js','api/manual-tracking-event.js','api/twilio-status.js','api/shipsgo-error-alerts.js','api/shipments.js',...migrations];
const providerText=changedIntegrationFiles.map(read).join('\n').toLowerCase();
for(const prohibited of ['sendgrid','mailgun','vonage','messagebird','aftership'])if(providerText.includes(prohibited))failures.push(`P18 no debe introducir proveedor externo nuevo: ${prohibited}`);

if(failures.length){
  console.error('P18 integration ownership gate failed:\n'+failures.map(x=>`- ${x}`).join('\n'));
  process.exit(1);
}
console.log('P18 integration ownership gate passed.');
