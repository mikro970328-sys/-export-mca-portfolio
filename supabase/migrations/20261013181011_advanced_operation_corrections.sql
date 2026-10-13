-- Keep the commercial history immutable while allowing factual sale metadata
-- to be corrected after confirmation, dispatch, billing, payment or closure.

create or replace function public.guard_sales_order_structure()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_detail_revision boolean := coalesce(current_setting('export_mca.so_details_revision',true),'')='on';
begin
  if old.status <> 'draft' and (
    new.client_id is distinct from old.client_id
    or new.importer_id is distinct from old.importer_id
    or new.currency is distinct from old.currency
  ) then
    raise exception 'SO_STRUCTURE_LOCKED';
  end if;

  if old.status <> 'draft' and v_detail_revision is not true and (
    new.order_date is distinct from old.order_date
    or new.requested_at is distinct from old.requested_at
    or new.customer_reference is distinct from old.customer_reference
    or new.nationalization_status is distinct from old.nationalization_status
  ) then
    raise exception 'SO_STRUCTURE_LOCKED';
  end if;

  if new.currency is distinct from old.currency and exists (
    select 1 from public.sales_order_items where sales_order_id=old.id
  ) then
    raise exception 'SO_CURRENCY_HAS_ITEMS';
  end if;

  if (new.client_id is distinct from old.client_id or new.importer_id is distinct from old.importer_id) and exists (
    select 1
    from public.sales_order_items soi
    join public.sales_fulfillment_allocations sfa on sfa.sales_order_item_id=soi.id
    where soi.sales_order_id=old.id
  ) then
    raise exception 'SO_HAS_LOAD_ALLOCATIONS';
  end if;
  return new;
end;
$function$;

create or replace function public.revise_sales_order_details(
  p_sales_order_id uuid,
  p_order_date date default null,
  p_requested_at timestamptz default null,
  p_customer_reference text default null,
  p_notes text default null,
  p_nationalization_status text default null
)
returns public.sales_orders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_so public.sales_orders;
  v_status text:=nullif(btrim(coalesce(p_nationalization_status,'')),'');
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  if v_status is not null and v_status not in ('nationalized','not_nationalized') then
    raise exception 'SO_NATIONALIZATION_STATUS_INVALID';
  end if;

  perform set_config('export_mca.so_details_revision','on',true);
  update public.sales_orders
  set order_date=coalesce(p_order_date,order_date),
      requested_at=p_requested_at,
      customer_reference=nullif(btrim(p_customer_reference),''),
      notes=nullif(btrim(p_notes),''),
      nationalization_status=v_status
  where id=p_sales_order_id;

  select * into v_so from public.sales_orders where id=p_sales_order_id;
  return v_so;
end;
$$;

revoke all on function public.revise_sales_order_details(uuid,date,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.revise_sales_order_details(uuid,date,timestamptz,text,text,text) to service_role;

create or replace view public.sales_order_action_capabilities
with (security_invoker=true)
as
select so.id as sales_order_id,
       jsonb_set(
         state.capabilities,
         '{actions}',
         coalesce(state.capabilities->'actions','{}'::jsonb)
           || jsonb_build_object('correct_details',jsonb_build_object('allowed',true,'reason',null)),
         true
       ) as capabilities
from public.sales_orders so
cross join lateral (select public.sales_order_action_state(so.id) as capabilities) state;

revoke all on public.sales_order_action_capabilities from public,anon,authenticated;
grant select on public.sales_order_action_capabilities to service_role;

comment on function public.revise_sales_order_details(uuid,date,timestamptz,text,text,text) is
  'Corrects non-structural sale details in place without rewriting fulfillment, invoices, payments or history.';
