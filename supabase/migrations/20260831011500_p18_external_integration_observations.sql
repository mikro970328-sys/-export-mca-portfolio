-- P18 · Integraciones externas: proveedor observa/entrega; ERP conserva la verdad canónica.

alter table public.shipments
  add column if not exists tracking_provider text,
  add column if not exists tracking_provider_status text,
  add column if not exists tracking_provider_event_code text,
  add column if not exists tracking_provider_location text,
  add column if not exists tracking_provider_event_at timestamptz,
  add column if not exists tracking_provider_received_at timestamptz,
  add column if not exists tracking_provider_observation_id uuid;

create table if not exists public.external_tracking_observations (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_key text not null,
  shipment_id uuid references public.shipments(id) on delete set null,
  container_number text not null,
  provider_tracking_id text,
  event_code text,
  status_label text not null,
  location text,
  observed_at timestamptz not null,
  received_at timestamptz not null default now(),
  raw_payload jsonb not null default '{}'::jsonb,
  applied_to_tracking boolean not null default false,
  ignored_reason text,
  constraint external_tracking_observations_provider_not_blank check (btrim(provider)<>''),
  constraint external_tracking_observations_event_key_not_blank check (btrim(provider_event_key)<>''),
  constraint external_tracking_observations_container_not_blank check (btrim(container_number)<>''),
  constraint external_tracking_observations_status_not_blank check (btrim(status_label)<>''),
  constraint external_tracking_observations_provider_event_unique unique(provider,provider_event_key)
);

create index if not exists external_tracking_observations_shipment_time_idx
  on public.external_tracking_observations(shipment_id,observed_at desc)
  where shipment_id is not null;
create index if not exists external_tracking_observations_container_time_idx
  on public.external_tracking_observations(container_number,observed_at desc);

alter table public.shipments drop constraint if exists shipments_tracking_provider_observation_id_fkey;
alter table public.shipments
  add constraint shipments_tracking_provider_observation_id_fkey
  foreign key (tracking_provider_observation_id)
  references public.external_tracking_observations(id)
  on delete set null
  not valid;
alter table public.shipments validate constraint shipments_tracking_provider_observation_id_fkey;

alter table public.external_tracking_observations enable row level security;
revoke all on table public.external_tracking_observations from public,anon,authenticated;
grant select,insert,update on table public.external_tracking_observations to service_role;

-- Stable delivery identity. Legacy rows are preserved and normalized once.
alter table public.notification_dispatch_claims add column if not exists delivery_key text;

update public.notification_dispatch_claims
set delivery_key = case lower(btrim(event_status))
  when 'cargado en el buque' then 'tracking:LOAD'
  when 'salió del puerto' then 'tracking:DEPA'
  when 'salio del puerto' then 'tracking:DEPA'
  when 'llegó al puerto' then 'tracking:ARRV'
  when 'llego al puerto' then 'tracking:ARRV'
  when 'descargado del buque' then 'tracking:DISC'
  when 'salió de la terminal' then 'tracking:GTOT'
  when 'salio de la terminal' then 'tracking:GTOT'
  when 'liberado' then 'tracking:RELEASE'
  when 'entregado' then 'tracking:DELIVERED'
  else 'legacy:' || md5(lower(btrim(event_status)))
end
where delivery_key is null;

alter table public.notification_dispatch_claims alter column delivery_key set not null;
alter table public.notification_dispatch_claims drop constraint if exists notification_dispatch_claims_delivery_key_not_blank;
alter table public.notification_dispatch_claims add constraint notification_dispatch_claims_delivery_key_not_blank check (btrim(delivery_key)<>'');
alter table public.notification_dispatch_claims drop constraint if exists notification_dispatch_claims_shipment_id_event_status_key;
drop index if exists public.notification_dispatch_claims_shipment_id_event_status_key;
create unique index if not exists notification_dispatch_claims_shipment_delivery_key_unique
  on public.notification_dispatch_claims(shipment_id,delivery_key);

-- Provider message IDs are delivery identities. Retries update the same history row to the new ID.
create unique index if not exists notifications_message_provider_id_unique
  on public.notifications(provider_message_id)
  where notification_scope='message' and provider_message_id is not null;

create or replace function public.ingest_external_tracking_observation(
  p_provider text,
  p_provider_event_key text,
  p_shipment_id uuid,
  p_container_number text,
  p_provider_tracking_id text,
  p_event_code text,
  p_status_label text,
  p_location text,
  p_observed_at timestamptz,
  p_raw_payload jsonb default '{}'::jsonb,
  p_received_at timestamptz default now()
)
returns table(
  observation_id uuid,
  action text,
  applied_to_tracking boolean,
  ignored_reason text,
  tracking_provider_event_at timestamptz
)
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_provider text:=lower(btrim(coalesce(p_provider,'')));
  v_shipment public.shipments%rowtype;
  v_observation_id uuid;
  v_existing public.external_tracking_observations%rowtype;
  v_manual boolean;
  v_stale boolean;
