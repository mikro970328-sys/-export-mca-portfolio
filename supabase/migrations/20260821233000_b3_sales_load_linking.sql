-- B3.2 · Vinculación transaccional Sales Order → Cargue
-- Toda mutación del plan comercial de un Cargue pasa por esta RPC.
-- No crea ni modifica reservas físicas de inventario.

create or replace function public.replace_load_sales_plan(
  p_load_id uuid,
  p_allocations jsonb,
  p_actor uuid default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_load public.loads;
  v_expected_so_items integer;
  v_found_so_items integer;
  v_expected_load_items integer;
  v_found_load_items integer;
  v_entry record;
begin
  if p_allocations is null or jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'SO_LOAD_PLAN_MUST_BE_ARRAY';
  end if;

  if jsonb_array_length(p_allocations) > 500 then
    raise exception 'SO_LOAD_PLAN_TOO_LARGE';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_allocations) e
    where nullif(btrim(e->>'sales_order_item_id'),'') is null
       or nullif(btrim(e->>'load_item_id'),'') is null
       or coalesce((e->>'allocated_quantity')::numeric,0) <= 0
       or coalesce((e->>'allocated_pallets')::numeric,0) < 0
  ) then
    raise exception 'SO_LOAD_PLAN_ENTRY_INVALID';
  end if;

  if exists (
    select 1
    from (
      select e->>'sales_order_item_id' as so_item_id,
             e->>'load_item_id' as load_item_id,
             count(*) as n
      from jsonb_array_elements(p_allocations) e
      group by 1,2
      having count(*) > 1
    ) d
  ) then
    raise exception 'SO_LOAD_PLAN_DUPLICATE_ENTRY';
  end if;

  -- Lock commercial source rows first, in deterministic order. This serializes
  -- competing plans that try to consume the same Sales Order lines.
  select count(distinct e->>'sales_order_item_id')
    into v_expected_so_items
  from jsonb_array_elements(p_allocations) e;

  perform soi.id
  from public.sales_order_items soi
  join public.sales_orders so on so.id = soi.sales_order_id
  where soi.id in (
    select distinct (e->>'sales_order_item_id')::uuid
    from jsonb_array_elements(p_allocations) e
  )
  order by soi.id
  for update of soi, so;

  select count(*)
    into v_found_so_items
  from public.sales_order_items soi
  where soi.id in (
    select distinct (e->>'sales_order_item_id')::uuid
    from jsonb_array_elements(p_allocations) e
  );

  if v_found_so_items <> v_expected_so_items then
    raise exception 'SO_ITEM_NOT_FOUND';
  end if;

  select * into v_load
  from public.loads
  where id = p_load_id
  for update;

  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'draft' then raise exception 'SO_LOAD_NOT_DRAFT'; end if;

  -- Lock all lines of this Cargue so its commercial plan cannot race with a
  -- concurrent replacement or structural edit.
  perform li.id
  from public.load_items li
  where li.load_id = p_load_id
  order by li.id
  for update;

  select count(distinct e->>'load_item_id')
    into v_expected_load_items
  from jsonb_array_elements(p_allocations) e;

  select count(*)
    into v_found_load_items
  from public.load_items li
  where li.load_id = p_load_id
    and li.id in (
      select distinct (e->>'load_item_id')::uuid
      from jsonb_array_elements(p_allocations) e
    );

  if v_found_load_items <> v_expected_load_items then
    raise exception 'SO_LOAD_ITEM_NOT_IN_LOAD';
  end if;

  -- Replace, never patch. Any failure below rolls the transaction back and
  -- restores the previous plan automatically.
  delete from public.sales_fulfillment_allocations sfa
  using public.load_items li
  where sfa.load_item_id = li.id
    and li.load_id = p_load_id;

  for v_entry in
    select
      (e->>'sales_order_item_id')::uuid as sales_order_item_id,
      (e->>'load_item_id')::uuid as load_item_id,
      (e->>'allocated_quantity')::numeric as allocated_quantity,
      coalesce((e->>'allocated_pallets')::numeric,0) as allocated_pallets
    from jsonb_array_elements(p_allocations) e
    order by (e->>'sales_order_item_id')::uuid, (e->>'load_item_id')::uuid
  loop
    insert into public.sales_fulfillment_allocations (
      sales_order_item_id,
      load_item_id,
      allocated_quantity,
      allocated_pallets,
      created_by
    ) values (
      v_entry.sales_order_item_id,
      v_entry.load_item_id,
      v_entry.allocated_quantity,
      v_entry.allocated_pallets,
      p_actor
    );
  end loop;

  select * into v_load
  from public.loads
  where id = p_load_id;

  return v_load;
end;
$function$;

revoke insert, update, delete on table public.sales_fulfillment_allocations from service_role;
grant select on table public.sales_fulfillment_allocations to service_role;

revoke all on function public.replace_load_sales_plan(uuid,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.replace_load_sales_plan(uuid,jsonb,uuid) to service_role;

comment on function public.replace_load_sales_plan(uuid,jsonb,uuid) is
'Reemplaza atómicamente el plan comercial SO→Cargue. Serializa líneas de Sales Order y Cargue; no toca reservas ni movimientos físicos de inventario.';
