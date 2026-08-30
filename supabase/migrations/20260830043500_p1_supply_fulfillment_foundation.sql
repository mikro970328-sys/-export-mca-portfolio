-- P1.0 · Abastecimiento y fulfillment definitivo.
-- Planifica cada línea de venta sin reservar inventario y sin crear WR/Cargues ficticios.

create table public.sales_supply_plan_lines (
  id uuid primary key default gen_random_uuid(),
  sales_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
  supply_method text not null check (supply_method in ('inventory','purchase_warehouse','purchase_direct')),
  warehouse_id uuid references public.warehouses(id) on delete restrict,
  planned_quantity numeric not null check (planned_quantity > 0),
  planned_pallets numeric not null default 0 check (planned_pallets >= 0),
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_supply_plan_method_warehouse_check check (
    (supply_method = 'purchase_direct' and warehouse_id is null)
    or (supply_method in ('inventory','purchase_warehouse') and warehouse_id is not null)
  )
);

create index sales_supply_plan_lines_so_item_idx
  on public.sales_supply_plan_lines(sales_order_item_id);
create index sales_supply_plan_lines_warehouse_idx
  on public.sales_supply_plan_lines(warehouse_id) where warehouse_id is not null;
create index sales_supply_plan_lines_created_by_idx
  on public.sales_supply_plan_lines(created_by) where created_by is not null;

-- Vincula compra y venta con cantidades explícitas en ambos lados.
-- No se presume que la unidad comercial sea igual a la unidad de compra.
create table public.sales_procurement_allocations (
  id uuid primary key default gen_random_uuid(),
  supply_plan_line_id uuid not null references public.sales_supply_plan_lines(id) on delete restrict,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete restrict,
  allocated_sales_quantity numeric not null check (allocated_sales_quantity > 0),
  allocated_sales_pallets numeric not null default 0 check (allocated_sales_pallets >= 0),
  allocated_purchase_quantity numeric not null check (allocated_purchase_quantity > 0),
  allocated_purchase_pallets numeric not null default 0 check (allocated_purchase_pallets >= 0),
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_procurement_allocations_source_unique
    unique(supply_plan_line_id,purchase_order_item_id)
);

create index sales_procurement_allocations_plan_idx
  on public.sales_procurement_allocations(supply_plan_line_id);
create index sales_procurement_allocations_po_item_idx
  on public.sales_procurement_allocations(purchase_order_item_id);
create index sales_procurement_allocations_created_by_idx
  on public.sales_procurement_allocations(created_by) where created_by is not null;

-- Direct Ship enlaza compra directa con Shipment/Contenedor sin pasar por WR ni Cargue.
create table public.direct_shipment_allocations (
  id uuid primary key default gen_random_uuid(),
  sales_procurement_allocation_id uuid not null references public.sales_procurement_allocations(id) on delete restrict,
  shipment_id uuid not null references public.shipments(id) on delete restrict,
  allocated_sales_quantity numeric not null check (allocated_sales_quantity > 0),
  allocated_sales_pallets numeric not null default 0 check (allocated_sales_pallets >= 0),
  allocated_purchase_quantity numeric not null check (allocated_purchase_quantity > 0),
  allocated_purchase_pallets numeric not null default 0 check (allocated_purchase_pallets >= 0),
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint direct_shipment_allocations_source_unique
    unique(sales_procurement_allocation_id,shipment_id)
);

create index direct_shipment_allocations_procurement_idx
  on public.direct_shipment_allocations(sales_procurement_allocation_id);
create index direct_shipment_allocations_shipment_idx
  on public.direct_shipment_allocations(shipment_id);
