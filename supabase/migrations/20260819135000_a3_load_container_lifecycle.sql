-- A3 · Cargue + Contenedor + salida física
-- Extiende el ciclo reservado → en carga → cargado → despachado.
-- Mantiene separados los estados físicos del cargue y los estados marítimos de Tracking.

create or replace function public.guard_load_status_transition()
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

  if old.status = 'draft' and new.status = 'reserved' and v_transition = 'reserve' then return new; end if;
  if old.status = 'reserved' and new.status = 'draft' and v_transition = 'release' then return new; end if;
  if old.status = 'reserved' and new.status = 'loading' and v_transition = 'start_loading' then return new; end if;
  if old.status = 'loading' and new.status = 'loaded' and v_transition = 'mark_loaded' then return new; end if;
  if old.status = 'loaded' and new.status = 'dispatched' and v_transition = 'dispatch' then return new; end if;
  if old.status in ('draft','reserved') and new.status = 'cancelled' and v_transition = 'cancel' then return new; end if;

  raise exception 'INVALID_LOAD_STATUS_TRANSITION: % -> %', old.status, new.status;
end;
$$;

create function public.validate_load_shipment_link()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_status text;
  v_active boolean;
  v_delivered_at timestamptz;
  v_released_at timestamptz;
  v_discharged_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.shipment_id is not distinct from old.shipment_id then
    return new;
  end if;

  v_status := case when tg_op = 'INSERT' then new.status else old.status end;
  if v_status not in ('draft','reserved') then
    raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS';
  end if;

  if new.shipment_id is null then
    return new;
  end if;

  select active, delivered_at, released_at, discharged_at
    into v_active, v_delivered_at, v_released_at, v_discharged_at
  from public.shipments
  where id = new.shipment_id
  for update;

  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_active is not true or v_delivered_at is not null or v_released_at is not null or v_discharged_at is not null then
    raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD';
  end if;

  return new;
end;
$$;

create trigger loads_validate_shipment_link
before insert or update of shipment_id on public.loads
for each row execute function public.validate_load_shipment_link();

create function public.assign_load_shipment(p_load_id uuid, p_shipment_id uuid)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.loads;
  v_ship public.shipments;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;

  select * into v_ship from public.shipments where id = p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_ship.active is not true or v_ship.delivered_at is not null or v_ship.released_at is not null or v_ship.discharged_at is not null then
    raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD';
  end if;

  update public.loads
  set shipment_id = p_shipment_id, updated_at = now()
  where id = p_load_id
  returning * into v_load;

  return v_load;
end;
$$;

