-- P18 reversible E2E. Run only after all P18 migrations are applied.
begin;

do $$
declare
  v_shipment uuid;
  v_observation uuid;
  v_action text;
  v_applied boolean;
  v_reason text;
  v_provider_at timestamptz;
  v_claim boolean;
  v_release boolean;
  v_notification uuid;
  v_callback record;
  v_count bigint;
begin
  insert into public.shipments(
    container_number,active,last_status,operational_status,shipsgo_status,shipsgo_tracking_id,shipsgo_link_mode
  ) values (
    '__P18_CONTAINER__',true,'Registrado','ERP_CANONICAL','active','__P18_TRACKING__','linked'
  ) returning id into v_shipment;

  select observation_id,action,applied_to_tracking,ignored_reason,tracking_provider_event_at
  into v_observation,v_action,v_applied,v_reason,v_provider_at
  from public.ingest_external_tracking_observation(
    'shipsgo','__P18_EVENT_A__',v_shipment,'__P18_CONTAINER__','__P18_TRACKING__','DEPA',
    'Proveedor salió','Miami','2026-08-31T01:00:00Z','{"fixture":"p18"}'::jsonb,'2026-08-31T01:00:01Z'
  );
  if v_action<>'applied_tracking' or v_applied is distinct from true then raise exception 'P18_APPLY_FAILED:%',v_action; end if;

  select count(*) into v_count from public.shipments
  where id=v_shipment
    and operational_status='ERP_CANONICAL'
    and last_status='Proveedor salió'
    and last_location='Miami'
    and tracking_provider='shipsgo'
    and tracking_provider_event_code='DEPA'
    and tracking_provider_observation_id=v_observation;
  if v_count<>1 then raise exception 'P18_PROVIDER_TAKEOVER_OR_SNAPSHOT_FAILED'; end if;

  select action into v_action
  from public.ingest_external_tracking_observation(
    'shipsgo','__P18_EVENT_A__',v_shipment,'__P18_CONTAINER__','__P18_TRACKING__','DEPA',
    'Proveedor salió','Miami','2026-08-31T01:00:00Z','{"fixture":"p18_duplicate"}'::jsonb,'2026-08-31T01:00:02Z'
  );
  if v_action<>'duplicate' then raise exception 'P18_DUPLICATE_FAILED:%',v_action; end if;
  select count(*) into v_count from public.external_tracking_observations where provider='shipsgo' and provider_event_key='__P18_EVENT_A__';
  if v_count<>1 then raise exception 'P18_DUPLICATE_OBSERVATION_COUNT:%',v_count; end if;

  select action,ignored_reason into v_action,v_reason
  from public.ingest_external_tracking_observation(
    'shipsgo','__P18_EVENT_STALE__',v_shipment,'__P18_CONTAINER__','__P18_TRACKING__','LOAD',
    'Proveedor anterior','Origen','2026-08-31T00:30:00Z','{"fixture":"p18_stale"}'::jsonb,'2026-08-31T01:00:03Z'
  );
  if v_action<>'stale' or v_reason<>'stale_provider_event' then raise exception 'P18_STALE_FAILED:%:%',v_action,v_reason; end if;
  select count(*) into v_count from public.shipments where id=v_shipment and last_status='Proveedor salió' and tracking_provider_event_code='DEPA';
  if v_count<>1 then raise exception 'P18_STALE_REGRESSION'; end if;

  update public.shipments set shipsgo_status='manual' where id=v_shipment;
  select action,applied_to_tracking,ignored_reason into v_action,v_applied,v_reason
  from public.ingest_external_tracking_observation(
    'shipsgo','__P18_EVENT_MANUAL__',v_shipment,'__P18_CONTAINER__','__P18_TRACKING__','ARRV',
    'Proveedor llegó','Mariel','2026-08-31T02:00:00Z','{"fixture":"p18_manual"}'::jsonb,'2026-08-31T02:00:01Z'
  );
  if v_action<>'observed_manual' or v_applied is distinct from false or v_reason<>'manual_mode' then raise exception 'P18_MANUAL_FAILED'; end if;
  select count(*) into v_count from public.shipments
  where id=v_shipment
    and operational_status='ERP_CANONICAL'
    and last_status='Proveedor salió'
    and tracking_provider_status='Proveedor llegó'
    and tracking_provider_event_code='ARRV';
  if v_count<>1 then raise exception 'P18_MANUAL_AUTHORITY_FAILED'; end if;

  select public.claim_notification_dispatch(v_shipment,'tracking:DEPA','Salió del puerto','shipsgo') into v_claim;
  if v_claim is distinct from true then raise exception 'P18_FIRST_CLAIM_FAILED'; end if;
  select public.claim_notification_dispatch(v_shipment,'tracking:DEPA','Texto cambiado por proveedor','shipsgo') into v_claim;
  if v_claim is distinct from false then raise exception 'P18_DUPLICATE_CLAIM_FAILED'; end if;
  select public.release_notification_dispatch_claim(v_shipment,'tracking:DEPA') into v_release;
  if v_release is distinct from true then raise exception 'P18_RELEASE_CLAIM_FAILED'; end if;
  select public.claim_notification_dispatch(v_shipment,'tracking:DEPA','Texto cambiado por proveedor','shipsgo') into v_claim;
  if v_claim is distinct from true then raise exception 'P18_RECLAIM_FAILED'; end if;

  insert into public.notification_dispatch_claims(shipment_id,event_status,source)
  values(v_shipment,'Llegó al puerto','manual');
  select count(*) into v_count from public.notification_dispatch_claims
  where shipment_id=v_shipment and event_status='Llegó al puerto' and delivery_key='tracking:ARRV';
  if v_count<>1 then raise exception 'P18_COMPATIBILITY_TRIGGER_FAILED'; end if;

  insert into public.notifications(
    shipment_id,event_status,channel,notification_scope,status,delivery_status,
    provider_message_id,twilio_message_sid,payload
  ) values (
    v_shipment,'tracking','whatsapp','message','queued','queued',
    '__P18_TWILIO_SID__','__P18_TWILIO_SID__','{"fixture":"p18"}'::jsonb
  ) returning id into v_notification;

  select * into v_callback from public.reconcile_twilio_delivery_status('__P18_TWILIO_SID__','sent',null,null,'2026-08-31T03:00:00Z');
  if v_callback.matched is distinct from true or v_callback.applied is distinct from true or v_callback.current_status<>'sent' then raise exception 'P18_TWILIO_SENT_FAILED'; end if;
  select * into v_callback from public.reconcile_twilio_delivery_status('__P18_TWILIO_SID__','delivered',null,null,'2026-08-31T03:01:00Z');
  if v_callback.applied is distinct from true or v_callback.current_status<>'delivered' then raise exception 'P18_TWILIO_DELIVERED_FAILED'; end if;
  select * into v_callback from public.reconcile_twilio_delivery_status('__P18_TWILIO_SID__','queued',null,null,'2026-08-31T03:02:00Z');
  if v_callback.applied is distinct from false or v_callback.current_status<>'delivered' then raise exception 'P18_TWILIO_REGRESSION_NOT_BLOCKED'; end if;
  select count(*) into v_count from public.notifications where id=v_notification and delivery_status='delivered' and status='delivered';
  if v_count<>1 then raise exception 'P18_TWILIO_STORED_STATUS_REGRESSED'; end if;
end $$;

select
  'p18_e2e_passed_before_rollback' as result,
  (select count(*) from public.shipments where container_number='__P18_CONTAINER__') as fixture_shipments,
  (select count(*) from public.external_tracking_observations where provider_event_key like '__P18_EVENT_%') as fixture_observations,
  (select count(*) from public.notifications where provider_message_id='__P18_TWILIO_SID__') as fixture_notifications;

rollback;

select
  (select count(*) from public.shipments where container_number='__P18_CONTAINER__') as shipment_fixture_residue,
  (select count(*) from public.external_tracking_observations where provider_event_key like '__P18_EVENT_%') as observation_fixture_residue,
  (select count(*) from public.notification_dispatch_claims c join public.shipments s on s.id=c.shipment_id where s.container_number='__P18_CONTAINER__') as claim_fixture_residue,
  (select count(*) from public.notifications where provider_message_id='__P18_TWILIO_SID__') as notification_fixture_residue;
