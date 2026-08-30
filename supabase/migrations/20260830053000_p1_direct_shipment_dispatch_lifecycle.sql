create table if not exists public.direct_shipment_dispatches (
  shipment_id uuid primary key references public.shipments(id) on delete restrict,
  dispatched_at timestamptz not null default now(),
  dispatched_by uuid references public.admin_users(id) on delete set null,
  notes text,
  created_at timestamptz not null default now()
);

comment on table public.direct_shipment_dispatches is 'Physical dispatch milestone for shipments fulfilled directly from supplier to destination without Export MCA WR or load.';
comment on column public.direct_shipment_dispatches.dispatched_at is 'Actual commercial fulfillment dispatch timestamp. This is not an ETD or planned departure date.';

create index if not exists direct_shipment_dispatches_dispatched_by_idx
  on public.direct_shipment_dispatches(dispatched_by)
  where dispatched_by is not null;

alter table public.direct_shipment_dispatches enable row level security;
revoke all on public.direct_shipment_dispatches from public, anon, authenticated;
grant select, insert on public.direct_shipment_dispatches to service_role;

create or replace function public.guard_direct_shipment_allocation_after_dispatch()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if tg_op in ('UPDATE','DELETE') and exists (
    select 1 from public.direct_shipment_dispatches where shipment_id = old.shipment_id
  ) then
    raise exception 'DIRECT_SHIPMENT_ALREADY_DISPATCHED';
  end if;
  if tg_op in ('INSERT','UPDATE') and exists (
    select 1 from public.direct_shipment_dispatches where shipment_id = new.shipment_id
  ) then
    raise exception 'DIRECT_SHIPMENT_ALREADY_DISPATCHED';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$function$;

drop trigger if exists direct_shipment_allocations_guard_dispatched on public.direct_shipment_allocations;
create trigger direct_shipment_allocations_guard_dispatched
before insert or update or delete on public.direct_shipment_allocations
for each row execute function public.guard_direct_shipment_allocation_after_dispatch();

create or replace function public.validate_sales_supply_plan_line()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_item record;
  v_other_quantity numeric;
  v_other_pallets numeric;
  v_linked_quantity numeric;
  v_linked_pallets numeric;
  v_warehouse_active boolean;
  v_has_procurement boolean;
  v_other_direct_quantity numeric;
  v_other_direct_pallets numeric;
  v_active_load_quantity numeric;
  v_active_load_pallets numeric;
  v_direct_quantity numeric;
  v_direct_pallets numeric;
