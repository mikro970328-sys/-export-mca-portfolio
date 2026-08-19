-- A4.1 · Tracking ERP automático desde Cargue
-- Crea el shipment y lo vincula al load en una sola transacción PostgreSQL.
-- ShipsGo se activa fuera de esta transacción en A4.2.

create function public.create_load_shipment(
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
set search_path = public
as $$
declare
  v_load public.loads;
  v_shipment public.shipments;
  v_container text;
begin
  select * into v_load
  from public.loads
  where id = p_load_id
  for update;

  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;
  if v_load.shipment_id is not null then raise exception 'LOAD_ALREADY_HAS_CONTAINER'; end if;

  v_container := upper(regexp_replace(coalesce(p_container_number,''), '\s+', '', 'g'));
  if v_container !~ '^[A-Z]{4}[0-9]{7}$' then
    raise exception 'CONTAINER_INVALID';
  end if;

  insert into public.shipments (
    client_id,
    importer_id,
    container_number,
    booking_number,
    bol_number,
    carrier,
    product,
    quantity,
    quantity_unit,
    departure_date,
    active,
    last_status,
    operational_status,
    last_location,
    last_event_at,
    shipsgo_status
  ) values (
    p_client_id,
    p_importer_id,
    v_container,
    nullif(btrim(p_booking_number),''),
    nullif(btrim(p_bol_number),''),
    nullif(btrim(p_carrier),''),
    null,
    null,
    null,
    p_departure_date,
    true,
    'Registrado',
    'Registrado',
    null,
    null,
    'pending'
  )
  returning * into v_shipment;

  update public.loads
  set shipment_id = v_shipment.id,
      updated_at = now()
  where id = p_load_id;

  return v_shipment;
end;
$$;

revoke all on function public.create_load_shipment(uuid,text,uuid,uuid,text,text,text,date) from public,anon,authenticated;
grant execute on function public.create_load_shipment(uuid,text,uuid,uuid,text,text,text,date) to service_role;

comment on function public.create_load_shipment(uuid,text,uuid,uuid,text,text,text,date) is
'Crea un shipment de Tracking desde un cargue y lo vincula atómicamente. Mercancía/cantidad permanecen derivadas del load; ShipsGo queda pending hasta A4.2.';
