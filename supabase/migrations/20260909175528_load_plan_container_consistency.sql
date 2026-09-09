-- Keep draft-plan replacement atomic and container merchandise derived from
-- its load. No stock movements, historical data rewrite or trigger bypass.
create or replace function public.replace_load_plan(
  p_load_id uuid,
  p_lines jsonb,
  p_scheduled_at timestamptz default null,
  p_notes text default null
)
returns public.loads
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_load public.loads;
  v_line jsonb;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status<>'draft' then raise exception 'LOAD_NOT_DRAFT'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then
    raise exception 'LOAD_HAS_NO_ITEMS';
  end if;
  if exists(
    select 1 from public.load_items li
    join public.sales_fulfillment_allocations sfa on sfa.load_item_id=li.id
    where li.load_id=p_load_id
  ) then raise exception 'LOAD_HAS_SALES_ALLOCATIONS'; end if;

  -- Allocation guards need their parent item to remain visible. Cascading from
  -- an already deleted item falsely reports LOAD_NOT_DRAFT even for a draft.
  delete from public.load_allocations la
  using public.load_items li
  where la.load_item_id=li.id and li.load_id=p_load_id;
  delete from public.load_items where load_id=p_load_id;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(v_line)<>'object' or nullif(btrim(v_line->>'product_id'),'') is null then
      raise exception 'PRODUCT_REQUIRED';
    end if;
    perform public.insert_load_item_with_allocations(
      p_load_id,(v_line->>'product_id')::uuid,v_line->'allocations',v_line->>'notes'
    );
  end loop;
  update public.loads
  set scheduled_at=p_scheduled_at,notes=nullif(btrim(p_notes),''),updated_at=now()
  where id=p_load_id returning * into v_load;

  perform public.sync_load_shipment_merchandise(p_load_id);
  return v_load;
end;
$function$;

create or replace function public.assign_load_shipment(p_load_id uuid,p_shipment_id uuid)
returns public.loads
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_load public.loads;
  v_ship public.shipments;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded') then
    raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS';
  end if;
  select * into v_ship from public.shipments where id=p_shipment_id for update;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_ship.active is not true or v_ship.delivered_at is not null
     or v_ship.released_at is not null or v_ship.discharged_at is not null then
    raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD';
  end if;
  update public.loads set shipment_id=p_shipment_id,updated_at=now()
  where id=p_load_id returning * into v_load;

  perform public.sync_load_shipment_merchandise(p_load_id);
  return v_load;
end;
$function$;

revoke all on function public.replace_load_plan(uuid,jsonb,timestamptz,text) from public,anon,authenticated;
revoke all on function public.assign_load_shipment(uuid,uuid) from public,anon,authenticated;
grant execute on function public.replace_load_plan(uuid,jsonb,timestamptz,text) to service_role;
grant execute on function public.assign_load_shipment(uuid,uuid) to service_role;

