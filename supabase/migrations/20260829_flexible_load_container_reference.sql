create or replace function public.create_load_shipment(
  p_load_id uuid,
  p_container_number text,
  p_client_id uuid default null,
  p_importer_id uuid default null,
  p_booking_number text default null,
  p_bol_number text default null,
  p_carrier text default null,
  p_departure_date date default null
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
  v_is_iso boolean;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;
  if v_load.shipment_id is not null then raise exception 'LOAD_ALREADY_HAS_CONTAINER'; end if;

  v_container := upper(btrim(regexp_replace(coalesce(p_container_number,''), '\s+', ' ', 'g')));
  if v_container = ''
     or length(v_container) > 40
     or v_container !~ '^[A-Z0-9][A-Z0-9 ._/-]*$'
  then
    raise exception 'CONTAINER_REFERENCE_INVALID';
  end if;

  v_is_iso := v_container ~ '^[A-Z]{4}[0-9]{7}$';

  insert into public.shipments (
    client_id, importer_id, container_number, booking_number, bol_number, carrier,
    product, quantity, quantity_unit, departure_date, active, last_status,
    operational_status, last_location, last_event_at, shipsgo_status
  ) values (
    p_client_id, p_importer_id, v_container,
    nullif(btrim(p_booking_number),''), nullif(btrim(p_bol_number),''), nullif(btrim(p_carrier),''),
    null, null, null, p_departure_date, true, 'Registrado', 'Registrado', null, null,
    case when v_is_iso then 'pending' else 'manual' end
  ) returning * into v_shipment;

  update public.loads set shipment_id = v_shipment.id, updated_at = now() where id = p_load_id;
  return v_shipment;
end;
$function$;
