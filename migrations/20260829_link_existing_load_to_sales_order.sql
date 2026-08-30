create or replace function public.validate_sales_fulfillment_allocation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_client_id uuid; v_importer_id uuid; v_so_status text; v_so_product_id uuid; v_so_unit text; v_ordered_quantity numeric; v_ordered_pallets numeric;
  v_load_id uuid; v_load_status text; v_load_client_id uuid; v_load_importer_id uuid; v_load_shipment_id uuid; v_load_product_id uuid; v_load_unit text; v_load_quantity numeric; v_load_pallets numeric;
  v_shipment_client_id uuid; v_shipment_importer_id uuid; v_existing_so_quantity numeric; v_existing_so_pallets numeric; v_existing_load_quantity numeric; v_existing_load_pallets numeric;
  v_repair_mode boolean := coalesce(current_setting('app.sales_load_repair', true), '') = 'on';
begin
  select so.client_id, so.importer_id, so.status, soi.product_id, soi.unit, soi.ordered_quantity, soi.ordered_pallets
    into v_client_id, v_importer_id, v_so_status, v_so_product_id, v_so_unit, v_ordered_quantity, v_ordered_pallets
  from public.sales_order_items soi
  join public.sales_orders so on so.id = soi.sales_order_id
  where soi.id = new.sales_order_item_id
  for update of soi, so;
  if not found then raise exception 'SO_ITEM_NOT_FOUND'; end if;
  if v_so_status <> 'confirmed' then raise exception 'SO_NOT_CONFIRMED'; end if;

  select li.load_id, l.status, l.client_id, l.importer_id, l.shipment_id, li.product_id, li.unit, li.planned_quantity, li.planned_pallets
    into v_load_id, v_load_status, v_load_client_id, v_load_importer_id, v_load_shipment_id, v_load_product_id, v_load_unit, v_load_quantity, v_load_pallets
  from public.load_items li
  join public.loads l on l.id = li.load_id
  where li.id = new.load_item_id
  for update of li, l;
  if not found then raise exception 'LOAD_ITEM_NOT_FOUND'; end if;
  if v_load_status <> 'draft' and not v_repair_mode then raise exception 'SO_LOAD_NOT_DRAFT'; end if;
  if v_repair_mode and v_load_status not in ('draft','reserved','loading','loaded','dispatched') then raise exception 'SO_LOAD_REPAIR_STATUS_INVALID'; end if;
  if v_load_product_id <> v_so_product_id then raise exception 'SO_LOAD_PRODUCT_MISMATCH'; end if;
  if btrim(v_load_unit) is distinct from btrim(v_so_unit) then raise exception 'SO_LOAD_UNIT_MISMATCH'; end if;
  if v_ordered_pallets = 0 and new.allocated_pallets <> 0 then raise exception 'SO_PALLET_ALLOCATION_NOT_ALLOWED'; end if;
  if v_load_pallets = 0 and new.allocated_pallets <> 0 then raise exception 'LOAD_PALLET_ALLOCATION_NOT_ALLOWED'; end if;

  select coalesce(sum(sfa.allocated_quantity),0), coalesce(sum(sfa.allocated_pallets),0)
    into v_existing_so_quantity, v_existing_so_pallets
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id = sfa.load_item_id
  join public.loads l on l.id = li.load_id
  where sfa.sales_order_item_id = new.sales_order_item_id and sfa.id <> new.id and l.status <> 'cancelled';
  if v_existing_so_quantity + new.allocated_quantity > v_ordered_quantity or v_existing_so_pallets + new.allocated_pallets > v_ordered_pallets then raise exception 'SO_ALLOCATION_EXCEEDS_ORDER'; end if;

  select coalesce(sum(allocated_quantity),0), coalesce(sum(allocated_pallets),0)
    into v_existing_load_quantity, v_existing_load_pallets
  from public.sales_fulfillment_allocations
  where load_item_id = new.load_item_id and id <> new.id;
  if v_existing_load_quantity + new.allocated_quantity > v_load_quantity or v_existing_load_pallets + new.allocated_pallets > v_load_pallets then raise exception 'SO_ALLOCATION_EXCEEDS_LOAD_ITEM'; end if;

  if v_load_client_id is null and v_load_importer_id is null then
    if v_load_shipment_id is not null then
      select client_id, importer_id into v_shipment_client_id, v_shipment_importer_id from public.shipments where id = v_load_shipment_id;
      if v_shipment_client_id is distinct from v_client_id or v_shipment_importer_id is distinct from v_importer_id then raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH'; end if;
    end if;
    update public.loads set client_id = v_client_id, importer_id = v_importer_id where id = v_load_id;
  elsif v_load_client_id is distinct from v_client_id or v_load_importer_id is distinct from v_importer_id then
    raise exception 'LOAD_SALES_CONTEXT_MISMATCH';
  end if;
  return new;
end;
$function$;

