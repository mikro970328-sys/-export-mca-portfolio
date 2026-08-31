-- UX-5 · Cargues: one canonical DB owner for operational actions.
-- Existing lifecycle RPCs remain transaction primitives; canonical wrappers assert this contract first.

create or replace function public.load_action_state(p_load_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
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
      'edit',jsonb_build_object('allowed',v_load.status='draft','reason',case when v_load.status='draft' then null else 'LOAD_NOT_DRAFT' end),
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
$$;

revoke all on function public.load_action_state(uuid) from public,anon,authenticated;
grant execute on function public.load_action_state(uuid) to service_role;

create or replace function public.assert_load_action(p_load_id uuid,p_action text)
returns void
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_state jsonb;
  v_allowed boolean;
  v_reason text;
begin
  if v_action not in ('edit','reserve','release','start_loading','mark_loaded','dispatch','cancel','assign_container','create_container','unassign_container','view_tracking') then
    raise exception 'LOAD_ACTION_INVALID';
  end if;
  v_state:=public.load_action_state(p_load_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'LOAD_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

revoke all on function public.assert_load_action(uuid,text) from public,anon,authenticated;
grant execute on function public.assert_load_action(uuid,text) to service_role;

create or replace view public.load_action_capabilities
with (security_invoker=true)
as
select l.id as load_id,public.load_action_state(l.id) as capabilities
from public.loads l;

revoke all on public.load_action_capabilities from public,anon,authenticated;
grant select on public.load_action_capabilities to service_role;

create or replace function public.execute_load_action(p_load_id uuid,p_action text,p_actor uuid default null)
returns public.loads
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_load public.loads;
  v_action text:=lower(btrim(coalesce(p_action,'')));
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  perform public.assert_load_action(v_load.id,v_action);

  if v_action='reserve' then select * into v_load from public.reserve_load(v_load.id,p_actor);
  elsif v_action='release' then select * into v_load from public.release_load(v_load.id,p_actor);
  elsif v_action='start_loading' then select * into v_load from public.start_load_loading(v_load.id);
  elsif v_action='mark_loaded' then select * into v_load from public.mark_load_loaded(v_load.id);
  elsif v_action='dispatch' then select * into v_load from public.dispatch_load(v_load.id,p_actor);
  elsif v_action='cancel' then select * into v_load from public.cancel_load(v_load.id,p_actor);
  elsif v_action='unassign_container' then select * into v_load from public.unassign_load_shipment(v_load.id);
  else raise exception 'LOAD_ACTION_INVALID';
  end if;
  return v_load;
end;
$$;

revoke all on function public.execute_load_action(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.execute_load_action(uuid,text,uuid) to service_role;

create or replace function public.replace_load_plan_canonical(
  p_load_id uuid,p_lines jsonb,p_scheduled_at timestamptz default null,p_notes text default null
)
returns public.loads
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_load public.loads;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  perform public.assert_load_action(v_load.id,'edit');
  select * into v_load from public.replace_load_plan(v_load.id,p_lines,p_scheduled_at,p_notes);
  return v_load;
end;
$$;

revoke all on function public.replace_load_plan_canonical(uuid,jsonb,timestamptz,text) from public,anon,authenticated;
grant execute on function public.replace_load_plan_canonical(uuid,jsonb,timestamptz,text) to service_role;

create or replace function public.assign_load_shipment_canonical(p_load_id uuid,p_shipment_id uuid)
returns public.loads
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_load public.loads;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  perform public.assert_load_action(v_load.id,'assign_container');
  select * into v_load from public.assign_load_shipment(v_load.id,p_shipment_id);
  return v_load;
end;
$$;

revoke all on function public.assign_load_shipment_canonical(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assign_load_shipment_canonical(uuid,uuid) to service_role;

create or replace function public.create_load_shipment_canonical(
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
set search_path to 'public','pg_temp'
as $$
declare
  v_load public.loads;
  v_shipment public.shipments;
begin
  select * into v_load from public.loads where id=p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  perform public.assert_load_action(v_load.id,'create_container');
  select * into v_shipment from public.create_load_shipment(
    v_load.id,p_container_number,p_client_id,p_importer_id,p_booking_number,p_bol_number,p_carrier,p_departure_date
  );
  return v_shipment;
end;
$$;

revoke all on function public.create_load_shipment_canonical(uuid,text,uuid,uuid,text,text,text,date) from public,anon,authenticated;
grant execute on function public.create_load_shipment_canonical(uuid,text,uuid,uuid,text,text,text,date) to service_role;

comment on function public.load_action_state(uuid) is 'UX-5 canonical business action owner for Cargues.';
comment on function public.assert_load_action(uuid,text) is 'Rejects Cargue actions that canonical state does not allow.';
comment on function public.execute_load_action(uuid,text,uuid) is 'Canonical lifecycle entrypoint for Cargue mutations.';
