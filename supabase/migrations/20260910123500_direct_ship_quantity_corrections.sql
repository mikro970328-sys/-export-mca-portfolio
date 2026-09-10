-- Direct Ship physical quantity corrections
-- Preserve planned allocations and dispatch history while allowing an audited
-- physical correction after dispatch (for example 840 ordered, 810 shipped).

create table if not exists public.direct_shipment_quantity_corrections (
  id uuid primary key default gen_random_uuid(),
  direct_shipment_allocation_id uuid not null references public.direct_shipment_allocations(id) on delete restrict,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  previous_sales_quantity numeric not null,
  corrected_sales_quantity numeric not null,
  previous_sales_pallets numeric not null default 0,
  corrected_sales_pallets numeric not null default 0,
  previous_purchase_quantity numeric not null,
  corrected_purchase_quantity numeric not null,
  previous_purchase_pallets numeric not null default 0,
  corrected_purchase_pallets numeric not null default 0,
  reason text not null,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint direct_shipment_quantity_corrections_sales_quantity_check check (corrected_sales_quantity >= 0),
  constraint direct_shipment_quantity_corrections_sales_pallets_check check (corrected_sales_pallets >= 0),
  constraint direct_shipment_quantity_corrections_purchase_quantity_check check (corrected_purchase_quantity >= 0),
  constraint direct_shipment_quantity_corrections_purchase_pallets_check check (corrected_purchase_pallets >= 0),
  constraint direct_shipment_quantity_corrections_reason_check check (btrim(reason) <> '')
);

create index if not exists direct_shipment_quantity_corrections_allocation_idx
  on public.direct_shipment_quantity_corrections(direct_shipment_allocation_id,created_at desc,id desc);
create index if not exists direct_shipment_quantity_corrections_shipment_idx
  on public.direct_shipment_quantity_corrections(shipment_id,created_at desc);

alter table public.direct_shipment_quantity_corrections enable row level security;
revoke all on public.direct_shipment_quantity_corrections from public, anon, authenticated;
grant select, insert on public.direct_shipment_quantity_corrections to service_role;

create or replace function public.correct_direct_shipment_quantity(
  p_direct_shipment_allocation_id uuid,
  p_sales_quantity numeric,
  p_sales_pallets numeric,
  p_purchase_quantity numeric,
  p_purchase_pallets numeric,
  p_reason text,
  p_actor uuid default null
)
returns public.direct_shipment_quantity_corrections
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_allocation public.direct_shipment_allocations;
  v_previous record;
  v_result public.direct_shipment_quantity_corrections;
  v_reason text := nullif(btrim(coalesce(p_reason,'')),'');
  v_client_id uuid;