begin
  select soi.ordered_quantity,soi.ordered_pallets,so.status
    into v_item
  from public.sales_order_items soi
  join public.sales_orders so on so.id=soi.sales_order_id
  where soi.id=new.sales_order_item_id;
  if not found then raise exception 'SUPPLY_SO_ITEM_NOT_FOUND'; end if;
  if v_item.status<>'confirmed' then raise exception 'SUPPLY_SO_NOT_CONFIRMED'; end if;
  if tg_op='UPDATE' and new.sales_order_item_id is distinct from old.sales_order_item_id then raise exception 'SUPPLY_PLAN_SALES_ITEM_IMMUTABLE'; end if;

  if new.supply_method='purchase_direct' then
    if new.warehouse_id is not null then raise exception 'SUPPLY_DIRECT_WAREHOUSE_FORBIDDEN'; end if;
  else
    if new.warehouse_id is null then raise exception 'SUPPLY_WAREHOUSE_REQUIRED'; end if;
    select active into v_warehouse_active from public.warehouses where id=new.warehouse_id;
    if not found then raise exception 'SUPPLY_WAREHOUSE_NOT_FOUND'; end if;
    if v_warehouse_active is not true then raise exception 'SUPPLY_WAREHOUSE_INACTIVE'; end if;
  end if;

  select coalesce(sum(planned_quantity),0),coalesce(sum(planned_pallets),0)
    into v_other_quantity,v_other_pallets
  from public.sales_supply_plan_lines
  where sales_order_item_id=new.sales_order_item_id and id is distinct from new.id;
  if v_other_quantity+new.planned_quantity>v_item.ordered_quantity then raise exception 'SUPPLY_PLAN_EXCEEDS_ORDER_QUANTITY'; end if;
  if coalesce(v_item.ordered_pallets,0)>0 and v_other_pallets+new.planned_pallets>v_item.ordered_pallets then raise exception 'SUPPLY_PLAN_EXCEEDS_ORDER_PALLETS'; end if;

  select
    coalesce(sum(planned_quantity) filter (where supply_method='purchase_direct'),0),
    coalesce(sum(planned_pallets) filter (where supply_method='purchase_direct'),0)
    into v_other_direct_quantity,v_other_direct_pallets
  from public.sales_supply_plan_lines
  where sales_order_item_id=new.sales_order_item_id and id is distinct from new.id;

  select coalesce(sum(sfa.allocated_quantity),0),coalesce(sum(sfa.allocated_pallets),0)
    into v_active_load_quantity,v_active_load_pallets
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id=sfa.load_item_id
  join public.loads l on l.id=li.load_id
  where sfa.sales_order_item_id=new.sales_order_item_id and l.status<>'cancelled';

  v_direct_quantity := v_other_direct_quantity + case when new.supply_method='purchase_direct' then new.planned_quantity else 0 end;
  v_direct_pallets := v_other_direct_pallets + case when new.supply_method='purchase_direct' then new.planned_pallets else 0 end;
  if v_active_load_quantity + v_direct_quantity > v_item.ordered_quantity then raise exception 'SUPPLY_DIRECT_CONFLICTS_WITH_LOAD'; end if;
  if coalesce(v_item.ordered_pallets,0)>0 and v_active_load_pallets + v_direct_pallets > v_item.ordered_pallets then raise exception 'SUPPLY_DIRECT_PALLETS_CONFLICT_WITH_LOAD'; end if;

  if tg_op='UPDATE' then
    select exists(select 1 from public.sales_procurement_allocations where supply_plan_line_id=old.id) into v_has_procurement;
    if v_has_procurement and (new.supply_method is distinct from old.supply_method or new.warehouse_id is distinct from old.warehouse_id) then raise exception 'SUPPLY_PLAN_CONTEXT_LOCKED_BY_PROCUREMENT'; end if;
    select coalesce(sum(spa.allocated_sales_quantity),0),coalesce(sum(spa.allocated_sales_pallets),0)
      into v_linked_quantity,v_linked_pallets
    from public.sales_procurement_allocations spa
    join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
    join public.purchase_orders po on po.id=poi.purchase_order_id
    where spa.supply_plan_line_id=old.id and po.status<>'cancelled';
    if v_linked_quantity>new.planned_quantity then raise exception 'SUPPLY_PLAN_BELOW_PROCUREMENT_QUANTITY'; end if;
    if new.planned_pallets>0 and v_linked_pallets>new.planned_pallets then raise exception 'SUPPLY_PLAN_BELOW_PROCUREMENT_PALLETS'; end if;
  end if;
  return new;
end;
$function$;

create or replace function public.validate_sales_fulfillment_allocation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_client_id uuid; v_importer_id uuid; v_so_status text; v_so_product_id uuid; v_so_unit text; v_ordered_quantity numeric; v_ordered_pallets numeric;
  v_load_id uuid; v_load_status text; v_load_client_id uuid; v_load_importer_id uuid; v_load_shipment_id uuid; v_load_product_id uuid; v_load_unit text; v_load_quantity numeric; v_load_pallets numeric;
  v_shipment_client_id uuid; v_shipment_importer_id uuid; v_existing_so_quantity numeric; v_existing_so_pallets numeric; v_existing_load_quantity numeric; v_existing_load_pallets numeric;
  v_direct_plan_quantity numeric; v_direct_plan_pallets numeric;
  v_repair_mode boolean := coalesce(current_setting('app.sales_load_repair', true), '') = 'on';