create index direct_shipment_allocations_created_by_idx
  on public.direct_shipment_allocations(created_by) where created_by is not null;

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
begin
  select soi.ordered_quantity, soi.ordered_pallets, so.status
    into v_item
  from public.sales_order_items soi
  join public.sales_orders so on so.id=soi.sales_order_id
  where soi.id=new.sales_order_item_id;

  if not found then raise exception 'SUPPLY_SO_ITEM_NOT_FOUND'; end if;
  if v_item.status<>'confirmed' then raise exception 'SUPPLY_SO_NOT_CONFIRMED'; end if;

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
  where sales_order_item_id=new.sales_order_item_id
    and id is distinct from new.id;

  if v_other_quantity+new.planned_quantity>v_item.ordered_quantity then
    raise exception 'SUPPLY_PLAN_EXCEEDS_ORDER_QUANTITY';
  end if;
  if coalesce(v_item.ordered_pallets,0)>0
     and v_other_pallets+new.planned_pallets>v_item.ordered_pallets then
    raise exception 'SUPPLY_PLAN_EXCEEDS_ORDER_PALLETS';
  end if;

  if tg_op='UPDATE' then
    select coalesce(sum(spa.allocated_sales_quantity),0),coalesce(sum(spa.allocated_sales_pallets),0)
      into v_linked_quantity,v_linked_pallets
    from public.sales_procurement_allocations spa
    join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
    join public.purchase_orders po on po.id=poi.purchase_order_id
    where spa.supply_plan_line_id=old.id
      and po.status<>'cancelled';

    if v_linked_quantity>0 and new.supply_method='inventory' then
      raise exception 'SUPPLY_METHOD_LOCKED_BY_PROCUREMENT';
    end if;
    if v_linked_quantity>new.planned_quantity then
      raise exception 'SUPPLY_PLAN_BELOW_PROCUREMENT_QUANTITY';
    end if;
    if new.planned_pallets>0 and v_linked_pallets>new.planned_pallets then
      raise exception 'SUPPLY_PLAN_BELOW_PROCUREMENT_PALLETS';
    end if;
  end if;

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
begin
  select spl.supply_method,spl.warehouse_id,spl.planned_quantity,spl.planned_pallets,
         soi.product_id,so.status as sales_status
    into v_plan
  from public.sales_supply_plan_lines spl
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where spl.id=new.supply_plan_line_id;

  if not found then raise exception 'SUPPLY_PLAN_NOT_FOUND'; end if;
  if v_plan.supply_method not in ('purchase_warehouse','purchase_direct') then
    raise exception 'SUPPLY_PLAN_NOT_PURCHASE';
  end if;
  if v_plan.sales_status<>'confirmed' then raise exception 'SUPPLY_SO_NOT_CONFIRMED'; end if;

  select poi.product_id,poi.ordered_quantity,poi.ordered_pallets,
         po.warehouse_id,po.status as po_status
    into v_po
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where poi.id=new.purchase_order_item_id;

  if not found then raise exception 'SUPPLY_PO_ITEM_NOT_FOUND'; end if;
  if v_po.po_status='cancelled' then raise exception 'SUPPLY_PO_CANCELLED'; end if;
  if v_po.product_id<>v_plan.product_id then raise exception 'SUPPLY_PRODUCT_MISMATCH'; end if;

  if v_plan.supply_method='purchase_warehouse' then
    if v_po.warehouse_id is not null and v_po.warehouse_id<>v_plan.warehouse_id then
      raise exception 'SUPPLY_PO_WAREHOUSE_MISMATCH';
    end if;
  elsif v_po.warehouse_id is not null then
    raise exception 'SUPPLY_DIRECT_PO_HAS_WAREHOUSE';
  end if;

  select coalesce(sum(spa.allocated_sales_quantity),0),
         coalesce(sum(spa.allocated_sales_pallets),0)
    into v_plan_q,v_plan_p
  from public.sales_procurement_allocations spa
  join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where spa.supply_plan_line_id=new.supply_plan_line_id
    and spa.id is distinct from new.id
    and po.status<>'cancelled';

  if v_plan_q+new.allocated_sales_quantity>v_plan.planned_quantity then
    raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PLAN';
  end if;
  if v_plan.planned_pallets>0
     and v_plan_p+new.allocated_sales_pallets>v_plan.planned_pallets then
    raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PLAN_PALLETS';
  end if;

  select coalesce(sum(spa.allocated_purchase_quantity),0),
         coalesce(sum(spa.allocated_purchase_pallets),0)
    into v_po_q,v_po_p
  from public.sales_procurement_allocations spa
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where spa.purchase_order_item_id=new.purchase_order_item_id
    and spa.id is distinct from new.id
    and so.status<>'cancelled';

  if v_po_q+new.allocated_purchase_quantity>v_po.ordered_quantity then
    raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PO';
  end if;
  if coalesce(v_po.ordered_pallets,0)>0
     and v_po_p+new.allocated_purchase_pallets>v_po.ordered_pallets then
    raise exception 'SUPPLY_PROCUREMENT_EXCEEDS_PO_PALLETS';
  end if;

  return new;