create function public.unassign_load_shipment(p_load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.loads;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved') then raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS'; end if;

  update public.loads
  set shipment_id = null, updated_at = now()
  where id = p_load_id
  returning * into v_load;
  return v_load;
end;
$$;

create function public.start_load_loading(p_load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.loads;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'reserved' then raise exception 'LOAD_NOT_RESERVED'; end if;
  if v_load.shipment_id is null then raise exception 'LOAD_HAS_NO_CONTAINER'; end if;

  perform 1 from public.shipments
  where id = v_load.shipment_id and active is true and delivered_at is null and released_at is null and discharged_at is null
  for update;
  if not found then raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'; end if;

  perform set_config('export_mca.load_transition','start_loading',true);
  update public.loads
  set status='loading', loading_started_at=now(), updated_at=now()
  where id=p_load_id
  returning * into v_load;
  return v_load;
end;
$$;

create function public.mark_load_loaded(p_load_id uuid)
returns public.loads
language plpgsql
security definer
set search_path = public
as $$
declare
  v_load public.loads;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'loading' then raise exception 'LOAD_NOT_LOADING'; end if;
  if v_load.shipment_id is null then raise exception 'LOAD_HAS_NO_CONTAINER'; end if;

  perform 1 from public.shipments
  where id = v_load.shipment_id and active is true and delivered_at is null and released_at is null and discharged_at is null
  for update;
  if not found then raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'; end if;

  perform set_config('export_mca.load_transition','mark_loaded',true);
  update public.loads
  set status='loaded', loaded_at=now(), updated_at=now()
  where id=p_load_id
  returning * into v_load;
  return v_load;
end;
$$;

create function public.dispatch_load(p_load_id uuid, p_actor uuid default null)
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
  v_bad record;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status <> 'loaded' then raise exception 'LOAD_NOT_LOADED'; end if;
  if v_load.shipment_id is null then raise exception 'LOAD_HAS_NO_CONTAINER'; end if;

  perform 1 from public.shipments
  where id = v_load.shipment_id and active is true and delivered_at is null and released_at is null and discharged_at is null
  for update;
  if not found then raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'; end if;

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
  where im.reference_type='load' and im.reference_id=p_load_id;

  if v_ledger_qty <> v_alloc_qty or v_ledger_pallets <> v_alloc_pallets then
    raise exception 'LOAD_RESERVATION_LEDGER_MISMATCH';
  end if;

  select src.receipt_item_id
    into v_bad
  from (
    select la.receipt_item_id,
           sum(la.allocated_quantity) as allocated_quantity,
           sum(la.allocated_pallets) as allocated_pallets
    from public.load_allocations la
    join public.load_items li on li.id=la.load_item_id
    where li.load_id=p_load_id
    group by la.receipt_item_id
  ) req
  left join public.inventory_source_balances src on src.receipt_item_id=req.receipt_item_id
  where src.receipt_item_id is null
     or src.physical_quantity < req.allocated_quantity
     or src.physical_pallets < req.allocated_pallets
     or src.physical_quantity < src.reserved_quantity
     or src.physical_pallets < src.reserved_pallets
  limit 1;
  if found then raise exception 'INSUFFICIENT_WR_PHYSICAL_BALANCE'; end if;

  insert into public.inventory_movements (
    warehouse_id, product_id, receipt_item_id, movement_type,
    quantity_delta, pallets_delta, reserved_quantity_delta, reserved_pallets_delta,
    reference_type, reference_id, notes, created_by
  )
  select wr.warehouse_id,
         wri.product_id,
         req.receipt_item_id,
         'dispatch',
         -req.allocated_quantity,
         -req.allocated_pallets,
         -req.allocated_quantity,
         -req.allocated_pallets,
         'load',
         p_load_id,
         'Salida ' || v_load.load_number,
         p_actor
  from (
    select la.receipt_item_id,
           sum(la.allocated_quantity) as allocated_quantity,
           sum(la.allocated_pallets) as allocated_pallets
    from public.load_allocations la
    join public.load_items li on li.id=la.load_item_id
    where li.load_id=p_load_id
    group by la.receipt_item_id
  ) req
  join public.warehouse_receipt_items wri on wri.id=req.receipt_item_id
  join public.warehouse_receipts wr on wr.id=wri.receipt_id;

  perform set_config('export_mca.load_transition','dispatch',true);
  update public.loads
  set status='dispatched', dispatched_at=now(), updated_at=now()
  where id=p_load_id
  returning * into v_load;
  return v_load;
end;
$$;

create function public.cancel_load(p_load_id uuid, p_actor uuid default null)
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
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved') then raise exception 'LOAD_CANNOT_BE_CANCELLED'; end if;

  if v_load.status='reserved' then
    perform wri.id
    from public.warehouse_receipt_items wri
    join public.load_allocations la on la.receipt_item_id=wri.id
    join public.load_items li on li.id=la.load_item_id
    where li.load_id=p_load_id
    order by wri.id
    for update of wri;

    select coalesce(sum(la.allocated_quantity),0),coalesce(sum(la.allocated_pallets),0)
      into v_alloc_qty,v_alloc_pallets
    from public.load_allocations la
    join public.load_items li on li.id=la.load_item_id
    where li.load_id=p_load_id;

    select coalesce(sum(im.reserved_quantity_delta),0),coalesce(sum(im.reserved_pallets_delta),0)
      into v_ledger_qty,v_ledger_pallets
    from public.inventory_movements im
    where im.reference_type='load' and im.reference_id=p_load_id;

    if v_ledger_qty <> v_alloc_qty or v_ledger_pallets <> v_alloc_pallets then
      raise exception 'LOAD_RESERVATION_LEDGER_MISMATCH';
    end if;

    insert into public.inventory_movements (
      warehouse_id, product_id, receipt_item_id, movement_type,
      quantity_delta, pallets_delta, reserved_quantity_delta, reserved_pallets_delta,
      reference_type, reference_id, notes, created_by
    )
    select wr.warehouse_id,wri.product_id,req.receipt_item_id,'release',0,0,
           -req.allocated_quantity,-req.allocated_pallets,
           'load',p_load_id,'Cancelación '||v_load.load_number,p_actor
    from (
      select la.receipt_item_id,sum(la.allocated_quantity) allocated_quantity,sum(la.allocated_pallets) allocated_pallets
      from public.load_allocations la
      join public.load_items li on li.id=la.load_item_id
      where li.load_id=p_load_id
      group by la.receipt_item_id
    ) req
    join public.warehouse_receipt_items wri on wri.id=req.receipt_item_id
    join public.warehouse_receipts wr on wr.id=wri.receipt_id;
  end if;

  perform set_config('export_mca.load_transition','cancel',true);
  update public.loads
  set status='cancelled', cancelled_at=now(), shipment_id=null, updated_at=now()
  where id=p_load_id
  returning * into v_load;
  return v_load;
end;
$$;

revoke all on function public.validate_load_shipment_link() from public,anon,authenticated;
revoke all on function public.assign_load_shipment(uuid,uuid) from public,anon,authenticated;
revoke all on function public.unassign_load_shipment(uuid) from public,anon,authenticated;
revoke all on function public.start_load_loading(uuid) from public,anon,authenticated;
revoke all on function public.mark_load_loaded(uuid) from public,anon,authenticated;
revoke all on function public.dispatch_load(uuid,uuid) from public,anon,authenticated;
revoke all on function public.cancel_load(uuid,uuid) from public,anon,authenticated;

grant execute on function public.assign_load_shipment(uuid,uuid) to service_role;
grant execute on function public.unassign_load_shipment(uuid) to service_role;
grant execute on function public.start_load_loading(uuid) to service_role;
grant execute on function public.mark_load_loaded(uuid) to service_role;
grant execute on function public.dispatch_load(uuid,uuid) to service_role;
grant execute on function public.cancel_load(uuid,uuid) to service_role;

comment on function public.dispatch_load(uuid,uuid) is 'Confirma salida física: consume reserva y stock del WR de forma atómica. No modifica estados marítimos de Tracking.';
comment on function public.assign_load_shipment(uuid,uuid) is 'Vincula un cargue con un contenedor elegible sin modificar el estado marítimo del shipment.';