-- The commercial FK already forbids replacing sale-linked item identities.
-- Expose that existing protection through the canonical action state as well.
CREATE OR REPLACE FUNCTION public.load_action_state(p_load_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_load public.loads;
  v_has_items boolean := false;
  v_allocations_complete boolean := false;
  v_reservation_ledger_zero boolean := false;
  v_reservation_ledger_matches boolean := false;
  v_inventory_available boolean := false;
  v_physical_sufficient boolean := false;
  v_shipment_eligible boolean := true;
  v_alloc_qty numeric := 0;
  v_alloc_pallets numeric := 0;
  v_ledger_qty numeric := 0;
  v_ledger_pallets numeric := 0;
  v_container_mutable boolean := false;
  v_edit_reason text;
  v_reserve_reason text;
  v_release_reason text;
  v_start_reason text;
  v_loaded_reason text;
  v_dispatch_reason text;
  v_cancel_reason text;
begin
  select * into v_load from public.loads where id=p_load_id;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;

  select exists(select 1 from public.load_items li where li.load_id=v_load.id)
    into v_has_items;

  select not exists(
    select 1
    from public.load_items li
    left join public.load_allocations la on la.load_item_id=li.id
    where li.load_id=v_load.id
    group by li.id,li.planned_quantity,li.planned_pallets
    having coalesce(sum(la.allocated_quantity),0)<>li.planned_quantity
        or coalesce(sum(la.allocated_pallets),0)<>li.planned_pallets
  ) into v_allocations_complete;

  select coalesce(sum(la.allocated_quantity),0),coalesce(sum(la.allocated_pallets),0)
    into v_alloc_qty,v_alloc_pallets
  from public.load_allocations la
  join public.load_items li on li.id=la.load_item_id
  where li.load_id=v_load.id;

  select coalesce(sum(im.reserved_quantity_delta),0),coalesce(sum(im.reserved_pallets_delta),0)
    into v_ledger_qty,v_ledger_pallets
  from public.inventory_movements im
  where im.reference_type='load' and im.reference_id=v_load.id;

  v_reservation_ledger_zero := v_ledger_qty=0 and v_ledger_pallets=0;
  v_reservation_ledger_matches := v_ledger_qty=v_alloc_qty and v_ledger_pallets=v_alloc_pallets;

  select not exists(
    select 1
    from (
      select la.receipt_item_id,sum(la.allocated_quantity) allocated_quantity,sum(la.allocated_pallets) allocated_pallets
      from public.load_allocations la
      join public.load_items li on li.id=la.load_item_id
      where li.load_id=v_load.id
      group by la.receipt_item_id
    ) req
    left join public.inventory_source_balances src on src.receipt_item_id=req.receipt_item_id
    where src.receipt_item_id is null
       or src.physical_quantity-src.reserved_quantity<req.allocated_quantity
       or src.physical_pallets-src.reserved_pallets<req.allocated_pallets
  ) into v_inventory_available;

  select not exists(
    select 1
    from (
      select la.receipt_item_id,sum(la.allocated_quantity) allocated_quantity,sum(la.allocated_pallets) allocated_pallets
      from public.load_allocations la
      join public.load_items li on li.id=la.load_item_id
      where li.load_id=v_load.id
      group by la.receipt_item_id
    ) req
    left join public.inventory_source_balances src on src.receipt_item_id=req.receipt_item_id
    where src.receipt_item_id is null
       or src.physical_quantity<req.allocated_quantity
       or src.physical_pallets<req.allocated_pallets
       or src.physical_quantity<src.reserved_quantity
       or src.physical_pallets<src.reserved_pallets
  ) into v_physical_sufficient;

  if v_load.shipment_id is not null then
    select exists(
      select 1 from public.shipments s
      where s.id=v_load.shipment_id
        and s.active is true
        and s.delivered_at is null
        and s.released_at is null
        and s.discharged_at is null
    ) into v_shipment_eligible;
  end if;

  v_container_mutable := v_load.status in ('draft','reserved','loading','loaded');

  v_edit_reason := case
    when v_load.status<>'draft' then 'LOAD_NOT_DRAFT'
    when exists(
      select 1 from public.load_items li
      join public.sales_fulfillment_allocations sfa on sfa.load_item_id=li.id
      where li.load_id=v_load.id
    ) then 'LOAD_HAS_SALES_ALLOCATIONS'
    else null
  end;

  v_reserve_reason := case
    when v_load.status<>'draft' then 'LOAD_NOT_DRAFT'
    when not v_has_items then 'LOAD_HAS_NO_ITEMS'
    when not v_allocations_complete then 'LOAD_ALLOCATIONS_INCOMPLETE'
    when not v_reservation_ledger_zero then 'LOAD_RESERVATION_LEDGER_NOT_ZERO'
    when not v_inventory_available then 'INSUFFICIENT_WR_AVAILABLE_BALANCE'
    else null
  end;

  v_release_reason := case
    when v_load.status<>'reserved' then 'LOAD_NOT_RESERVED'
    when not v_reservation_ledger_matches then 'LOAD_RESERVATION_LEDGER_MISMATCH'
    else null
  end;

  v_start_reason := case
    when v_load.status<>'reserved' then 'LOAD_NOT_RESERVED'
    when not v_shipment_eligible then 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'
    else null
  end;

  v_loaded_reason := case
    when v_load.status<>'loading' then 'LOAD_NOT_LOADING'
    when not v_shipment_eligible then 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'
    else null
  end;

  v_dispatch_reason := case
    when v_load.status<>'loaded' then 'LOAD_NOT_LOADED'
    when v_load.shipment_id is null then 'LOAD_HAS_NO_CONTAINER'
    when not v_shipment_eligible then 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD'
    when not v_reservation_ledger_matches then 'LOAD_RESERVATION_LEDGER_MISMATCH'
    when not v_physical_sufficient then 'INSUFFICIENT_WR_PHYSICAL_BALANCE'
    else null
  end;

  v_cancel_reason := case
    when v_load.status not in ('draft','reserved') then 'LOAD_CANNOT_BE_CANCELLED'
    when v_load.status='reserved' and not v_reservation_ledger_matches then 'LOAD_RESERVATION_LEDGER_MISMATCH'
    else null
  end;

  return jsonb_build_object(
    'status',v_load.status,
    'shipment_id',v_load.shipment_id,
    'container_pending',v_load.shipment_id is null and v_container_mutable,
    'has_items',v_has_items,
    'allocations_complete',v_allocations_complete,
    'reservation_ledger_matches',v_reservation_ledger_matches,
    'shipment_eligible',v_shipment_eligible,
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_reason is null,'reason',v_edit_reason),
      'reserve',jsonb_build_object('allowed',v_reserve_reason is null,'reason',v_reserve_reason),
      'release',jsonb_build_object('allowed',v_release_reason is null,'reason',v_release_reason),
      'start_loading',jsonb_build_object('allowed',v_start_reason is null,'reason',v_start_reason),
      'mark_loaded',jsonb_build_object('allowed',v_loaded_reason is null,'reason',v_loaded_reason),
      'dispatch',jsonb_build_object('allowed',v_dispatch_reason is null,'reason',v_dispatch_reason),
      'cancel',jsonb_build_object('allowed',v_cancel_reason is null,'reason',v_cancel_reason),
      'assign_container',jsonb_build_object(
        'allowed',v_container_mutable and v_load.shipment_id is null,
        'reason',case when not v_container_mutable then 'LOAD_SHIPMENT_LOCKED_BY_STATUS' when v_load.shipment_id is not null then 'LOAD_ALREADY_HAS_CONTAINER' else null end
      ),
      'create_container',jsonb_build_object(
        'allowed',v_container_mutable and v_load.shipment_id is null,
        'reason',case when not v_container_mutable then 'LOAD_SHIPMENT_LOCKED_BY_STATUS' when v_load.shipment_id is not null then 'LOAD_ALREADY_HAS_CONTAINER' else null end
      ),
      'unassign_container',jsonb_build_object(
        'allowed',v_container_mutable and v_load.shipment_id is not null,
        'reason',case when not v_container_mutable then 'LOAD_SHIPMENT_LOCKED_BY_STATUS' when v_load.shipment_id is null then 'LOAD_HAS_NO_CONTAINER' else null end
      ),
      'view_tracking',jsonb_build_object('allowed',v_load.shipment_id is not null,'reason',case when v_load.shipment_id is null then 'LOAD_HAS_NO_CONTAINER' else null end)
    )
  );
end;
$function$;