begin
  if v_provider<>'shipsgo' then raise exception 'TRACKING_PROVIDER_UNSUPPORTED'; end if;
  if btrim(coalesce(p_provider_event_key,''))='' then raise exception 'TRACKING_PROVIDER_EVENT_KEY_REQUIRED'; end if;
  if btrim(coalesce(p_container_number,''))='' then raise exception 'TRACKING_CONTAINER_REQUIRED'; end if;
  if btrim(coalesce(p_status_label,''))='' then raise exception 'TRACKING_STATUS_REQUIRED'; end if;
  if p_observed_at is null then raise exception 'TRACKING_OBSERVED_AT_REQUIRED'; end if;

  select s.* into v_shipment from public.shipments s where s.id=p_shipment_id for update;
  if not found then raise exception 'TRACKING_SHIPMENT_NOT_FOUND'; end if;
  if upper(btrim(v_shipment.container_number))<>upper(btrim(p_container_number)) then
    raise exception 'TRACKING_CONTAINER_MISMATCH';
  end if;

  insert into public.external_tracking_observations(
    provider,provider_event_key,shipment_id,container_number,provider_tracking_id,event_code,
    status_label,location,observed_at,received_at,raw_payload
  ) values (
    v_provider,btrim(p_provider_event_key),v_shipment.id,upper(btrim(p_container_number)),nullif(btrim(coalesce(p_provider_tracking_id,'')),''),
    nullif(upper(btrim(coalesce(p_event_code,''))),''),btrim(p_status_label),nullif(btrim(coalesce(p_location,'')),''),
    p_observed_at,coalesce(p_received_at,now()),coalesce(p_raw_payload,'{}'::jsonb)
  )
  on conflict(provider,provider_event_key) do nothing
  returning id into v_observation_id;

  if v_observation_id is null then
    select o.* into v_existing
    from public.external_tracking_observations o
    where o.provider=v_provider and o.provider_event_key=btrim(p_provider_event_key);
    return query select v_existing.id,'duplicate'::text,v_existing.applied_to_tracking,v_existing.ignored_reason,v_shipment.tracking_provider_event_at;
    return;
  end if;

  v_stale := v_shipment.tracking_provider_event_at is not null and p_observed_at<=v_shipment.tracking_provider_event_at;
  v_manual := v_shipment.shipsgo_status='manual' or v_shipment.shipsgo_link_mode='manual';

  if not v_stale then
    update public.shipments s
    set tracking_provider=v_provider,
        tracking_provider_status=btrim(p_status_label),
        tracking_provider_event_code=nullif(upper(btrim(coalesce(p_event_code,''))),''),
        tracking_provider_location=nullif(btrim(coalesce(p_location,'')),''),
        tracking_provider_event_at=p_observed_at,
        tracking_provider_received_at=coalesce(p_received_at,now()),
        tracking_provider_observation_id=v_observation_id,
        updated_at=now()
    where s.id=v_shipment.id;
  end if;

  if v_stale then
    update public.external_tracking_observations set ignored_reason='stale_provider_event' where id=v_observation_id;
    return query select v_observation_id,'stale'::text,false,'stale_provider_event'::text,v_shipment.tracking_provider_event_at;
    return;
  end if;

  if v_manual then
    update public.external_tracking_observations set ignored_reason='manual_mode' where id=v_observation_id;
    return query select v_observation_id,'observed_manual'::text,false,'manual_mode'::text,p_observed_at;
    return;
  end if;

  update public.shipments s
  set last_status=btrim(p_status_label),
      last_location=nullif(btrim(coalesce(p_location,'')),''),
      last_event_at=p_observed_at,
      updated_at=now()
  where s.id=v_shipment.id;

  update public.external_tracking_observations set applied_to_tracking=true,ignored_reason=null where id=v_observation_id;
  return query select v_observation_id,'applied_tracking'::text,true,null::text,p_observed_at;
end;
$$;

create or replace function public.claim_notification_dispatch(
  p_shipment_id uuid,
  p_delivery_key text,
  p_event_status text,
  p_source text
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_id uuid;
begin
  if btrim(coalesce(p_delivery_key,''))='' then raise exception 'NOTIFICATION_DELIVERY_KEY_REQUIRED'; end if;
  if btrim(coalesce(p_event_status,''))='' then raise exception 'NOTIFICATION_EVENT_STATUS_REQUIRED'; end if;
  if btrim(coalesce(p_source,''))='' then raise exception 'NOTIFICATION_SOURCE_REQUIRED'; end if;

  insert into public.notification_dispatch_claims(shipment_id,event_status,source,delivery_key)
  values(p_shipment_id,btrim(p_event_status),btrim(p_source),btrim(p_delivery_key))
  on conflict(shipment_id,delivery_key) do nothing
  returning id into v_id;
  return v_id is not null;
end;
$$;

create or replace function public.release_notification_dispatch_claim(
  p_shipment_id uuid,
  p_delivery_key text
)
returns boolean
language plpgsql
security definer
set search_path=public,pg_temp
as $$
declare
  v_count integer;
begin
  delete from public.notification_dispatch_claims
  where shipment_id=p_shipment_id and delivery_key=p_delivery_key;
  get diagnostics v_count=row_count;
  return v_count>0;
end;
$$;

revoke all on function public.ingest_external_tracking_observation(text,text,uuid,text,text,text,text,text,timestamptz,jsonb,timestamptz) from public,anon,authenticated;
revoke all on function public.claim_notification_dispatch(uuid,text,text,text) from public,anon,authenticated;
revoke all on function public.release_notification_dispatch_claim(uuid,text) from public,anon,authenticated;
grant execute on function public.ingest_external_tracking_observation(text,text,uuid,text,text,text,text,text,timestamptz,jsonb,timestamptz) to service_role;
grant execute on function public.claim_notification_dispatch(uuid,text,text,text) to service_role;
grant execute on function public.release_notification_dispatch_claim(uuid,text) to service_role;