begin
  if p_direct_shipment_allocation_id is null then raise exception 'DIRECT_CORRECTION_ALLOCATION_REQUIRED'; end if;
  if p_sales_quantity is null or p_sales_quantity < 0 then raise exception 'DIRECT_CORRECTION_SALES_QUANTITY_INVALID'; end if;
  if p_sales_pallets is null or p_sales_pallets < 0 then raise exception 'DIRECT_CORRECTION_SALES_PALLETS_INVALID'; end if;
  if p_purchase_quantity is null or p_purchase_quantity < 0 then raise exception 'DIRECT_CORRECTION_PURCHASE_QUANTITY_INVALID'; end if;
  if p_purchase_pallets is null or p_purchase_pallets < 0 then raise exception 'DIRECT_CORRECTION_PURCHASE_PALLETS_INVALID'; end if;
  if v_reason is null then raise exception 'DIRECT_CORRECTION_REASON_REQUIRED'; end if;

  select * into v_allocation
  from public.direct_shipment_allocations
  where id=p_direct_shipment_allocation_id
  for update;
  if not found then raise exception 'DIRECT_CORRECTION_ALLOCATION_NOT_FOUND'; end if;

  if not exists (
    select 1 from public.direct_shipment_dispatches
    where shipment_id=v_allocation.shipment_id
  ) then raise exception 'DIRECT_CORRECTION_REQUIRES_DISPATCH'; end if;

  if p_sales_quantity > v_allocation.allocated_sales_quantity
     or p_sales_pallets > v_allocation.allocated_sales_pallets
     or p_purchase_quantity > v_allocation.allocated_purchase_quantity
     or p_purchase_pallets > v_allocation.allocated_purchase_pallets then
    raise exception 'DIRECT_CORRECTION_EXCEEDS_PLANNED';
  end if;

  select
    coalesce(c.corrected_sales_quantity,v_allocation.allocated_sales_quantity) as sales_quantity,
    coalesce(c.corrected_sales_pallets,v_allocation.allocated_sales_pallets) as sales_pallets,
    coalesce(c.corrected_purchase_quantity,v_allocation.allocated_purchase_quantity) as purchase_quantity,
    coalesce(c.corrected_purchase_pallets,v_allocation.allocated_purchase_pallets) as purchase_pallets
  into v_previous
  from (select 1) seed
  left join lateral (
    select * from public.direct_shipment_quantity_corrections
    where direct_shipment_allocation_id=v_allocation.id
    order by created_at desc,id desc
    limit 1
  ) c on true;

  if p_sales_quantity = v_previous.sales_quantity
     and p_sales_pallets = v_previous.sales_pallets
     and p_purchase_quantity = v_previous.purchase_quantity
     and p_purchase_pallets = v_previous.purchase_pallets then
    raise exception 'DIRECT_CORRECTION_NO_CHANGES';
  end if;

  insert into public.direct_shipment_quantity_corrections(
    direct_shipment_allocation_id,shipment_id,
    previous_sales_quantity,corrected_sales_quantity,
    previous_sales_pallets,corrected_sales_pallets,
    previous_purchase_quantity,corrected_purchase_quantity,
    previous_purchase_pallets,corrected_purchase_pallets,
    reason,created_by
  ) values (
    v_allocation.id,v_allocation.shipment_id,
    v_previous.sales_quantity,p_sales_quantity,
    v_previous.sales_pallets,p_sales_pallets,
    v_previous.purchase_quantity,p_purchase_quantity,
    v_previous.purchase_pallets,p_purchase_pallets,
    v_reason,p_actor
  ) returning * into v_result;

  select client_id into v_client_id from public.shipments where id=v_allocation.shipment_id;
  insert into public.shipment_history(shipment_id,client_id,event_type,title,details,source)
  values(
    v_allocation.shipment_id,
    v_client_id,
    'direct_shipment_quantity_corrected',
    'Cantidad física Direct Ship corregida',
    format('Venta %s→%s; compra %s→%s. Motivo: %s',v_previous.sales_quantity,p_sales_quantity,v_previous.purchase_quantity,p_purchase_quantity,v_reason),
    'sales_supply'
  );

  return v_result;
end;
$function$;

revoke all on function public.correct_direct_shipment_quantity(uuid,numeric,numeric,numeric,numeric,text,uuid) from public, anon, authenticated;
grant execute on function public.correct_direct_shipment_quantity(uuid,numeric,numeric,numeric,numeric,text,uuid) to service_role;

create or replace view public.direct_shipment_effective_allocations
with (security_invoker=true)
as
select
  dsa.id,
  dsa.sales_procurement_allocation_id,
  dsa.shipment_id,
  coalesce(c.corrected_sales_quantity,dsa.allocated_sales_quantity) as allocated_sales_quantity,
  coalesce(c.corrected_sales_pallets,dsa.allocated_sales_pallets) as allocated_sales_pallets,
  coalesce(c.corrected_purchase_quantity,dsa.allocated_purchase_quantity) as allocated_purchase_quantity,
  coalesce(c.corrected_purchase_pallets,dsa.allocated_purchase_pallets) as allocated_purchase_pallets,
  dsa.notes,
  dsa.created_by,
  dsa.created_at,
  dsa.updated_at,
  dsa.allocated_sales_quantity as planned_sales_quantity,
  dsa.allocated_sales_pallets as planned_sales_pallets,
  dsa.allocated_purchase_quantity as planned_purchase_quantity,
  dsa.allocated_purchase_pallets as planned_purchase_pallets,
  (c.id is not null) as has_quantity_correction,
  c.id as latest_correction_id,
  c.reason as latest_correction_reason,
  c.created_at as latest_correction_at,
  c.created_by as latest_correction_by