begin
  select so.client_id, so.importer_id, so.status, soi.product_id, soi.unit, soi.ordered_quantity, soi.ordered_pallets
    into v_client_id, v_importer_id, v_so_status, v_so_product_id, v_so_unit, v_ordered_quantity, v_ordered_pallets
  from public.sales_order_items soi
  join public.sales_orders so on so.id = soi.sales_order_id
  where soi.id = new.sales_order_item_id
  for update of soi, so;
  if not found then raise exception 'SO_ITEM_NOT_FOUND'; end if;
  if v_so_status <> 'confirmed' then raise exception 'SO_NOT_CONFIRMED'; end if;

  select li.load_id, l.status, l.client_id, l.importer_id, l.shipment_id, li.product_id, li.unit, li.planned_quantity, li.planned_pallets
    into v_load_id, v_load_status, v_load_client_id, v_load_importer_id, v_load_shipment_id, v_load_product_id, v_load_unit, v_load_quantity, v_load_pallets
  from public.load_items li
  join public.loads l on l.id = li.load_id
  where li.id = new.load_item_id
  for update of li, l;
  if not found then raise exception 'LOAD_ITEM_NOT_FOUND'; end if;
  if v_load_status <> 'draft' and not v_repair_mode then raise exception 'SO_LOAD_NOT_DRAFT'; end if;
  if v_repair_mode and v_load_status not in ('draft','reserved','loading','loaded','dispatched') then raise exception 'SO_LOAD_REPAIR_STATUS_INVALID'; end if;
  if v_load_product_id <> v_so_product_id then raise exception 'SO_LOAD_PRODUCT_MISMATCH'; end if;
  if btrim(v_load_unit) is distinct from btrim(v_so_unit) then raise exception 'SO_LOAD_UNIT_MISMATCH'; end if;
  if v_ordered_pallets = 0 and new.allocated_pallets <> 0 then raise exception 'SO_PALLET_ALLOCATION_NOT_ALLOWED'; end if;
  if v_load_pallets = 0 and new.allocated_pallets <> 0 then raise exception 'LOAD_PALLET_ALLOCATION_NOT_ALLOWED'; end if;

  select coalesce(sum(sfa.allocated_quantity),0), coalesce(sum(sfa.allocated_pallets),0)
    into v_existing_so_quantity, v_existing_so_pallets
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id = sfa.load_item_id
  join public.loads l on l.id = li.load_id
  where sfa.sales_order_item_id = new.sales_order_item_id and sfa.id <> new.id and l.status <> 'cancelled';

  select
    coalesce(sum(planned_quantity),0),
    coalesce(sum(planned_pallets),0)
    into v_direct_plan_quantity,v_direct_plan_pallets
  from public.sales_supply_plan_lines
  where sales_order_item_id=new.sales_order_item_id and supply_method='purchase_direct';

  if v_existing_so_quantity + new.allocated_quantity + v_direct_plan_quantity > v_ordered_quantity
     or v_existing_so_pallets + new.allocated_pallets + v_direct_plan_pallets > v_ordered_pallets then
    raise exception 'SO_ALLOCATION_CONFLICTS_WITH_DIRECT_SUPPLY';
  end if;

  select coalesce(sum(allocated_quantity),0), coalesce(sum(allocated_pallets),0)
    into v_existing_load_quantity, v_existing_load_pallets
  from public.sales_fulfillment_allocations
  where load_item_id = new.load_item_id and id <> new.id;
  if v_existing_load_quantity + new.allocated_quantity > v_load_quantity or v_existing_load_pallets + new.allocated_pallets > v_load_pallets then raise exception 'SO_ALLOCATION_EXCEEDS_LOAD_ITEM'; end if;

  if v_load_client_id is null and v_load_importer_id is null then
    if v_load_shipment_id is not null then
      select client_id, importer_id into v_shipment_client_id, v_shipment_importer_id from public.shipments where id = v_load_shipment_id;
      if v_shipment_client_id is distinct from v_client_id or v_shipment_importer_id is distinct from v_importer_id then raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH'; end if;
    end if;
    update public.loads set client_id = v_client_id, importer_id = v_importer_id where id = v_load_id;
  elsif v_load_client_id is distinct from v_client_id or v_load_importer_id is distinct from v_importer_id then
    raise exception 'LOAD_SALES_CONTEXT_MISMATCH';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_sales_order_status()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare v_item_count integer; v_incomplete_count integer; v_client_active boolean; v_importer_active boolean;