create or replace function public.sales_order_linkable_existing_loads(p_sales_order_id uuid)
returns table(
  load_id uuid,
  load_number text,
  load_status text,
  shipment_id uuid,
  container_number text,
  warehouse_id uuid,
  warehouse_name text,
  item_summary text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_so record;
begin
  select id, client_id, importer_id, status into v_so
  from public.sales_orders
  where id = p_sales_order_id;
  if not found or v_so.status <> 'confirmed' then return; end if;

  return query
  select l.id, l.load_number, l.status, l.shipment_id, s.container_number, l.warehouse_id, w.name,
         string_agg(coalesce(p.sku || ' · ', '') || p.name || ' · ' || trim(to_char(li.planned_quantity, 'FM999999999999990.###')) || ' ' || li.unit, ' | ' order by li.created_at)
  from public.loads l
  join public.load_items li on li.load_id = l.id
  join public.products p on p.id = li.product_id
  left join public.shipments s on s.id = l.shipment_id
  left join public.warehouses w on w.id = l.warehouse_id
  where l.status in ('draft','reserved','loading','loaded','dispatched')
    and not exists (
      select 1 from public.load_items lix
      join public.sales_fulfillment_allocations sfa on sfa.load_item_id = lix.id
      where lix.load_id = l.id
    )
    and (l.client_id is null or l.client_id = v_so.client_id)
    and (l.importer_id is null or l.importer_id is not distinct from v_so.importer_id)
    and (s.id is null or s.client_id is null or s.client_id = v_so.client_id)
    and (s.id is null or s.importer_id is null or s.importer_id is not distinct from v_so.importer_id)
    and not exists (
      select 1
      from public.load_items lix
      where lix.load_id = l.id
        and (
          select count(*)
          from public.sales_order_items soi
          join public.sales_order_item_progress sip on sip.sales_order_item_id = soi.id
          where soi.sales_order_id = p_sales_order_id
            and soi.product_id = lix.product_id
            and btrim(soi.unit) = btrim(lix.unit)
            and sip.unallocated_quantity = lix.planned_quantity
            and coalesce(sip.unallocated_pallets,0) = coalesce(lix.planned_pallets,0)
        ) <> 1
    )
  group by l.id, l.load_number, l.status, l.shipment_id, s.container_number, l.warehouse_id, w.name
  order by l.created_at desc;
end;
$function$;

create or replace function public.link_existing_load_to_sales_order(
  p_sales_order_id uuid,
  p_load_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_so record;
  v_load record;
  v_item record;
  v_match_count integer;
  v_sales_order_item_id uuid;
  v_inserted integer := 0;
begin
  select id, so_number, client_id, importer_id, status into v_so
  from public.sales_orders
  where id = p_sales_order_id
  for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  if v_so.status <> 'confirmed' then raise exception 'SO_NOT_CONFIRMED'; end if;

  select l.id, l.load_number, l.status, l.client_id, l.importer_id, l.shipment_id,
         s.client_id as shipment_client_id, s.importer_id as shipment_importer_id
    into v_load
  from public.loads l
  left join public.shipments s on s.id = l.shipment_id
  where l.id = p_load_id
  for update of l;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded','dispatched') then raise exception 'SO_LOAD_REPAIR_STATUS_INVALID'; end if;

  if exists (
    select 1 from public.load_items li
    join public.sales_fulfillment_allocations sfa on sfa.load_item_id = li.id
    where li.load_id = p_load_id
  ) then raise exception 'LOAD_ALREADY_LINKED_TO_SALE'; end if;

  if v_load.client_id is not null and v_load.client_id <> v_so.client_id then raise exception 'LOAD_SALES_CONTEXT_MISMATCH'; end if;
  if v_load.importer_id is not null and v_load.importer_id is distinct from v_so.importer_id then raise exception 'LOAD_SALES_CONTEXT_MISMATCH'; end if;
  if v_load.shipment_client_id is not null and v_load.shipment_client_id <> v_so.client_id then raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH'; end if;
  if v_load.shipment_importer_id is not null and v_load.shipment_importer_id is distinct from v_so.importer_id then raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH'; end if;

  if v_load.shipment_id is not null then
    update public.shipments
       set client_id = coalesce(client_id, v_so.client_id),
           importer_id = coalesce(importer_id, v_so.importer_id)
     where id = v_load.shipment_id;
  end if;

  update public.loads
     set client_id = v_so.client_id,
         importer_id = v_so.importer_id
   where id = p_load_id;

  perform set_config('app.sales_load_repair', 'on', true);

  for v_item in
    select li.id, li.product_id, li.unit, li.planned_quantity, li.planned_pallets
    from public.load_items li
    where li.load_id = p_load_id
    order by li.created_at, li.id
  loop
    select count(*), (array_agg(soi.id order by soi.created_at, soi.id))[1]
      into v_match_count, v_sales_order_item_id
    from public.sales_order_items soi
    join public.sales_order_item_progress sip on sip.sales_order_item_id = soi.id
    where soi.sales_order_id = p_sales_order_id
      and soi.product_id = v_item.product_id
      and btrim(soi.unit) = btrim(v_item.unit)
      and sip.unallocated_quantity = v_item.planned_quantity
      and coalesce(sip.unallocated_pallets,0) = coalesce(v_item.planned_pallets,0);

    if v_match_count = 0 then raise exception 'NO_EXACT_SALES_LINE_MATCH'; end if;
    if v_match_count > 1 then raise exception 'AMBIGUOUS_SALES_LINE_MATCH'; end if;

    insert into public.sales_fulfillment_allocations(
      sales_order_item_id, load_item_id, allocated_quantity, allocated_pallets, created_by
    ) values (
      v_sales_order_item_id, v_item.id, v_item.planned_quantity, coalesce(v_item.planned_pallets,0), p_actor
    );
    v_inserted := v_inserted + 1;
  end loop;

  if v_inserted = 0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;

  return jsonb_build_object(
    'sales_order_id', p_sales_order_id,
    'so_number', v_so.so_number,
    'load_id', p_load_id,
    'load_number', v_load.load_number,
    'allocation_count', v_inserted
  );
end;
$function$;

revoke all on function public.sales_order_linkable_existing_loads(uuid) from public, anon, authenticated;
revoke all on function public.link_existing_load_to_sales_order(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.sales_order_linkable_existing_loads(uuid) to service_role;
grant execute on function public.link_existing_load_to_sales_order(uuid, uuid, uuid) to service_role;
