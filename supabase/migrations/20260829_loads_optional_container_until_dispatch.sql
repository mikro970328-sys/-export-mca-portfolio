-- Permite operar un cargue sin conocer todavía el número de contenedor.
-- El contenedor sigue siendo obligatorio antes del despacho físico.

create or replace function public.start_load_loading(p_load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_load public.loads;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'reserved' then raise exception 'LOAD_NOT_RESERVED'; end if;

  if v_load.shipment_id is not null then
    perform 1 from public.shipments
    where id = v_load.shipment_id
      and active is true
      and delivered_at is null
      and released_at is null
      and discharged_at is null
    for update;
    if not found then raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'; end if;
  end if;

  perform set_config('export_mca.load_transition','start_loading',true);
  update public.loads
  set status='loading', loading_started_at=now(), updated_at=now()
  where id=p_load_id
  returning * into v_load;
  return v_load;
end;
$function$;

create or replace function public.mark_load_loaded(p_load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_load public.loads;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'loading' then raise exception 'LOAD_NOT_LOADING'; end if;

  if v_load.shipment_id is not null then
    perform 1 from public.shipments
    where id = v_load.shipment_id
      and active is true
      and delivered_at is null
      and released_at is null
      and discharged_at is null
    for update;
    if not found then raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'; end if;
  end if;

  perform set_config('export_mca.load_transition','mark_loaded',true);
  update public.loads
  set status='loaded', loaded_at=now(), updated_at=now()
  where id=p_load_id
  returning * into v_load;
  return v_load;
end;
$function$;

create or replace function public.assign_load_shipment(p_load_id uuid, p_shipment_id uuid)
returns public.loads
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_load public.loads;
  v_ship public.shipments;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;

  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_ship.active is not true or v_ship.delivered_at is not null or v_ship.released_at is not null or v_ship.discharged_at is not null then
    raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD';
  end if;

  update public.loads
  set shipment_id = p_shipment_id, updated_at = now()
  where id = p_load_id
  returning * into v_load;

  return v_load;
end;
$function$;

create or replace function public.unassign_load_shipment(p_load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_load public.loads;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;

  update public.loads
  set shipment_id = null, updated_at = now()
  where id = p_load_id
  returning * into v_load;
  return v_load;
end;
$function$;

create or replace function public.create_load_shipment(
  p_load_id uuid,
  p_container_number text,
  p_client_id uuid default null::uuid,
  p_importer_id uuid default null::uuid,
  p_booking_number text default null::text,
  p_bol_number text default null::text,
  p_carrier text default null::text,
  p_departure_date date default null::date
)
returns public.shipments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_load public.loads;
  v_shipment public.shipments;
  v_container text;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;
  if v_load.shipment_id is not null then raise exception 'LOAD_ALREADY_HAS_CONTAINER'; end if;

  v_container := upper(regexp_replace(coalesce(p_container_number,''), '\s+', '', 'g'));
  if v_container !~ '^[A-Z]{4}[0-9]{7}$' then raise exception 'CONTAINER_INVALID'; end if;

  insert into public.shipments (
    client_id, importer_id, container_number, booking_number, bol_number, carrier,
    product, quantity, quantity_unit, departure_date, active, last_status,
    operational_status, last_location, last_event_at, shipsgo_status
  ) values (
    p_client_id, p_importer_id, v_container,
    nullif(btrim(p_booking_number),''), nullif(btrim(p_bol_number),''), nullif(btrim(p_carrier),''),
    null, null, null, p_departure_date, true, 'Registrado', 'Registrado', null, null, 'pending'
  ) returning * into v_shipment;

  update public.loads set shipment_id = v_shipment.id, updated_at = now() where id = p_load_id;
  return v_shipment;
end;
$function$;