begin
  if new.status = old.status then return new; end if;
  if old.status in ('closed','cancelled') then raise exception 'SO_STATUS_FINAL'; end if;
  if old.status='draft' and new.status not in ('confirmed','cancelled') then raise exception 'SO_STATUS_TRANSITION_INVALID'; end if;
  if old.status='confirmed' and new.status not in ('closed','cancelled') then raise exception 'SO_STATUS_TRANSITION_INVALID'; end if;
  select count(*) into v_item_count from public.sales_order_items where sales_order_id = old.id;
  if new.status='confirmed' and v_item_count=0 then raise exception 'SO_HAS_NO_ITEMS'; end if;
  if new.status='confirmed' then
    select active into v_client_active from public.clients where id = old.client_id;
    if v_client_active is not true then raise exception 'SO_CLIENT_INACTIVE'; end if;
    if old.importer_id is not null then
      select active into v_importer_active from public.importers where id = old.importer_id;
      if v_importer_active is not true then raise exception 'SO_IMPORTER_INACTIVE'; end if;
      if not exists (select 1 from public.client_importers where client_id = old.client_id and importer_id = old.importer_id) then raise exception 'SO_CLIENT_IMPORTER_MISMATCH'; end if;
    end if;
  end if;
  if new.status='closed' then
    select count(*) into v_incomplete_count from public.sales_order_item_progress where sales_order_id = old.id and not is_fully_dispatched;
    if v_item_count=0 or v_incomplete_count>0 then raise exception 'SO_NOT_FULLY_DISPATCHED'; end if;
  end if;
  if new.status='cancelled' and exists (
    select 1 from public.sales_order_items soi
    join public.sales_fulfillment_allocations sfa on sfa.sales_order_item_id=soi.id
    join public.load_items li on li.id=sfa.load_item_id
    join public.loads l on l.id=li.load_id
    where soi.sales_order_id=old.id and l.status<>'cancelled'
  ) then raise exception 'SO_HAS_ACTIVE_LOAD_ALLOCATIONS'; end if;
  if new.status='cancelled' and exists (
    select 1 from public.sales_supply_plan_lines spl
    join public.sales_order_items soi on soi.id=spl.sales_order_item_id
    where soi.sales_order_id=old.id
  ) then raise exception 'SO_HAS_ACTIVE_SUPPLY_PLAN'; end if;
  return new;
end;
$function$;

create or replace function public.guard_purchase_order_ap_cancellation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    if exists (
      select 1 from public.supplier_bills
      where purchase_order_id = old.id and status <> 'void'
    ) or exists (
      select 1 from public.supplier_payments
      where purchase_order_id = old.id and status = 'posted'
    ) then
      raise exception 'PO_HAS_ACTIVE_AP';
    end if;
    if exists (
      select 1
      from public.purchase_order_items poi
      join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id
      where poi.purchase_order_id=old.id
    ) then
      raise exception 'PO_HAS_ACTIVE_SALES_PROCUREMENT';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.mark_direct_shipment_dispatched(
  p_shipment_id uuid,
  p_dispatched_at timestamptz default now(),
  p_actor uuid default null,
  p_notes text default null
)
returns public.direct_shipment_dispatches
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_shipment public.shipments;
  v_result public.direct_shipment_dispatches;
begin
  if p_shipment_id is null then raise exception 'DIRECT_SHIPMENT_REQUIRED'; end if;
  select * into v_shipment from public.shipments where id=p_shipment_id for update;
  if not found then raise exception 'DIRECT_SHIPMENT_NOT_FOUND'; end if;
  if exists(select 1 from public.direct_shipment_dispatches where shipment_id=p_shipment_id) then raise exception 'DIRECT_SHIPMENT_ALREADY_DISPATCHED'; end if;
  if exists(select 1 from public.loads where shipment_id=p_shipment_id and status<>'cancelled') then raise exception 'DIRECT_SHIPMENT_HAS_LOAD'; end if;
  if not exists(select 1 from public.direct_shipment_allocations where shipment_id=p_shipment_id) then raise exception 'DIRECT_SHIPMENT_HAS_NO_ALLOCATIONS'; end if;
  if exists (
    select 1
    from public.direct_shipment_allocations dsa
    join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
    join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
    join public.sales_order_items soi on soi.id=spl.sales_order_item_id
    join public.sales_orders so on so.id=soi.sales_order_id
    where dsa.shipment_id=p_shipment_id and so.status<>'confirmed'
  ) then raise exception 'DIRECT_SHIPMENT_SALE_NOT_CONFIRMED'; end if;
  if exists (
    select 1
    from public.direct_shipment_allocations dsa
    join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
    join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
    join public.purchase_orders po on po.id=poi.purchase_order_id
    where dsa.shipment_id=p_shipment_id and po.status not in ('confirmed','closed')
  ) then raise exception 'DIRECT_SHIPMENT_PO_NOT_CONFIRMED'; end if;
  insert into public.direct_shipment_dispatches(shipment_id,dispatched_at,dispatched_by,notes)
  values(p_shipment_id,coalesce(p_dispatched_at,now()),p_actor,nullif(btrim(p_notes),''))
  returning * into v_result;
  insert into public.shipment_history(shipment_id,client_id,event_type,title,details,source)
  values(p_shipment_id,v_shipment.client_id,'direct_shipment_dispatched','Direct Ship despachado',coalesce(nullif(btrim(p_notes),''),'Mercancía despachada directamente desde el proveedor.'),'sales_supply');
  return v_result;