from public.direct_shipment_allocations dsa
left join lateral (
  select *
  from public.direct_shipment_quantity_corrections q
  where q.direct_shipment_allocation_id=dsa.id
  order by q.created_at desc,q.id desc
  limit 1
) c on true;

revoke all on public.direct_shipment_effective_allocations from anon, authenticated;
grant select on public.direct_shipment_effective_allocations to service_role;

-- Capacity guards must use the physical/effective quantity for already-dispatched
-- corrected allocations. The immutable raw allocation remains the audit plan.
create or replace function public.validate_direct_shipment_allocation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_ctx record;
  v_sales_q numeric;
  v_sales_p numeric;
  v_purchase_q numeric;
  v_purchase_p numeric;
  v_existing_client uuid;
  v_existing_importer uuid;
begin
  select spa.allocated_sales_quantity as proc_sales_q,
         spa.allocated_sales_pallets as proc_sales_p,
         spa.allocated_purchase_quantity as proc_purchase_q,
         spa.allocated_purchase_pallets as proc_purchase_p,
         spl.supply_method,
         po.status as po_status,
         so.status as sales_status,
         so.client_id,
         so.importer_id,
         s.client_id as shipment_client_id,
         s.importer_id as shipment_importer_id
    into v_ctx
  from public.sales_procurement_allocations spa
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
  join public.purchase_orders po on po.id=poi.purchase_order_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  join public.shipments s on s.id=new.shipment_id
  where spa.id=new.sales_procurement_allocation_id;

  if not found then raise exception 'DIRECT_SHIPMENT_CONTEXT_NOT_FOUND'; end if;
  if v_ctx.supply_method<>'purchase_direct' then raise exception 'DIRECT_SHIPMENT_REQUIRES_DIRECT_PURCHASE'; end if;
  if v_ctx.sales_status<>'confirmed' then raise exception 'DIRECT_SHIPMENT_SALE_NOT_CONFIRMED'; end if;
  if v_ctx.po_status<>'confirmed' then raise exception 'DIRECT_SHIPMENT_PO_NOT_CONFIRMED'; end if;
  if exists(select 1 from public.loads where shipment_id=new.shipment_id and status<>'cancelled') then raise exception 'DIRECT_SHIPMENT_HAS_LOAD'; end if;
  if v_ctx.shipment_client_id is not null and v_ctx.shipment_client_id<>v_ctx.client_id then raise exception 'DIRECT_SHIPMENT_CLIENT_MISMATCH'; end if;
  if v_ctx.shipment_importer_id is not null and v_ctx.shipment_importer_id is distinct from v_ctx.importer_id then raise exception 'DIRECT_SHIPMENT_IMPORTER_MISMATCH'; end if;

  select so.client_id,so.importer_id
    into v_existing_client,v_existing_importer
  from public.direct_shipment_allocations dsa
  join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where dsa.shipment_id=new.shipment_id and dsa.id is distinct from new.id
  limit 1;

  if found and (v_existing_client<>v_ctx.client_id or v_existing_importer is distinct from v_ctx.importer_id) then
    raise exception 'DIRECT_SHIPMENT_MIXED_COMMERCIAL_CONTEXT';
  end if;

  select coalesce(sum(allocated_sales_quantity),0),
         coalesce(sum(allocated_sales_pallets),0),
         coalesce(sum(allocated_purchase_quantity),0),
         coalesce(sum(allocated_purchase_pallets),0)
    into v_sales_q,v_sales_p,v_purchase_q,v_purchase_p
  from public.direct_shipment_effective_allocations
  where sales_procurement_allocation_id=new.sales_procurement_allocation_id
    and id is distinct from new.id;

  if v_sales_q+new.allocated_sales_quantity>v_ctx.proc_sales_q then raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_SALES'; end if;
  if v_ctx.proc_sales_p>0 and v_sales_p+new.allocated_sales_pallets>v_ctx.proc_sales_p then raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_SALES_PALLETS'; end if;
  if v_purchase_q+new.allocated_purchase_quantity>v_ctx.proc_purchase_q then raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_PURCHASE'; end if;
  if v_ctx.proc_purchase_p>0 and v_purchase_p+new.allocated_purchase_pallets>v_ctx.proc_purchase_p then raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_PURCHASE_PALLETS'; end if;

  return new;