end;
$function$;

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
  if v_ctx.supply_method<>'purchase_direct' then
    raise exception 'DIRECT_SHIPMENT_REQUIRES_DIRECT_PURCHASE';
  end if;
  if v_ctx.sales_status<>'confirmed' then raise exception 'DIRECT_SHIPMENT_SALE_NOT_CONFIRMED'; end if;
  if v_ctx.po_status<>'confirmed' then raise exception 'DIRECT_SHIPMENT_PO_NOT_CONFIRMED'; end if;
  if exists(select 1 from public.loads where shipment_id=new.shipment_id and status<>'cancelled') then
    raise exception 'DIRECT_SHIPMENT_HAS_LOAD';
  end if;
  if v_ctx.shipment_client_id is not null and v_ctx.shipment_client_id<>v_ctx.client_id then
    raise exception 'DIRECT_SHIPMENT_CLIENT_MISMATCH';
  end if;
  if v_ctx.shipment_importer_id is not null
     and v_ctx.shipment_importer_id is distinct from v_ctx.importer_id then
    raise exception 'DIRECT_SHIPMENT_IMPORTER_MISMATCH';
  end if;

  select so.client_id,so.importer_id
    into v_existing_client,v_existing_importer
  from public.direct_shipment_allocations dsa
  join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where dsa.shipment_id=new.shipment_id
    and dsa.id is distinct from new.id
  limit 1;

  if found and (
    v_existing_client<>v_ctx.client_id
    or v_existing_importer is distinct from v_ctx.importer_id
  ) then
    raise exception 'DIRECT_SHIPMENT_MIXED_COMMERCIAL_CONTEXT';
  end if;

  select coalesce(sum(allocated_sales_quantity),0),
         coalesce(sum(allocated_sales_pallets),0),
         coalesce(sum(allocated_purchase_quantity),0),
         coalesce(sum(allocated_purchase_pallets),0)
    into v_sales_q,v_sales_p,v_purchase_q,v_purchase_p
  from public.direct_shipment_allocations
  where sales_procurement_allocation_id=new.sales_procurement_allocation_id
    and id is distinct from new.id;

  if v_sales_q+new.allocated_sales_quantity>v_ctx.proc_sales_q then
    raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_SALES';
  end if;
  if v_ctx.proc_sales_p>0
     and v_sales_p+new.allocated_sales_pallets>v_ctx.proc_sales_p then
    raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_SALES_PALLETS';
  end if;
  if v_purchase_q+new.allocated_purchase_quantity>v_ctx.proc_purchase_q then
    raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_PURCHASE';
  end if;
  if v_ctx.proc_purchase_p>0
     and v_purchase_p+new.allocated_purchase_pallets>v_ctx.proc_purchase_p then
    raise exception 'DIRECT_SHIPMENT_EXCEEDS_PROCUREMENT_PURCHASE_PALLETS';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_purchase_order_supply_context()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.warehouse_id is not distinct from old.warehouse_id then return new; end if;

  if exists (
    select 1
    from public.purchase_order_items poi
    join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id
    join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
    where poi.purchase_order_id=old.id
      and (
        (spl.supply_method='purchase_direct' and new.warehouse_id is not null)
        or (
          spl.supply_method='purchase_warehouse'
          and new.warehouse_id is not null
          and new.warehouse_id<>spl.warehouse_id
        )
      )
  ) then
    raise exception 'PO_WAREHOUSE_CONFLICTS_WITH_SUPPLY_PLAN';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_purchase_order_direct_ship_cancel()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status='cancelled'
     and old.status is distinct from 'cancelled'
     and exists (
       select 1
       from public.purchase_order_items poi
       join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id
       join public.direct_shipment_allocations dsa on dsa.sales_procurement_allocation_id=spa.id
       where poi.purchase_order_id=old.id
     ) then
    raise exception 'PO_HAS_DIRECT_SHIPMENT_ALLOCATIONS';
  end if;
  return new;
end;
$function$;

create or replace function public.guard_sales_order_direct_ship_cancel()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.status='cancelled'
     and old.status is distinct from 'cancelled'
     and exists (
       select 1
       from public.sales_order_items soi
       join public.sales_supply_plan_lines spl on spl.sales_order_item_id=soi.id
       join public.sales_procurement_allocations spa on spa.supply_plan_line_id=spl.id
       join public.direct_shipment_allocations dsa on dsa.sales_procurement_allocation_id=spa.id
       where soi.sales_order_id=old.id
     ) then
    raise exception 'SO_HAS_DIRECT_SHIPMENT_ALLOCATIONS';
  end if;
  return new;
end;
$function$;

create trigger sales_supply_plan_lines_validate
before insert or update on public.sales_supply_plan_lines
for each row execute function public.validate_sales_supply_plan_line();

create trigger sales_supply_plan_lines_set_updated_at
before update on public.sales_supply_plan_lines
for each row execute function public.set_erp_updated_at();

