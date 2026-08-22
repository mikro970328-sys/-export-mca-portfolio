-- B3.4 · Crear Cargue físicamente trazable desde una Sales Order confirmada.
-- La operación completa es atómica: Cargue + WR allocations + vínculo comercial SO → load_item.

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
  v_alloc jsonb;
  v_so_item record;
  v_load_item_id uuid;
  v_planned_quantity numeric;
  v_planned_pallets numeric;
begin
  if p_sales_order_id is null then raise exception 'SO_REQUIRED'; end if;
  if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'LOAD_HAS_NO_ITEMS';
  end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'SO_LOAD_PLAN_TOO_LARGE'; end if;

  select * into v_so
  from public.sales_orders
  where id = p_sales_order_id
  for update;

  if not found then raise exception 'SO_NOT_FOUND'; end if;
  if v_so.status <> 'confirmed' then raise exception 'SO_NOT_CONFIRMED'; end if;

  if exists (
    select 1
    from jsonb_array_elements(p_lines) line
    where jsonb_typeof(line) <> 'object'
       or nullif(btrim(line->>'sales_order_item_id'),'') is null
       or jsonb_typeof(line->'allocations') <> 'array'
       or jsonb_array_length(line->'allocations') = 0
  ) then
    raise exception 'SO_LOAD_PLAN_ENTRY_INVALID';
  end if;

  if exists (
    select 1
    from (
      select line->>'sales_order_item_id' as sales_order_item_id, count(*) as n
      from jsonb_array_elements(p_lines) line
      group by 1
      having count(*) > 1
    ) d
  ) then
    raise exception 'SO_LOAD_DUPLICATE_SALES_ITEM';
  end if;

  -- Lock selected SO items deterministically and verify they all belong to this SO.
  perform soi.id
  from public.sales_order_items soi
  where soi.sales_order_id = p_sales_order_id
    and soi.id in (
      select distinct (line->>'sales_order_item_id')::uuid
      from jsonb_array_elements(p_lines) line
    )
  order by soi.id
  for update;

  if (
    select count(*)
    from public.sales_order_items soi
    where soi.sales_order_id = p_sales_order_id
      and soi.id in (
        select distinct (line->>'sales_order_item_id')::uuid
        from jsonb_array_elements(p_lines) line
      )
  ) <> jsonb_array_length(p_lines) then
    raise exception 'SO_ITEM_NOT_IN_ORDER';
  end if;

  insert into public.loads(
    warehouse_id, scheduled_at, notes, created_by
  ) values (
    p_warehouse_id, p_scheduled_at, nullif(btrim(p_notes),''), p_actor
  )
  returning * into v_load;

  for v_line in
    select value
    from jsonb_array_elements(p_lines)
  loop
    select soi.id, soi.product_id, soi.unit, soi.ordered_pallets
      into v_so_item
    from public.sales_order_items soi
    where soi.id = (v_line->>'sales_order_item_id')::uuid
      and soi.sales_order_id = p_sales_order_id;

    if not found then raise exception 'SO_ITEM_NOT_IN_ORDER'; end if;

    insert into public.load_items(
      load_id, product_id, planned_quantity, planned_pallets, unit, notes
    ) values (
      v_load.id, v_so_item.product_id, 0, 0, v_so_item.unit,
      nullif(btrim(v_line->>'notes'),'')
    ) returning id into v_load_item_id;

    for v_alloc in
      select value
      from jsonb_array_elements(v_line->'allocations')
    loop
      if jsonb_typeof(v_alloc) <> 'object'
         or nullif(btrim(v_alloc->>'receipt_item_id'),'') is null then
        raise exception 'LOAD_ALLOCATION_INVALID';
      end if;

      insert into public.load_allocations(
        load_item_id, receipt_item_id, allocated_quantity, allocated_pallets
      ) values (
        v_load_item_id,
        (v_alloc->>'receipt_item_id')::uuid,
        coalesce(nullif(btrim(v_alloc->>'allocated_quantity'),'')::numeric,0),
        coalesce(nullif(btrim(v_alloc->>'allocated_pallets'),'')::numeric,0)
      );
    end loop;

    select coalesce(sum(la.allocated_quantity),0), coalesce(sum(la.allocated_pallets),0)
      into v_planned_quantity, v_planned_pallets
    from public.load_allocations la
    where la.load_item_id = v_load_item_id;

    update public.load_items
    set planned_quantity = v_planned_quantity,
        planned_pallets = v_planned_pallets,
        updated_at = now()
    where id = v_load_item_id;

    -- The commercial allocation mirrors the physical quantity of this load_item.
    -- If the SO itself does not track pallets, commercial pallets stay at zero.
    insert into public.sales_fulfillment_allocations(
      sales_order_item_id, load_item_id, allocated_quantity, allocated_pallets, created_by
    ) values (
      v_so_item.id,
      v_load_item_id,
      v_planned_quantity,
      case when coalesce(v_so_item.ordered_pallets,0) > 0 then v_planned_pallets else 0 end,
      p_actor
    );
  end loop;

  select * into v_load from public.loads where id = v_load.id;
  return v_load;
end;
$function$;

revoke all on function public.create_load_from_sales_order(uuid,uuid,jsonb,timestamptz,text,uuid) from public, anon, authenticated;
grant execute on function public.create_load_from_sales_order(uuid,uuid,jsonb,timestamptz,text,uuid) to service_role;

comment on function public.create_load_from_sales_order(uuid,uuid,jsonb,timestamptz,text,uuid)
is 'Crea atómicamente un Cargue draft desde una SO confirmada, asignando WR físicos y trazabilidad comercial SO → load_item.';