end;
$function$;

create or replace function public.validate_sales_procurement_allocation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_plan record;
  v_po record;
  v_plan_q numeric;
  v_plan_p numeric;
  v_po_q numeric;
  v_po_p numeric;
  v_direct_sales_q numeric;
  v_direct_sales_p numeric;
  v_direct_purchase_q numeric;
  v_direct_purchase_p numeric;
begin
  if tg_op='UPDATE'
     and (new.supply_plan_line_id is distinct from old.supply_plan_line_id
          or new.purchase_order_item_id is distinct from old.purchase_order_item_id)
     and exists(select 1 from public.direct_shipment_allocations where sales_procurement_allocation_id=old.id) then
    raise exception 'SUPPLY_PROCUREMENT_CONTEXT_LOCKED_BY_DIRECT_SHIPMENT';
  end if;

  select spl.supply_method,spl.warehouse_id,spl.planned_quantity,spl.planned_pallets,soi.product_id,so.status as sales_status
    into v_plan
  from public.sales_supply_plan_lines spl
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where spl.id=new.supply_plan_line_id;
  if not found then raise exception 'SUPPLY_PLAN_NOT_FOUND'; end if;
  if v_plan.supply_method not in ('purchase_warehouse','purchase_direct') then raise exception 'SUPPLY_PLAN_NOT_PURCHASE'; end if;
  if v_plan.sales_status<>'confirmed' then raise exception 'SUPPLY_SO_NOT_CONFIRMED'; end if;

  select poi.product_id,poi.ordered_quantity,poi.ordered_pallets,po.warehouse_id,po.status as po_status
    into v_po
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where poi.id=new.purchase_order_item_id;
  if not found then raise exception 'SUPPLY_PO_ITEM_NOT_FOUND'; end if;
  if v_po.po_status='cancelled' then raise exception 'SUPPLY_PO_CANCELLED'; end if;
  if v_po.product_id<>v_plan.product_id then raise exception 'SUPPLY_PRODUCT_MISMATCH'; end if;

  if v_plan.supply_method='purchase_warehouse' then
    if v_po.warehouse_id is not null and v_po.warehouse_id<>v_plan.warehouse_id then raise exception 'SUPPLY_PO_WAREHOUSE_MISMATCH'; end if;
  elsif v_po.warehouse_id is not null then
    raise exception 'SUPPLY_DIRECT_PO_HAS_WAREHOUSE';
  end if;

  select coalesce(sum(spa.allocated_sales_quantity),0),coalesce(sum(spa.allocated_sales_pallets),0)
    into v_plan_q,v_plan_p
  from public.sales_procurement_allocations spa
  join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where spa.supply_plan_line_id=new.supply_plan_line_id
    and spa.id is distinct from new.id
    and po.status<>'cancelled';
  if v_plan_q+new.allocated_sales_quantity>v_plan.planned_quantity then raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PLAN'; end if;
  if v_plan.planned_pallets>0 and v_plan_p+new.allocated_sales_pallets>v_plan.planned_pallets then raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PLAN_PALLETS'; end if;

  select coalesce(sum(spa.allocated_purchase_quantity),0),coalesce(sum(spa.allocated_purchase_pallets),0)
    into v_po_q,v_po_p
  from public.sales_procurement_allocations spa
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where spa.purchase_order_item_id=new.purchase_order_item_id
    and spa.id is distinct from new.id
    and so.status<>'cancelled';
  if v_po_q+new.allocated_purchase_quantity>v_po.ordered_quantity then raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PO'; end if;
  if coalesce(v_po.ordered_pallets,0)>0 and v_po_p+new.allocated_purchase_pallets>v_po.ordered_pallets then raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PO_PALLETS'; end if;

  if tg_op='UPDATE' then
    select coalesce(sum(allocated_sales_quantity),0),coalesce(sum(allocated_sales_pallets),0),
           coalesce(sum(allocated_purchase_quantity),0),coalesce(sum(allocated_purchase_pallets),0)
      into v_direct_sales_q,v_direct_sales_p,v_direct_purchase_q,v_direct_purchase_p
    from public.direct_shipment_effective_allocations
    where sales_procurement_allocation_id=old.id;
    if v_direct_sales_q>new.allocated_sales_quantity then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_SALES_QUANTITY'; end if;
    if new.allocated_sales_pallets>0 and v_direct_sales_p>new.allocated_sales_pallets then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_SALES_PALLETS'; end if;
    if v_direct_purchase_q>new.allocated_purchase_quantity then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_PURCHASE_QUANTITY'; end if;
    if new.allocated_purchase_pallets>0 and v_direct_purchase_p>new.allocated_purchase_pallets then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_PURCHASE_PALLETS'; end if;
  end if;

  return new;
