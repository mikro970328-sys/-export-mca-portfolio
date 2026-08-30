create or replace function public.create_load_from_sales_order(
  p_sales_order_id uuid,
  p_warehouse_id uuid,
  p_lines jsonb,
  p_scheduled_at timestamptz default null,
  p_notes text default null,
  p_actor uuid default null
)
returns public.loads
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_so public.sales_orders;
  v_load public.loads;
  v_line jsonb;
  v_so_item record;
  v_load_item_id uuid;
  v_load_item public.load_items;
begin
  if p_sales_order_id is null then raise exception 'SO_REQUIRED'; end if;
  if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'SO_LOAD_PLAN_TOO_LARGE'; end if;

  select * into v_so from public.sales_orders where id = p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  if v_so.status <> 'confirmed' then raise exception 'SO_NOT_CONFIRMED'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    where jsonb_typeof(line) <> 'object'
       or nullif(btrim(line->>'sales_order_item_id'),'') is null
       or jsonb_typeof(line->'allocations') <> 'array'
       or jsonb_array_length(line->'allocations') = 0
  ) then raise exception 'SO_LOAD_PLAN_ENTRY_INVALID'; end if;

  if exists (
    select 1 from (
      select line->>'sales_order_item_id' as sales_order_item_id, count(*) as n
      from jsonb_array_elements(p_lines) line group by 1 having count(*) > 1
    ) d
  ) then raise exception 'SO_LOAD_DUPLICATE_SALES_ITEM'; end if;

  perform soi.id
  from public.sales_order_items soi
  where soi.sales_order_id = p_sales_order_id
    and soi.id in (select distinct (line->>'sales_order_item_id')::uuid from jsonb_array_elements(p_lines) line)
  order by soi.id for update;

  if (
    select count(*) from public.sales_order_items soi
    where soi.sales_order_id = p_sales_order_id
      and soi.id in (select distinct (line->>'sales_order_item_id')::uuid from jsonb_array_elements(p_lines) line)
  ) <> jsonb_array_length(p_lines) then raise exception 'SO_ITEM_NOT_IN_ORDER'; end if;

  insert into public.loads(warehouse_id, client_id, importer_id, scheduled_at, notes, created_by)
  values (p_warehouse_id, v_so.client_id, v_so.importer_id, p_scheduled_at, nullif(btrim(p_notes),''), p_actor)
  returning * into v_load;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select soi.id, soi.product_id, soi.ordered_pallets into v_so_item
    from public.sales_order_items soi
    where soi.id = (v_line->>'sales_order_item_id')::uuid and soi.sales_order_id = p_sales_order_id;
    if not found then raise exception 'SO_ITEM_NOT_IN_ORDER'; end if;

    v_load_item_id := public.insert_load_item_with_allocations(v_load.id,v_so_item.product_id,v_line->'allocations',v_line->>'notes');
    select * into v_load_item from public.load_items where id = v_load_item_id;

    insert into public.sales_fulfillment_allocations(sales_order_item_id, load_item_id, allocated_quantity, allocated_pallets, created_by)
    values (
      v_so_item.id,
      v_load_item.id,
      v_load_item.planned_quantity,
      case when coalesce(v_so_item.ordered_pallets,0) > 0 then v_load_item.planned_pallets else 0 end,
      p_actor
    );
  end loop;

  select * into v_load from public.loads where id = v_load.id;
  return v_load;
end;
$function$;

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
  v_client_id uuid;
  v_importer_id uuid;
  v_product text;
  v_quantity numeric;
  v_unit text;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;
  if v_load.shipment_id is not null then raise exception 'LOAD_ALREADY_HAS_CONTAINER'; end if;

  v_container := upper(btrim(regexp_replace(coalesce(p_container_number,''), '\s+', ' ', 'g')));
  if v_container = '' or length(v_container) > 40 or v_container !~ '^[A-Z0-9][A-Z0-9 ._/-]*$' then
    raise exception 'CONTAINER_REFERENCE_INVALID';
  end if;
  v_is_iso := v_container ~ '^[A-Z]{4}[0-9]{7}$';

  if v_load.client_id is not null and p_client_id is not null and v_load.client_id is distinct from p_client_id then
    raise exception 'LOAD_SHIPMENT_CLIENT_MISMATCH';
  end if;
  if v_load.importer_id is not null and p_importer_id is not null and v_load.importer_id is distinct from p_importer_id then
    raise exception 'LOAD_SHIPMENT_IMPORTER_MISMATCH';
  end if;

  v_client_id := coalesce(v_load.client_id, p_client_id);
  v_importer_id := coalesce(v_load.importer_id, p_importer_id);

  select
    string_agg(distinct p.name, ', ' order by p.name),
    case when count(distinct nullif(btrim(li.unit),'')) <= 1 then sum(li.planned_quantity) else null end,
    case when count(distinct nullif(btrim(li.unit),'')) <= 1 then max(nullif(btrim(li.unit),'')) else null end
  into v_product, v_quantity, v_unit
  from public.load_items li
  join public.products p on p.id = li.product_id
  where li.load_id = p_load_id;

  insert into public.shipments (
    client_id, importer_id, container_number, booking_number, bol_number, carrier,
    product, quantity, quantity_unit, departure_date, active, last_status,
    operational_status, last_location, last_event_at, shipsgo_status
  ) values (
    v_client_id, v_importer_id, v_container,
    nullif(btrim(p_booking_number),''), nullif(btrim(p_bol_number),''), nullif(btrim(p_carrier),''),
    nullif(v_product,''), v_quantity, v_unit, p_departure_date, true, 'Registrado', 'Registrado', null, null,
    case when v_is_iso then 'pending' else 'manual' end
  ) returning * into v_shipment;

  update public.loads
  set shipment_id = v_shipment.id,
      client_id = coalesce(client_id, v_client_id),
      importer_id = coalesce(importer_id, v_importer_id),
      updated_at = now()
  where id = p_load_id;

  return v_shipment;
end;
$function$;