end;
$function$;

revoke all on function public.mark_direct_shipment_dispatched(uuid,timestamptz,uuid,text) from public, anon, authenticated;
grant execute on function public.mark_direct_shipment_dispatched(uuid,timestamptz,uuid,text) to service_role;

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
  select
    sales_order_item_id,
    coalesce(sum(planned_quantity),0::numeric) as planned_quantity,
    coalesce(sum(planned_pallets),0::numeric) as planned_pallets
  from public.sales_supply_plan_lines
  where supply_method='purchase_direct'
  group by sales_order_item_id
),
direct_dispatch_totals as (
  select
    spl.sales_order_item_id,
    coalesce(sum(dsa.allocated_sales_quantity),0::numeric) as dispatched_quantity,
    coalesce(sum(dsa.allocated_sales_pallets),0::numeric) as dispatched_pallets
  from public.direct_shipment_allocations dsa
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
  greatest(
    soi.ordered_quantity
      - coalesce(l.planned_quantity,0::numeric)
      - coalesce(l.prepared_quantity,0::numeric)
      - coalesce(l.dispatched_quantity,0::numeric)
      - coalesce(dp.planned_quantity,0::numeric),
    0::numeric
  ) as unallocated_quantity,
  greatest(
    soi.ordered_pallets
      - coalesce(l.planned_pallets,0::numeric)
      - coalesce(l.prepared_pallets,0::numeric)
      - coalesce(l.dispatched_pallets,0::numeric)
      - coalesce(dp.planned_pallets,0::numeric),
    0::numeric
  ) as unallocated_pallets,
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
  dsd.notes as direct_dispatch_notes
from public.direct_shipment_allocations dsa
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

create or replace view public.shipment_customs_document_readiness
with (security_invoker=true)
as
with load_state as (
  select shipment_id,bool_or(status='dispatched') as has_dispatched_load
  from public.loads
  where shipment_id is not null
  group by shipment_id
),
direct_state as (
  select shipment_id,true as has_direct_dispatch
  from public.direct_shipment_dispatches
),
document_state as (
  select
    shipment_id,
    bool_or(generated=false and lower(btrim(document_type))='packing list cuba') as has_packing_list_cuba,
    bool_or(generated=false and lower(btrim(document_type)) in ('commercial invoice cuba','factura comercial cuba')) as has_commercial_invoice_cuba,
    count(*) filter (where generated=false) as manual_document_count
  from public.documents
  where shipment_id is not null
  group by shipment_id
),
base as (
  select
    s.id as shipment_id,
    s.container_number,
    s.client_id,
    s.active,
    s.operational_status,
    s.last_status,
    s.departure_date,
    s.delivered_at,
    coalesce(ls.has_dispatched_load,false)
      or coalesce(ds.has_direct_dispatch,false)
      or s.departure_date is not null
      or s.delivered_at is not null
      or s.active=false as documentation_required,
    coalesce(docs.has_packing_list_cuba,false) as has_packing_list_cuba,
    coalesce(docs.has_commercial_invoice_cuba,false) as has_commercial_invoice_cuba,
    coalesce(docs.manual_document_count,0)::bigint as manual_document_count
  from public.shipments s
  left join load_state ls on ls.shipment_id=s.id
  left join direct_state ds on ds.shipment_id=s.id
  left join document_state docs on docs.shipment_id=s.id
)
select
  base.*,
  case
    when not documentation_required then 'not_required'
    when has_packing_list_cuba and has_commercial_invoice_cuba then 'ready'
    else 'pending'
  end as document_status,
  case
    when not documentation_required then array[]::text[]
    else array_remove(array[
      case when not has_packing_list_cuba then 'Packing List Cuba' end,
      case when not has_commercial_invoice_cuba then 'Commercial Invoice Cuba' end
    ],null)
  end as missing_documents
from base;

revoke all on public.shipment_customs_document_readiness from anon, authenticated;
grant select on public.shipment_customs_document_readiness to service_role;