end;
$function$;

create or replace view public.sales_order_item_progress
with (security_invoker=true)
as
with load_totals as (
  select
    sfa.sales_order_item_id,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status='draft'),0::numeric) as planned_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status='draft'),0::numeric) as planned_pallets,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status in ('reserved','loading','loaded')),0::numeric) as prepared_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status in ('reserved','loading','loaded')),0::numeric) as prepared_pallets,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status='dispatched'),0::numeric) as dispatched_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status='dispatched'),0::numeric) as dispatched_pallets
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id=sfa.load_item_id
  join public.loads l on l.id=li.load_id
  group by sfa.sales_order_item_id
),
direct_plan_totals as (
  select sales_order_item_id,
    coalesce(sum(planned_quantity),0::numeric) as planned_quantity,
    coalesce(sum(planned_pallets),0::numeric) as planned_pallets
  from public.sales_supply_plan_lines
  where supply_method='purchase_direct'
  group by sales_order_item_id
),
direct_dispatch_totals as (
  select spl.sales_order_item_id,
    coalesce(sum(dsa.allocated_sales_quantity),0::numeric) as dispatched_quantity,
    coalesce(sum(dsa.allocated_sales_pallets),0::numeric) as dispatched_pallets
  from public.direct_shipment_effective_allocations dsa
  join public.direct_shipment_dispatches dsd on dsd.shipment_id=dsa.shipment_id
  join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  group by spl.sales_order_item_id
)
select
  soi.id as sales_order_item_id,
  soi.sales_order_id,
  soi.product_id,
  soi.ordered_quantity,
  soi.ordered_pallets,
  soi.unit,
  soi.units_per_pallet,
  soi.unit_price,
  coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price) as line_total,
  coalesce(l.planned_quantity,0::numeric) as planned_quantity,
  coalesce(l.planned_pallets,0::numeric) as planned_pallets,
  coalesce(l.prepared_quantity,0::numeric) as prepared_quantity,
  coalesce(l.prepared_pallets,0::numeric) as prepared_pallets,
  coalesce(l.dispatched_quantity,0::numeric)+coalesce(d.dispatched_quantity,0::numeric) as dispatched_quantity,
  coalesce(l.dispatched_pallets,0::numeric)+coalesce(d.dispatched_pallets,0::numeric) as dispatched_pallets,
  greatest(soi.ordered_quantity-coalesce(l.planned_quantity,0::numeric)-coalesce(l.prepared_quantity,0::numeric)-coalesce(l.dispatched_quantity,0::numeric)-coalesce(dp.planned_quantity,0::numeric),0::numeric) as unallocated_quantity,
  greatest(soi.ordered_pallets-coalesce(l.planned_pallets,0::numeric)-coalesce(l.prepared_pallets,0::numeric)-coalesce(l.dispatched_pallets,0::numeric)-coalesce(dp.planned_pallets,0::numeric),0::numeric) as unallocated_pallets,
  greatest(soi.ordered_quantity-(coalesce(l.dispatched_quantity,0::numeric)+coalesce(d.dispatched_quantity,0::numeric)),0::numeric) as remaining_to_dispatch_quantity,
  greatest(soi.ordered_pallets-(coalesce(l.dispatched_pallets,0::numeric)+coalesce(d.dispatched_pallets,0::numeric)),0::numeric) as remaining_to_dispatch_pallets,
  (coalesce(l.dispatched_quantity,0::numeric)+coalesce(d.dispatched_quantity,0::numeric))>=soi.ordered_quantity
    and (soi.ordered_pallets=0::numeric or (coalesce(l.dispatched_pallets,0::numeric)+coalesce(d.dispatched_pallets,0::numeric))>=soi.ordered_pallets) as is_fully_dispatched,
  (coalesce(l.dispatched_quantity,0::numeric)+coalesce(d.dispatched_quantity,0::numeric))>0::numeric
    and not ((coalesce(l.dispatched_quantity,0::numeric)+coalesce(d.dispatched_quantity,0::numeric))>=soi.ordered_quantity
      and (soi.ordered_pallets=0::numeric or (coalesce(l.dispatched_pallets,0::numeric)+coalesce(d.dispatched_pallets,0::numeric))>=soi.ordered_pallets)) as has_partial_dispatch,
  case
    when (coalesce(l.dispatched_quantity,0::numeric)+coalesce(d.dispatched_quantity,0::numeric))>=soi.ordered_quantity
      and (soi.ordered_pallets=0::numeric or (coalesce(l.dispatched_pallets,0::numeric)+coalesce(d.dispatched_pallets,0::numeric))>=soi.ordered_pallets) then 'dispatched'::text
    when coalesce(l.prepared_quantity,0::numeric)>0::numeric or coalesce(l.prepared_pallets,0::numeric)>0::numeric then 'prepared'::text
    when coalesce(l.planned_quantity,0::numeric)>0::numeric or coalesce(l.planned_pallets,0::numeric)>0::numeric then 'planned'::text
    when coalesce(l.dispatched_quantity,0::numeric)+coalesce(d.dispatched_quantity,0::numeric)>0::numeric
      or coalesce(l.dispatched_pallets,0::numeric)+coalesce(d.dispatched_pallets,0::numeric)>0::numeric then 'dispatched'::text
    else 'pending'::text
  end as fulfillment_stage
