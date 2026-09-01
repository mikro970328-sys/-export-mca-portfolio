-- UX-5 · Warehouse Receipts: canonical DB-owned action capabilities.

create or replace function public.warehouse_receipt_action_state(p_receipt_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_receipt public.warehouse_receipts;
  v_has_inventory_history boolean := false;
  v_assigned_active_load boolean := false;
  v_linked_purchase_orders integer := 0;
  v_cancel_reason text;
begin
  select * into v_receipt
  from public.warehouse_receipts
  where id=p_receipt_id;
  if not found then raise exception 'WR_NOT_FOUND'; end if;

  select exists(
    select 1
    from public.warehouse_receipt_items wri
    join public.inventory_movements im on im.receipt_item_id=wri.id
    where wri.receipt_id=v_receipt.id
  ) into v_has_inventory_history;

  select exists(
    select 1
    from public.warehouse_receipt_items wri
    join public.load_allocations la on la.receipt_item_id=wri.id
    join public.load_items li on li.id=la.load_item_id
    join public.loads l on l.id=li.load_id
    where wri.receipt_id=v_receipt.id
      and l.status<>'cancelled'
  ) into v_assigned_active_load;

  select count(distinct poi.purchase_order_id)::integer
  into v_linked_purchase_orders
  from public.warehouse_receipt_items wri
  join public.purchase_receipt_allocations pra on pra.receipt_item_id=wri.id
  join public.purchase_order_items poi on poi.id=pra.purchase_order_item_id
  where wri.receipt_id=v_receipt.id;

  v_cancel_reason := case
    when v_receipt.status<>'received' then 'WR_NOT_RECEIVED'
    when v_has_inventory_history then 'WR_HAS_INVENTORY_HISTORY'
    when v_assigned_active_load then 'WR_ASSIGNED_TO_LOAD'
    else null
  end;

  return jsonb_build_object(
    'receipt_status',v_receipt.status,
    'has_inventory_history',v_has_inventory_history,
    'assigned_active_load',v_assigned_active_load,
    'linked_purchase_order_count',v_linked_purchase_orders,
    'actions',jsonb_build_object(
      'cancel',jsonb_build_object(
        'allowed',v_cancel_reason is null,
        'reason',v_cancel_reason
      )
    )
  );
end;
$$;

create or replace function public.assert_warehouse_receipt_action(p_receipt_id uuid,p_action text)
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
  if v_action<>'cancel' then
    raise exception 'WR_ACTION_INVALID';
  end if;
  v_state:=public.warehouse_receipt_action_state(p_receipt_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'WR_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace view public.warehouse_receipt_action_capabilities
with (security_invoker=true)
as
select id as receipt_id, public.warehouse_receipt_action_state(id) as capabilities
from public.warehouse_receipts;

-- Keep the existing table trigger as defense-in-depth, but delegate the rule to
-- the same canonical action owner used by API/UI capabilities.
create or replace function public.guard_wr_cancellation_after_allocation()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if old.status='received' and new.status='cancelled' then
    perform public.assert_warehouse_receipt_action(old.id,'cancel');
  end if;
  return new;
end;
$$;

create or replace function public.cancel_warehouse_receipt_canonical(
  p_receipt_id uuid,
  p_actor uuid default null
)
returns public.warehouse_receipts
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_receipt public.warehouse_receipts;
begin
  perform public.assert_warehouse_receipt_action(p_receipt_id,'cancel');
  update public.warehouse_receipts
  set status='cancelled'
  where id=p_receipt_id
  returning * into v_receipt;
  if not found then raise exception 'WR_NOT_FOUND'; end if;
  return v_receipt;
end;
$$;

revoke all on function public.warehouse_receipt_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_warehouse_receipt_action(uuid,text) from public,anon,authenticated;
revoke all on function public.cancel_warehouse_receipt_canonical(uuid,uuid) from public,anon,authenticated;
grant execute on function public.warehouse_receipt_action_state(uuid) to service_role;
grant execute on function public.assert_warehouse_receipt_action(uuid,text) to service_role;
grant execute on function public.cancel_warehouse_receipt_canonical(uuid,uuid) to service_role;

revoke all on public.warehouse_receipt_action_capabilities from public,anon,authenticated,service_role;
grant select on public.warehouse_receipt_action_capabilities to service_role;
