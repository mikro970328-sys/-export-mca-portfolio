-- B3.4 forward migration · Corrige el núcleo de Cargues para respetar
-- load_items_planned_positive_check desde el INSERT inicial.

create or replace function public.insert_load_item_with_allocations(
  p_load_id uuid,
  p_product_id uuid,
  p_allocations jsonb,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_product_unit text;
  v_alloc jsonb;
  v_receipt_item_id uuid;
  v_quantity numeric;
  v_pallets numeric;
  v_units_per_pallet numeric;
  v_total_quantity numeric := 0;
  v_total_pallets numeric := 0;
  v_load_item_id uuid;
begin
  if p_load_id is null then raise exception 'LOAD_NOT_FOUND'; end if;
  if p_product_id is null then raise exception 'PRODUCT_REQUIRED'; end if;

  select unit into v_product_unit
  from public.products
  where id = p_product_id;
  if not found then raise exception 'LOAD_PRODUCT_NOT_FOUND'; end if;

  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' or jsonb_array_length(p_allocations) = 0 then
    raise exception 'LOAD_ALLOCATIONS_REQUIRED';
  end if;

  for v_alloc in select value from jsonb_array_elements(p_allocations)
  loop
    if jsonb_typeof(v_alloc) <> 'object' or nullif(btrim(v_alloc->>'receipt_item_id'),'') is null then
      raise exception 'LOAD_ALLOCATION_INVALID';
    end if;

    v_receipt_item_id := (v_alloc->>'receipt_item_id')::uuid;
    v_quantity := coalesce(nullif(btrim(v_alloc->>'allocated_quantity'),'')::numeric,0);
    v_pallets := coalesce(nullif(btrim(v_alloc->>'allocated_pallets'),'')::numeric,0);

    if v_quantity < 0 or v_pallets < 0 then raise exception 'LOAD_QUANTITY_INVALID'; end if;

    if v_pallets > 0 and v_quantity = 0 then
      select units_per_pallet into v_units_per_pallet
      from public.warehouse_receipt_items
      where id = v_receipt_item_id;
      if not found then raise exception 'RECEIPT_ITEM_NOT_FOUND'; end if;
      if coalesce(v_units_per_pallet,0) <= 0 then raise exception 'LOAD_QUANTITY_REQUIRED_FOR_PALLETS'; end if;
      v_quantity := v_pallets * v_units_per_pallet;
    end if;

    if v_quantity = 0 and v_pallets = 0 then raise exception 'LOAD_QUANTITY_REQUIRED'; end if;

    v_total_quantity := v_total_quantity + v_quantity;
    v_total_pallets := v_total_pallets + v_pallets;
  end loop;

  if v_total_quantity <= 0 and v_total_pallets <= 0 then raise exception 'LOAD_QUANTITY_REQUIRED'; end if;

  insert into public.load_items(
    load_id, product_id, planned_quantity, planned_pallets, unit, notes
  ) values (
    p_load_id, p_product_id, v_total_quantity, v_total_pallets, v_product_unit,
    nullif(btrim(p_notes),'')
  ) returning id into v_load_item_id;

  for v_alloc in select value from jsonb_array_elements(p_allocations)
  loop
    insert into public.load_allocations(
      load_item_id, receipt_item_id, allocated_quantity, allocated_pallets
    ) values (
      v_load_item_id,
      (v_alloc->>'receipt_item_id')::uuid,
      coalesce(nullif(btrim(v_alloc->>'allocated_quantity'),'')::numeric,0),
      coalesce(nullif(btrim(v_alloc->>'allocated_pallets'),'')::numeric,0)
    );
  end loop;

  return v_load_item_id;
end;
$function$;

revoke all on function public.insert_load_item_with_allocations(uuid,uuid,jsonb,text) from public, anon, authenticated;

create or replace function public.create_load_plan(
  p_warehouse_id uuid,
  p_lines jsonb,
  p_scheduled_at timestamptz default null,
  p_notes text default null,
  p_actor uuid default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_load public.loads;
  v_line jsonb;
begin
  if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;

  insert into public.loads(warehouse_id, scheduled_at, notes, created_by)
  values (p_warehouse_id, p_scheduled_at, nullif(btrim(p_notes),''), p_actor)
  returning * into v_load;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' or nullif(btrim(v_line->>'product_id'),'') is null then raise exception 'PRODUCT_REQUIRED'; end if;
    perform public.insert_load_item_with_allocations(
      v_load.id,
      (v_line->>'product_id')::uuid,
      v_line->'allocations',
      v_line->>'notes'
    );
  end loop;

  return v_load;
end;
$function$;

create or replace function public.replace_load_plan(
  p_load_id uuid,
  p_lines jsonb,
  p_scheduled_at timestamptz default null,
  p_notes text default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_load public.loads;
  v_line jsonb;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'draft' then raise exception 'LOAD_NOT_DRAFT'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;

  delete from public.load_items where load_id = p_load_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' or nullif(btrim(v_line->>'product_id'),'') is null then raise exception 'PRODUCT_REQUIRED'; end if;
    perform public.insert_load_item_with_allocations(
      p_load_id,
      (v_line->>'product_id')::uuid,
      v_line->'allocations',
      v_line->>'notes'
    );
  end loop;

  update public.loads
  set scheduled_at = p_scheduled_at,
      notes = nullif(btrim(p_notes),''),
      updated_at = now()
  where id = p_load_id
  returning * into v_load;

  return v_load;
end;
$function$;

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
set search_path = public
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
      from jsonb_array_elements(p_lines) line
      group by 1
      having count(*) > 1
    ) d
  ) then raise exception 'SO_LOAD_DUPLICATE_SALES_ITEM'; end if;

  perform soi.id
  from public.sales_order_items soi
  where soi.sales_order_id = p_sales_order_id
    and soi.id in (select distinct (line->>'sales_order_item_id')::uuid from jsonb_array_elements(p_lines) line)
  order by soi.id
  for update;

  if (
    select count(*) from public.sales_order_items soi
    where soi.sales_order_id = p_sales_order_id
      and soi.id in (select distinct (line->>'sales_order_item_id')::uuid from jsonb_array_elements(p_lines) line)
  ) <> jsonb_array_length(p_lines) then raise exception 'SO_ITEM_NOT_IN_ORDER'; end if;

  insert into public.loads(warehouse_id, scheduled_at, notes, created_by)
  values (p_warehouse_id, p_scheduled_at, nullif(btrim(p_notes),''), p_actor)
  returning * into v_load;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select soi.id, soi.product_id, soi.ordered_pallets
      into v_so_item
    from public.sales_order_items soi
    where soi.id = (v_line->>'sales_order_item_id')::uuid
      and soi.sales_order_id = p_sales_order_id;
    if not found then raise exception 'SO_ITEM_NOT_IN_ORDER'; end if;

    v_load_item_id := public.insert_load_item_with_allocations(
      v_load.id,
      v_so_item.product_id,
      v_line->'allocations',
      v_line->>'notes'
    );

    select * into v_load_item from public.load_items where id = v_load_item_id;

    insert into public.sales_fulfillment_allocations(
      sales_order_item_id, load_item_id, allocated_quantity, allocated_pallets, created_by
    ) values (
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

revoke all on function public.create_load_from_sales_order(uuid,uuid,jsonb,timestamptz,text,uuid) from public, anon, authenticated;
grant execute on function public.create_load_from_sales_order(uuid,uuid,jsonb,timestamptz,text,uuid) to service_role;