from public.sales_order_items soi
left join load_totals l on l.sales_order_item_id=soi.id
left join direct_plan_totals dp on dp.sales_order_item_id=soi.id
left join direct_dispatch_totals d on d.sales_order_item_id=soi.id;

revoke all on public.sales_order_item_progress from anon, authenticated;
grant select on public.sales_order_item_progress to service_role;

create or replace view public.shipment_direct_supply_contents
with (security_invoker=true)
as
select
  dsa.id as direct_shipment_allocation_id,
  dsa.shipment_id,
  s.container_number,
  spl.id as supply_plan_line_id,
  spl.sales_order_item_id,
  soi.sales_order_id,
  so.so_number,
  spa.purchase_order_item_id,
  poi.purchase_order_id,
  po.po_number,
  soi.product_id,
  p.sku,
  p.name as product_name,
  soi.unit as sales_unit,
  poi.unit as purchase_unit,
  dsa.allocated_sales_quantity,
  dsa.allocated_sales_pallets,
  dsa.allocated_purchase_quantity,
  dsa.allocated_purchase_pallets,
  so.client_id,
  so.importer_id,
  dsd.dispatched_at as direct_dispatched_at,
  dsd.dispatched_by as direct_dispatched_by,
  dsd.notes as direct_dispatch_notes,
  dsa.planned_sales_quantity,
  dsa.planned_sales_pallets,
  dsa.planned_purchase_quantity,
  dsa.planned_purchase_pallets,
  dsa.has_quantity_correction,
  dsa.latest_correction_reason,
  dsa.latest_correction_at
from public.direct_shipment_effective_allocations dsa
join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
join public.sales_order_items soi on soi.id=spl.sales_order_item_id
join public.sales_orders so on so.id=soi.sales_order_id
join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
join public.purchase_orders po on po.id=poi.purchase_order_id
join public.products p on p.id=soi.product_id
join public.shipments s on s.id=dsa.shipment_id
left join public.direct_shipment_dispatches dsd on dsd.shipment_id=dsa.shipment_id;

revoke all on public.shipment_direct_supply_contents from anon, authenticated;
grant select on public.shipment_direct_supply_contents to service_role;
