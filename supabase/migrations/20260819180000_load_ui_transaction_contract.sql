-- UI Cargues · contrato transaccional de creación/edición del plan
-- El navegador nunca crea loads/items/allocations en pasos separados.

create function public.create_load_plan(
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
as $$
declare
  v_load public.loads;
  v_line jsonb;
  v_alloc jsonb;
  v_item_id uuid;
begin
  if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'LOAD_HAS_NO_ITEMS';
  end if;

  insert into public.loads(warehouse_id, scheduled_at, notes, created_by)
  values (p_warehouse_id, p_scheduled_at, nullif(trim(p_notes),''), p_actor)
  returning * into v_load;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if nullif(v_line->>'product_id','') is null then raise exception 'PRODUCT_REQUIRED'; end if;
    if coalesce((v_line->>'planned_quantity')::numeric,0) < 0 or coalesce((v_line->>'planned_pallets')::numeric,0) < 0 then
      raise exception 'LOAD_QUANTITY_INVALID';
    end if;
    if coalesce((v_line->>'planned_quantity')::numeric,0) = 0 and coalesce((v_line->>'planned_pallets')::numeric,0) = 0 then
      raise exception 'LOAD_QUANTITY_REQUIRED';
    end if;

    insert into public.load_items(load_id, product_id, planned_quantity, planned_pallets, unit, notes)
    values (
      v_load.id,
      (v_line->>'product_id')::uuid,
      coalesce((v_line->>'planned_quantity')::numeric,0),
      coalesce((v_line->>'planned_pallets')::numeric,0),
      coalesce(nullif(trim(v_line->>'unit'),''),'unit'),
      nullif(trim(v_line->>'notes'),'')
    ) returning id into v_item_id;

    if jsonb_typeof(v_line->'allocations') <> 'array' or jsonb_array_length(v_line->'allocations') = 0 then
      raise exception 'LOAD_ALLOCATIONS_REQUIRED';
    end if;

    for v_alloc in select value from jsonb_array_elements(v_line->'allocations')
    loop
      insert into public.load_allocations(load_item_id, receipt_item_id, allocated_quantity, allocated_pallets)
      values (
        v_item_id,
        (v_alloc->>'receipt_item_id')::uuid,
        coalesce((v_alloc->>'allocated_quantity')::numeric,0),
        coalesce((v_alloc->>'allocated_pallets')::numeric,0)
      );
    end loop;
  end loop;

  -- La reserva valida que el plan total y las allocations cuadren; aquí hacemos la misma comprobación sin reservar.
  if exists (
    select 1
    from public.load_items li
    left join public.load_allocations la on la.load_item_id = li.id
    where li.load_id = v_load.id
    group by li.id, li.planned_quantity, li.planned_pallets
    having coalesce(sum(la.allocated_quantity),0) <> li.planned_quantity
        or coalesce(sum(la.allocated_pallets),0) <> li.planned_pallets
  ) then
    raise exception 'LOAD_ALLOCATIONS_INCOMPLETE';
  end if;

  return v_load;
end;
$$;

create function public.replace_load_plan(
  p_load_id uuid,
  p_lines jsonb,
  p_scheduled_at timestamptz default null,
  p_notes text default null
)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.loads;
  v_line jsonb;
  v_alloc jsonb;
  v_item_id uuid;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'draft' then raise exception 'LOAD_NOT_DRAFT'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;

  delete from public.load_items where load_id=p_load_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    insert into public.load_items(load_id, product_id, planned_quantity, planned_pallets, unit, notes)
    values (
      p_load_id,
      (v_line->>'product_id')::uuid,
      coalesce((v_line->>'planned_quantity')::numeric,0),
      coalesce((v_line->>'planned_pallets')::numeric,0),
      coalesce(nullif(trim(v_line->>'unit'),''),'unit'),
      nullif(trim(v_line->>'notes'),'')
    ) returning id into v_item_id;

    if jsonb_typeof(v_line->'allocations') <> 'array' or jsonb_array_length(v_line->'allocations')=0 then raise exception 'LOAD_ALLOCATIONS_REQUIRED'; end if;
    for v_alloc in select value from jsonb_array_elements(v_line->'allocations')
    loop
      insert into public.load_allocations(load_item_id, receipt_item_id, allocated_quantity, allocated_pallets)
      values (v_item_id,(v_alloc->>'receipt_item_id')::uuid,coalesce((v_alloc->>'allocated_quantity')::numeric,0),coalesce((v_alloc->>'allocated_pallets')::numeric,0));
    end loop;
  end loop;

  if exists (
    select 1 from public.load_items li
    left join public.load_allocations la on la.load_item_id=li.id
    where li.load_id=p_load_id
    group by li.id,li.planned_quantity,li.planned_pallets
    having coalesce(sum(la.allocated_quantity),0)<>li.planned_quantity
        or coalesce(sum(la.allocated_pallets),0)<>li.planned_pallets
  ) then raise exception 'LOAD_ALLOCATIONS_INCOMPLETE'; end if;

  update public.loads set scheduled_at=p_scheduled_at,notes=nullif(trim(p_notes),''),updated_at=now() where id=p_load_id returning * into v_load;
  return v_load;
end;
$$;

revoke all on function public.create_load_plan(uuid,jsonb,timestamptz,text,uuid) from public,anon,authenticated;
revoke all on function public.replace_load_plan(uuid,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.create_load_plan(uuid,jsonb,timestamptz,text,uuid) to service_role;
grant execute on function public.replace_load_plan(uuid,jsonb,timestamptz,text) to service_role;
