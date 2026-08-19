-- Mantiene cantidad y pallets coherentes en Cargues.
-- Si un WR define units_per_pallet y se asignan pallets completos sin cantidad,
-- PostgreSQL deriva la cantidad canónica automáticamente.

create function public.normalize_load_allocation_quantity()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_units_per_pallet numeric;
begin
  new.allocated_quantity := coalesce(new.allocated_quantity, 0);
  new.allocated_pallets := coalesce(new.allocated_pallets, 0);

  if new.allocated_quantity < 0 or new.allocated_pallets < 0 then
    raise exception 'LOAD_QUANTITY_INVALID';
  end if;

  if new.allocated_pallets > 0 and new.allocated_quantity = 0 then
    select units_per_pallet into v_units_per_pallet
    from public.warehouse_receipt_items
    where id = new.receipt_item_id;

    if coalesce(v_units_per_pallet, 0) <= 0 then
      raise exception 'LOAD_QUANTITY_REQUIRED_FOR_PALLETS';
    end if;

    new.allocated_quantity := new.allocated_pallets * v_units_per_pallet;
  end if;

  if new.allocated_quantity = 0 and new.allocated_pallets = 0 then
    raise exception 'LOAD_QUANTITY_REQUIRED';
  end if;

  return new;
end;
$$;

create trigger load_allocations_normalize_quantity
before insert or update of receipt_item_id, allocated_quantity, allocated_pallets
on public.load_allocations
for each row execute function public.normalize_load_allocation_quantity();

-- Repara cargues históricos activos creados antes de esta regla.
alter table public.load_allocations disable trigger load_allocations_guard_mutation;
alter table public.load_items disable trigger load_items_guard_mutation;

update public.load_allocations la
set allocated_quantity = la.allocated_pallets * wri.units_per_pallet,
    updated_at = now()
from public.load_items li
join public.loads l on l.id = li.load_id
join public.warehouse_receipt_items wri on wri.id = la.receipt_item_id
where li.id = la.load_item_id
  and l.status in ('draft','reserved','loading','loaded')
  and la.allocated_quantity = 0
  and la.allocated_pallets > 0
  and coalesce(wri.units_per_pallet,0) > 0;

update public.load_items li
set planned_quantity = totals.quantity,
    planned_pallets = totals.pallets,
    updated_at = now()
from (
  select la.load_item_id,
         sum(la.allocated_quantity) as quantity,
         sum(la.allocated_pallets) as pallets
  from public.load_allocations la
  group by la.load_item_id
) totals
join public.loads l on l.id = li.load_id
where totals.load_item_id = li.id
  and l.status in ('draft','reserved','loading','loaded')
  and (li.planned_quantity is distinct from totals.quantity
       or li.planned_pallets is distinct from totals.pallets);

alter table public.load_items enable trigger load_items_guard_mutation;
alter table public.load_allocations enable trigger load_allocations_guard_mutation;

-- Conserva el ledger: añade solo la diferencia de unidades reservadas faltante.
insert into public.inventory_movements (
  warehouse_id, product_id, receipt_item_id, movement_type,
  quantity_delta, pallets_delta, reserved_quantity_delta, reserved_pallets_delta,
  reference_type, reference_id, notes
)
select wr.warehouse_id,
       wri.product_id,
       req.receipt_item_id,
       case when req.required_quantity - coalesce(led.reserved_quantity,0) >= 0 then 'reserve' else 'release' end,
       0, 0,
       req.required_quantity - coalesce(led.reserved_quantity,0),
       0,
       'load',
       req.load_id,
       'Normalización histórica cantidad/pallets'
from (
  select l.id as load_id,
         la.receipt_item_id,
         sum(la.allocated_quantity) as required_quantity
  from public.loads l
  join public.load_items li on li.load_id = l.id
  join public.load_allocations la on la.load_item_id = li.id
  where l.status in ('reserved','loading','loaded')
  group by l.id, la.receipt_item_id
) req
join public.warehouse_receipt_items wri on wri.id = req.receipt_item_id
join public.warehouse_receipts wr on wr.id = wri.receipt_id
left join lateral (
  select sum(im.reserved_quantity_delta) as reserved_quantity
  from public.inventory_movements im
  where im.reference_type = 'load'
    and im.reference_id = req.load_id
    and im.receipt_item_id = req.receipt_item_id
) led on true
where req.required_quantity is distinct from coalesce(led.reserved_quantity,0);

