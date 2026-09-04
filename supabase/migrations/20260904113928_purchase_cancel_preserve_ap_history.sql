-- Cancelling a commercial purchase must not erase or rewrite its accounting history.
-- Active bills/payments remain visible in AP and are handled by their own void/reversal actions.

create or replace function public.guard_purchase_order_ap_cancellation()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if new.status='cancelled' and old.status is distinct from 'cancelled' and exists (
    select 1
    from public.purchase_order_items poi
    join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id
    where poi.purchase_order_id=old.id
  ) then
    raise exception 'PO_HAS_ACTIVE_SALES_PROCUREMENT';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_purchase_order_ap_cancellation() from public,anon,authenticated;
grant execute on function public.guard_purchase_order_ap_cancellation() to service_role;

comment on function public.guard_purchase_order_ap_cancellation() is
  'Preserves cancellation integrity for sales procurement while allowing AP history to remain attached to a cancelled Purchase Order.';