create trigger sales_procurement_allocations_validate
before insert or update on public.sales_procurement_allocations
for each row execute function public.validate_sales_procurement_allocation();

create trigger sales_procurement_allocations_set_updated_at
before update on public.sales_procurement_allocations
for each row execute function public.set_erp_updated_at();

create trigger direct_shipment_allocations_validate
before insert or update on public.direct_shipment_allocations
for each row execute function public.validate_direct_shipment_allocation();

create trigger direct_shipment_allocations_set_updated_at
before update on public.direct_shipment_allocations
for each row execute function public.set_erp_updated_at();

create trigger purchase_orders_guard_supply_context
before update of warehouse_id on public.purchase_orders
for each row execute function public.guard_purchase_order_supply_context();

create trigger purchase_orders_guard_direct_ship_cancel
before update of status on public.purchase_orders
for each row execute function public.guard_purchase_order_direct_ship_cancel();

create trigger sales_orders_guard_direct_ship_cancel
before update of status on public.sales_orders
for each row execute function public.guard_sales_order_direct_ship_cancel();

create or replace view public.sales_order_supply_item_progress
with (security_invoker=true)
as
with plan as (
  select sales_order_item_id,
    coalesce(sum(planned_quantity) filter(where supply_method='inventory'),0) as planned_inventory_quantity,
    coalesce(sum(planned_quantity) filter(where supply_method='purchase_warehouse'),0) as planned_purchase_warehouse_quantity,
    coalesce(sum(planned_quantity) filter(where supply_method='purchase_direct'),0) as planned_purchase_direct_quantity,
    coalesce(sum(planned_pallets) filter(where supply_method='inventory'),0) as planned_inventory_pallets,
    coalesce(sum(planned_pallets) filter(where supply_method='purchase_warehouse'),0) as planned_purchase_warehouse_pallets,
    coalesce(sum(planned_pallets) filter(where supply_method='purchase_direct'),0) as planned_purchase_direct_pallets,
    coalesce(sum(planned_quantity),0) as planned_total_quantity,
    coalesce(sum(planned_pallets),0) as planned_total_pallets
  from public.sales_supply_plan_lines
  group by sales_order_item_id
),
procurement as (
  select spl.sales_order_item_id,
    coalesce(sum(spa.allocated_sales_quantity) filter(where po.status<>'cancelled'),0) as procurement_linked_sales_quantity,
    coalesce(sum(spa.allocated_sales_pallets) filter(where po.status<>'cancelled'),0) as procurement_linked_sales_pallets
  from public.sales_supply_plan_lines spl
  join public.sales_procurement_allocations spa on spa.supply_plan_line_id=spl.id
  join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
  join public.purchase_orders po on po.id=poi.purchase_order_id
  group by spl.sales_order_item_id
),
direct as (
  select spl.sales_order_item_id,
    coalesce(sum(dsa.allocated_sales_quantity),0) as direct_container_allocated_sales_quantity,
    coalesce(sum(dsa.allocated_sales_pallets),0) as direct_container_allocated_sales_pallets,
    count(distinct dsa.shipment_id)::integer as direct_container_count
  from public.sales_supply_plan_lines spl
  join public.sales_procurement_allocations spa on spa.supply_plan_line_id=spl.id
  join public.direct_shipment_allocations dsa on dsa.sales_procurement_allocation_id=spa.id
  group by spl.sales_order_item_id
)
select
  soi.id as sales_order_item_id,
  soi.sales_order_id,
  soi.product_id,
  soi.ordered_quantity,
  soi.ordered_pallets,
  soi.unit,
  coalesce(p.planned_inventory_quantity,0) as planned_inventory_quantity,
  coalesce(p.planned_purchase_warehouse_quantity,0) as planned_purchase_warehouse_quantity,
  coalesce(p.planned_purchase_direct_quantity,0) as planned_purchase_direct_quantity,
  coalesce(p.planned_total_quantity,0) as planned_total_quantity,
  greatest(soi.ordered_quantity-coalesce(p.planned_total_quantity,0),0) as unplanned_quantity,
  coalesce(p.planned_inventory_pallets,0) as planned_inventory_pallets,
  coalesce(p.planned_purchase_warehouse_pallets,0) as planned_purchase_warehouse_pallets,
  coalesce(p.planned_purchase_direct_pallets,0) as planned_purchase_direct_pallets,
  coalesce(p.planned_total_pallets,0) as planned_total_pallets,
  case
    when soi.ordered_pallets>0 then greatest(soi.ordered_pallets-coalesce(p.planned_total_pallets,0),0)
    else 0
  end as unplanned_pallets,
  coalesce(pr.procurement_linked_sales_quantity,0) as procurement_linked_sales_quantity,
  coalesce(pr.procurement_linked_sales_pallets,0) as procurement_linked_sales_pallets,
  coalesce(d.direct_container_allocated_sales_quantity,0) as direct_container_allocated_sales_quantity,
  coalesce(d.direct_container_allocated_sales_pallets,0) as direct_container_allocated_sales_pallets,
  coalesce(d.direct_container_count,0) as direct_container_count,
  case
    when coalesce(p.planned_total_quantity,0)=0 then 'unplanned'
    when coalesce(p.planned_total_quantity,0)<soi.ordered_quantity then 'partial'
    else 'planned'
  end as supply_plan_status