-- Las funciones de plan toman la unidad desde Productos y recalculan totales desde allocations.
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
as $$
declare
  v_load public.loads;
  v_line jsonb;
  v_alloc jsonb;
  v_item_id uuid;
  v_product_unit text;
begin
  if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;

  insert into public.loads(warehouse_id, scheduled_at, notes, created_by)
  values (p_warehouse_id, p_scheduled_at, nullif(trim(p_notes),''), p_actor)
  returning * into v_load;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if nullif(v_line->>'product_id','') is null then raise exception 'PRODUCT_REQUIRED'; end if;
    select unit into v_product_unit from public.products where id=(v_line->>'product_id')::uuid;
    if not found then raise exception 'LOAD_PRODUCT_NOT_FOUND'; end if;

    insert into public.load_items(load_id, product_id, planned_quantity, planned_pallets, unit, notes)
    values (v_load.id,(v_line->>'product_id')::uuid,0,0,v_product_unit,nullif(trim(v_line->>'notes'),''))
    returning id into v_item_id;

    if jsonb_typeof(v_line->'allocations') <> 'array' or jsonb_array_length(v_line->'allocations') = 0 then raise exception 'LOAD_ALLOCATIONS_REQUIRED'; end if;

    for v_alloc in select value from jsonb_array_elements(v_line->'allocations')
    loop
      insert into public.load_allocations(load_item_id,receipt_item_id,allocated_quantity,allocated_pallets)
      values (v_item_id,(v_alloc->>'receipt_item_id')::uuid,coalesce((v_alloc->>'allocated_quantity')::numeric,0),coalesce((v_alloc->>'allocated_pallets')::numeric,0));
    end loop;

    update public.load_items li
    set planned_quantity=t.quantity, planned_pallets=t.pallets, updated_at=now()
    from (select sum(allocated_quantity) quantity,sum(allocated_pallets) pallets from public.load_allocations where load_item_id=v_item_id) t
    where li.id=v_item_id;
  end loop;

  return v_load;
end;
$$;

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
as $$
declare
  v_load public.loads;
  v_line jsonb;
  v_alloc jsonb;
  v_item_id uuid;
  v_product_unit text;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'draft' then raise exception 'LOAD_NOT_DRAFT'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines)=0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;

  delete from public.load_items where load_id=p_load_id;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    select unit into v_product_unit from public.products where id=(v_line->>'product_id')::uuid;
    if not found then raise exception 'LOAD_PRODUCT_NOT_FOUND'; end if;

    insert into public.load_items(load_id,product_id,planned_quantity,planned_pallets,unit,notes)
    values (p_load_id,(v_line->>'product_id')::uuid,0,0,v_product_unit,nullif(trim(v_line->>'notes'),''))
    returning id into v_item_id;

    if jsonb_typeof(v_line->'allocations') <> 'array' or jsonb_array_length(v_line->'allocations')=0 then raise exception 'LOAD_ALLOCATIONS_REQUIRED'; end if;
    for v_alloc in select value from jsonb_array_elements(v_line->'allocations')
    loop
      insert into public.load_allocations(load_item_id,receipt_item_id,allocated_quantity,allocated_pallets)
      values (v_item_id,(v_alloc->>'receipt_item_id')::uuid,coalesce((v_alloc->>'allocated_quantity')::numeric,0),coalesce((v_alloc->>'allocated_pallets')::numeric,0));
    end loop;

    update public.load_items li
    set planned_quantity=t.quantity, planned_pallets=t.pallets, updated_at=now()
    from (select sum(allocated_quantity) quantity,sum(allocated_pallets) pallets from public.load_allocations where load_item_id=v_item_id) t
    where li.id=v_item_id;
  end loop;

  update public.loads set scheduled_at=p_scheduled_at,notes=nullif(trim(p_notes),''),updated_at=now() where id=p_load_id returning * into v_load;
  return v_load;
end;
$$;

revoke all on function public.normalize_load_allocation_quantity() from public, anon, authenticated;
revoke all on function public.create_load_plan(uuid,jsonb,timestamptz,text,uuid) from public, anon, authenticated;
revoke all on function public.replace_load_plan(uuid,jsonb,timestamptz,text) from public, anon, authenticated;
grant execute on function public.create_load_plan(uuid,jsonb,timestamptz,text,uuid) to service_role;
grant execute on function public.replace_load_plan(uuid,jsonb,timestamptz,text) to service_role;
