-- A2 · Reserva por WR
-- Reserva/libera inventario de un cargue de forma transaccional y serializada.
-- No implementa UI, despacho ni Tracking.

create function public.guard_load_item_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_load_id uuid;
  v_status text;
begin
  v_load_id := coalesce(new.load_id, old.load_id);
  select status into v_status from public.loads where id = v_load_id;
  if v_status is distinct from 'draft' then
    raise exception 'LOAD_NOT_DRAFT';
  end if;

  if tg_op = 'UPDATE'
     and (new.load_id is distinct from old.load_id or new.product_id is distinct from old.product_id)
     and exists (select 1 from public.load_allocations where load_item_id = old.id) then
    raise exception 'LOAD_ITEM_HAS_ALLOCATIONS';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger load_items_guard_mutation
before insert or update or delete on public.load_items
for each row execute function public.guard_load_item_mutation();

create function public.guard_load_allocation_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_load_item_id uuid;
  v_status text;
begin
  v_load_item_id := coalesce(new.load_item_id, old.load_item_id);
  select l.status into v_status
  from public.load_items li
  join public.loads l on l.id = li.load_id
  where li.id = v_load_item_id;

  if v_status is distinct from 'draft' then
    raise exception 'LOAD_NOT_DRAFT';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger load_allocations_guard_mutation
before insert or update or delete on public.load_allocations
for each row execute function public.guard_load_allocation_mutation();

create function public.guard_load_structure_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.warehouse_id is distinct from old.warehouse_id
     and exists (
       select 1
       from public.load_items li
       join public.load_allocations la on la.load_item_id = li.id
       where li.load_id = old.id
     ) then
    raise exception 'LOAD_WAREHOUSE_HAS_ALLOCATIONS';
  end if;
  return new;
end;
$$;

create trigger loads_guard_structure_change
before update of warehouse_id on public.loads
for each row execute function public.guard_load_structure_change();

create function public.guard_wr_cancellation_after_allocation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'received' and new.status = 'cancelled' then
    if exists (
      select 1
      from public.warehouse_receipt_items wri
      join public.inventory_movements im on im.receipt_item_id = wri.id
      where wri.receipt_id = old.id
    ) then
      raise exception 'WR_HAS_INVENTORY_HISTORY';
    end if;

    if exists (
      select 1
      from public.warehouse_receipt_items wri
      join public.load_allocations la on la.receipt_item_id = wri.id
      join public.load_items li on li.id = la.load_item_id
      join public.loads l on l.id = li.load_id
      where wri.receipt_id = old.id
        and l.status <> 'cancelled'
    ) then
      raise exception 'WR_ASSIGNED_TO_LOAD';
    end if;
  end if;
  return new;
end;
$$;

create trigger warehouse_receipts_guard_cancellation
before update of status on public.warehouse_receipts
for each row execute function public.guard_wr_cancellation_after_allocation();

create function public.guard_load_status_transition()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_transition text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'LOAD_MUST_START_DRAFT';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  v_transition := current_setting('export_mca.load_transition', true);

  if old.status = 'draft' and new.status = 'reserved' and v_transition = 'reserve' then
    return new;
  end if;
  if old.status = 'reserved' and new.status = 'draft' and v_transition = 'release' then
    return new;
  end if;

  raise exception 'INVALID_LOAD_STATUS_TRANSITION: % -> %', old.status, new.status;
end;
$$;

create trigger loads_guard_status_transition_insert
before insert on public.loads
for each row execute function public.guard_load_status_transition();

create trigger loads_guard_status_transition_update
before update of status on public.loads
for each row execute function public.guard_load_status_transition();

create function public.reserve_load(p_load_id uuid, p_actor uuid default null)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.loads;
  v_bad record;
  v_ledger_qty numeric;
  v_ledger_pallets numeric;