from public.sales_order_items soi
left join plan p on p.sales_order_item_id=soi.id
left join procurement pr on pr.sales_order_item_id=soi.id
left join direct d on d.sales_order_item_id=soi.id;

create or replace view public.sales_order_supply_progress
with (security_invoker=true)
as
select
  so.id as sales_order_id,
  so.so_number,
  count(sip.sales_order_item_id)::integer as item_count,
  count(sip.sales_order_item_id) filter(where sip.supply_plan_status='unplanned')::integer as unplanned_items,
  count(sip.sales_order_item_id) filter(where sip.supply_plan_status='partial')::integer as partially_planned_items,
  count(sip.sales_order_item_id) filter(where sip.supply_plan_status='planned')::integer as planned_items,
  coalesce(sum(sip.unplanned_quantity),0) as unplanned_quantity,
  case
    when count(sip.sales_order_item_id)=0 then 'empty'
    when count(sip.sales_order_item_id) filter(where sip.supply_plan_status='planned')=count(sip.sales_order_item_id) then 'planned'
    when count(sip.sales_order_item_id) filter(where sip.supply_plan_status='unplanned')=count(sip.sales_order_item_id) then 'unplanned'
    else 'partial'
  end as supply_plan_status
from public.sales_orders so
left join public.sales_order_supply_item_progress sip on sip.sales_order_id=so.id
group by so.id,so.so_number;

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
  so.importer_id
from public.direct_shipment_allocations dsa
join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
join public.sales_order_items soi on soi.id=spl.sales_order_item_id
join public.sales_orders so on so.id=soi.sales_order_id
join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
join public.purchase_orders po on po.id=poi.purchase_order_id
join public.products p on p.id=soi.product_id
join public.shipments s on s.id=dsa.shipment_id;

alter table public.sales_supply_plan_lines enable row level security;
alter table public.sales_procurement_allocations enable row level security;
alter table public.direct_shipment_allocations enable row level security;

revoke all on table
  public.sales_supply_plan_lines,
  public.sales_procurement_allocations,
  public.direct_shipment_allocations
from anon,authenticated;

revoke all on table
  public.sales_order_supply_item_progress,
  public.sales_order_supply_progress,
  public.shipment_direct_supply_contents
from anon,authenticated;

grant select,insert,update,delete on table
  public.sales_supply_plan_lines,
  public.sales_procurement_allocations,
  public.direct_shipment_allocations
to service_role;

grant select on table
  public.sales_order_supply_item_progress,
  public.sales_order_supply_progress,
  public.shipment_direct_supply_contents
to service_role;

revoke all on function
  public.validate_sales_supply_plan_line(),
  public.validate_sales_procurement_allocation(),
  public.validate_direct_shipment_allocation(),
  public.guard_purchase_order_supply_context(),
  public.guard_purchase_order_direct_ship_cancel(),
  public.guard_sales_order_direct_ship_cancel()
from public,anon,authenticated;

comment on table public.sales_supply_plan_lines is
  'Plan de abastecimiento por línea de Sales Order. No reserva inventario; permite stock, compra a almacén y compra directa.';
comment on table public.sales_procurement_allocations is
  'Relación explícita entre plan de abastecimiento de venta y línea de PO, conservando cantidades de venta y compra por separado.';
comment on table public.direct_shipment_allocations is
  'Relación explícita de compra directa a Shipment/Contenedor sin WR ni Cargue ficticio.';
comment on view public.sales_order_supply_item_progress is
  'Read model autoritativo del plan de abastecimiento por línea de Sales Order.';
comment on view public.sales_order_supply_progress is
  'Read model agregado del estado de planificación de abastecimiento por Sales Order.';
comment on view public.shipment_direct_supply_contents is
  'Contenido comercial/procurement explícito de Shipments abastecidos por compra directa.';