begin
  select * into v_load
  from public.loads
  where id = p_load_id
  for update;

  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'draft' then raise exception 'LOAD_NOT_DRAFT'; end if;

  if not exists (select 1 from public.load_items where load_id = p_load_id) then
    raise exception 'LOAD_HAS_NO_ITEMS';
  end if;

  select li.id,
         li.planned_quantity,
         li.planned_pallets,
         coalesce(sum(la.allocated_quantity),0) as allocated_quantity,
         coalesce(sum(la.allocated_pallets),0) as allocated_pallets
    into v_bad
  from public.load_items li
  left join public.load_allocations la on la.load_item_id = li.id
  where li.load_id = p_load_id
  group by li.id, li.planned_quantity, li.planned_pallets
  having coalesce(sum(la.allocated_quantity),0) <> li.planned_quantity
      or coalesce(sum(la.allocated_pallets),0) <> li.planned_pallets
  limit 1;

  if found then raise exception 'LOAD_ALLOCATIONS_INCOMPLETE'; end if;

  -- Serializa todas las fuentes WR del cargue en un orden determinista.
  perform wri.id
  from public.warehouse_receipt_items wri
  join public.load_allocations la on la.receipt_item_id = wri.id
  join public.load_items li on li.id = la.load_item_id
  where li.load_id = p_load_id
  order by wri.id
  for update of wri;

  select coalesce(sum(im.reserved_quantity_delta),0),
         coalesce(sum(im.reserved_pallets_delta),0)
    into v_ledger_qty, v_ledger_pallets
  from public.inventory_movements im
  where im.reference_type = 'load' and im.reference_id = p_load_id;

  if v_ledger_qty <> 0 or v_ledger_pallets <> 0 then
    raise exception 'LOAD_RESERVATION_LEDGER_NOT_ZERO';
  end if;

  select src.receipt_item_id,
         src.physical_quantity - src.reserved_quantity as available_quantity,
         src.physical_pallets - src.reserved_pallets as available_pallets,
         req.allocated_quantity,
         req.allocated_pallets
    into v_bad
  from (
    select la.receipt_item_id,
           sum(la.allocated_quantity) as allocated_quantity,
           sum(la.allocated_pallets) as allocated_pallets
    from public.load_allocations la
    join public.load_items li on li.id = la.load_item_id
    where li.load_id = p_load_id
    group by la.receipt_item_id
  ) req
  left join public.inventory_source_balances src on src.receipt_item_id = req.receipt_item_id
  where src.receipt_item_id is null
     or src.physical_quantity - src.reserved_quantity < req.allocated_quantity
     or src.physical_pallets - src.reserved_pallets < req.allocated_pallets
  limit 1;

  if found then raise exception 'INSUFFICIENT_WR_AVAILABLE_BALANCE'; end if;

  insert into public.inventory_movements (
    warehouse_id, product_id, receipt_item_id, movement_type,
    quantity_delta, pallets_delta, reserved_quantity_delta, reserved_pallets_delta,
    reference_type, reference_id, notes, created_by
  )
  select wr.warehouse_id,
         wri.product_id,
         req.receipt_item_id,
         'reserve',
         0, 0,
         req.allocated_quantity,
         req.allocated_pallets,
         'load',
         p_load_id,
         'Reserva ' || v_load.load_number,
         p_actor
  from (
    select la.receipt_item_id,
           sum(la.allocated_quantity) as allocated_quantity,
           sum(la.allocated_pallets) as allocated_pallets
    from public.load_allocations la
    join public.load_items li on li.id = la.load_item_id
    where li.load_id = p_load_id
    group by la.receipt_item_id
  ) req
  join public.warehouse_receipt_items wri on wri.id = req.receipt_item_id
  join public.warehouse_receipts wr on wr.id = wri.receipt_id;

  perform set_config('export_mca.load_transition','reserve',true);
  update public.loads set status = 'reserved', updated_at = now() where id = p_load_id
  returning * into v_load;
  return v_load;
end;
$$;

create function public.release_load(p_load_id uuid, p_actor uuid default null)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.loads;
  v_alloc_qty numeric;
  v_alloc_pallets numeric;
  v_ledger_qty numeric;
  v_ledger_pallets numeric;
begin
  select * into v_load
  from public.loads
  where id = p_load_id
  for update;

  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'reserved' then raise exception 'LOAD_NOT_RESERVED'; end if;

  perform wri.id
  from public.warehouse_receipt_items wri
  join public.load_allocations la on la.receipt_item_id = wri.id
  join public.load_items li on li.id = la.load_item_id
  where li.load_id = p_load_id
  order by wri.id
  for update of wri;

  select coalesce(sum(la.allocated_quantity),0), coalesce(sum(la.allocated_pallets),0)
    into v_alloc_qty, v_alloc_pallets
  from public.load_allocations la
  join public.load_items li on li.id = la.load_item_id
  where li.load_id = p_load_id;

  select coalesce(sum(im.reserved_quantity_delta),0), coalesce(sum(im.reserved_pallets_delta),0)
    into v_ledger_qty, v_ledger_pallets
  from public.inventory_movements im
  where im.reference_type = 'load' and im.reference_id = p_load_id;

  if v_ledger_qty <> v_alloc_qty or v_ledger_pallets <> v_alloc_pallets then
    raise exception 'LOAD_RESERVATION_LEDGER_MISMATCH';
  end if;

  insert into public.inventory_movements (
    warehouse_id, product_id, receipt_item_id, movement_type,
    quantity_delta, pallets_delta, reserved_quantity_delta, reserved_pallets_delta,
    reference_type, reference_id, notes, created_by
  )
  select wr.warehouse_id,
         wri.product_id,
         req.receipt_item_id,
         'release',
         0, 0,
         -req.allocated_quantity,
         -req.allocated_pallets,
         'load',
         p_load_id,
         'Liberación ' || v_load.load_number,
         p_actor
  from (
    select la.receipt_item_id,
           sum(la.allocated_quantity) as allocated_quantity,
           sum(la.allocated_pallets) as allocated_pallets
    from public.load_allocations la
    join public.load_items li on li.id = la.load_item_id
    where li.load_id = p_load_id
    group by la.receipt_item_id
  ) req
  join public.warehouse_receipt_items wri on wri.id = req.receipt_item_id
  join public.warehouse_receipts wr on wr.id = wri.receipt_id;

  perform set_config('export_mca.load_transition','release',true);
  update public.loads set status = 'draft', updated_at = now() where id = p_load_id
  returning * into v_load;
  return v_load;
end;
$$;

revoke all on function public.guard_load_item_mutation() from public, anon, authenticated;
revoke all on function public.guard_load_allocation_mutation() from public, anon, authenticated;
revoke all on function public.guard_load_structure_change() from public, anon, authenticated;
revoke all on function public.guard_wr_cancellation_after_allocation() from public, anon, authenticated;
revoke all on function public.guard_load_status_transition() from public, anon, authenticated;
revoke all on function public.reserve_load(uuid,uuid) from public, anon, authenticated;
revoke all on function public.release_load(uuid,uuid) from public, anon, authenticated;

grant execute on function public.reserve_load(uuid,uuid) to service_role;
grant execute on function public.release_load(uuid,uuid) to service_role;

comment on function public.reserve_load(uuid,uuid) is 'Reserva atómicamente las allocations de un cargue por WR y registra el ledger.';
comment on function public.release_load(uuid,uuid) is 'Libera atómicamente una reserva de cargue y conserva su historial en el ledger.';
