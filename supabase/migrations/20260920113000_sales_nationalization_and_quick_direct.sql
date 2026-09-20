-- Ventas: estado de nacionalizacion y asignacion Direct Ship en un solo paso.

alter table public.sales_orders
  add column if not exists nationalization_status text;

alter table public.sales_orders
  drop constraint if exists sales_orders_nationalization_status_check;

alter table public.sales_orders
  add constraint sales_orders_nationalization_status_check
  check (nationalization_status is null or nationalization_status in ('nationalized','not_nationalized'));

comment on column public.sales_orders.nationalization_status is
  'Indica si la mercancia de la venta esta nacionalizada o no nacionalizada.';

create or replace function public.create_sales_order_plan_with_nationalization(
  p_client_id uuid,
  p_lines jsonb,
  p_importer_id uuid default null,
  p_order_date date default current_date,
  p_requested_at timestamptz default null,
  p_currency text default 'USD',
  p_customer_reference text default null,
  p_notes text default null,
  p_actor uuid default null,
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
  if v_status is not null and v_status not in ('nationalized','not_nationalized') then
    raise exception 'SO_NATIONALIZATION_STATUS_INVALID';
  end if;

  select * into v_so
  from public.create_sales_order_plan(
    p_client_id,p_lines,p_importer_id,p_order_date,p_requested_at,p_currency,
    p_customer_reference,p_notes,p_actor
  );

  update public.sales_orders
  set nationalization_status=v_status
  where id=v_so.id;

  select * into v_so from public.sales_orders where id=v_so.id;
  return v_so;
end;
$$;

create or replace function public.replace_sales_order_plan_with_nationalization(
  p_sales_order_id uuid,
  p_client_id uuid,
  p_lines jsonb,
  p_importer_id uuid default null,
  p_order_date date default current_date,
  p_requested_at timestamptz default null,
  p_currency text default 'USD',
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
  if v_status is not null and v_status not in ('nationalized','not_nationalized') then
    raise exception 'SO_NATIONALIZATION_STATUS_INVALID';
  end if;

  select * into v_so
  from public.replace_sales_order_plan(
    p_sales_order_id,p_client_id,p_lines,p_importer_id,p_order_date,p_requested_at,
    p_currency,p_customer_reference,p_notes
  );

  update public.sales_orders
  set nationalization_status=v_status
  where id=v_so.id;

  select * into v_so from public.sales_orders where id=v_so.id;
  return v_so;
end;
$$;

create or replace function public.guard_sales_order_structure()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.status <> 'draft' and (
    new.client_id is distinct from old.client_id
    or new.importer_id is distinct from old.importer_id
    or new.currency is distinct from old.currency
    or new.order_date is distinct from old.order_date
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

drop trigger if exists sales_orders_guard_structure on public.sales_orders;
create trigger sales_orders_guard_structure
before update of client_id, importer_id, currency, order_date, requested_at, customer_reference, nationalization_status
on public.sales_orders
for each row execute function public.guard_sales_order_structure();

create or replace function public.assign_sales_order_item_direct_ship(
  p_sales_order_item_id uuid,
  p_purchase_order_item_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_sale record;
  v_purchase record;
  v_sales_planned_quantity numeric;
  v_sales_planned_pallets numeric;
  v_purchase_allocated_quantity numeric;
  v_purchase_allocated_pallets numeric;
  v_sales_remaining_quantity numeric;
  v_purchase_remaining_quantity numeric;
  v_quantity numeric;
  v_sales_pallets numeric;
  v_purchase_pallets numeric;
  v_plan public.sales_supply_plan_lines;
  v_allocation public.sales_procurement_allocations;
begin
  select soi.id,soi.product_id,soi.ordered_quantity,soi.ordered_pallets,so.status
    into v_sale
  from public.sales_order_items soi
  join public.sales_orders so on so.id=soi.sales_order_id
  where soi.id=p_sales_order_item_id
  for update of soi,so;
  if not found then raise exception 'SO_ITEM_NOT_FOUND'; end if;
  if v_sale.status<>'confirmed' then raise exception 'SUPPLY_SO_NOT_CONFIRMED'; end if;

  select poi.id,poi.product_id,poi.ordered_quantity,poi.ordered_pallets,po.status,po.warehouse_id
    into v_purchase
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where poi.id=p_purchase_order_item_id
  for update of poi,po;
  if not found then raise exception 'SUPPLY_PO_ITEM_NOT_FOUND'; end if;
  if v_purchase.status<>'confirmed' then raise exception 'SUPPLY_QUICK_DIRECT_PO_NOT_CONFIRMED'; end if;
  if v_purchase.warehouse_id is not null then raise exception 'SUPPLY_DIRECT_PO_HAS_WAREHOUSE'; end if;
  if v_purchase.product_id<>v_sale.product_id then raise exception 'SUPPLY_PRODUCT_MISMATCH'; end if;

  select coalesce(sum(planned_quantity),0),coalesce(sum(planned_pallets),0)
    into v_sales_planned_quantity,v_sales_planned_pallets
  from public.sales_supply_plan_lines
  where sales_order_item_id=p_sales_order_item_id;

  select coalesce(sum(spa.allocated_purchase_quantity),0),coalesce(sum(spa.allocated_purchase_pallets),0)
    into v_purchase_allocated_quantity,v_purchase_allocated_pallets
  from public.sales_procurement_allocations spa
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where spa.purchase_order_item_id=p_purchase_order_item_id
    and so.status<>'cancelled';

  v_sales_remaining_quantity:=greatest(v_sale.ordered_quantity-v_sales_planned_quantity,0);
  v_purchase_remaining_quantity:=greatest(v_purchase.ordered_quantity-v_purchase_allocated_quantity,0);
  v_quantity:=least(v_sales_remaining_quantity,v_purchase_remaining_quantity);
  if v_quantity<=0 and v_sales_remaining_quantity<=0 then
    raise exception 'SUPPLY_QUICK_DIRECT_NO_SALE_BALANCE';
  end if;
  if v_quantity<=0 then raise exception 'SUPPLY_QUICK_DIRECT_NO_PURCHASE_BALANCE'; end if;

  v_sales_pallets:=case
    when coalesce(v_sale.ordered_pallets,0)<=0 then 0
    when v_quantity=v_sales_remaining_quantity then greatest(v_sale.ordered_pallets-v_sales_planned_pallets,0)
    else greatest(v_sale.ordered_pallets-v_sales_planned_pallets,0)*v_quantity/v_sales_remaining_quantity
  end;
  v_purchase_pallets:=case
    when coalesce(v_purchase.ordered_pallets,0)<=0 then 0
    when v_quantity=v_purchase_remaining_quantity then greatest(v_purchase.ordered_pallets-v_purchase_allocated_pallets,0)
    else greatest(v_purchase.ordered_pallets-v_purchase_allocated_pallets,0)*v_quantity/v_purchase_remaining_quantity
  end;

  insert into public.sales_supply_plan_lines(
    sales_order_item_id,supply_method,warehouse_id,planned_quantity,planned_pallets,created_by
  ) values (
    p_sales_order_item_id,'purchase_direct',null,v_quantity,v_sales_pallets,p_actor
  ) returning * into v_plan;

  insert into public.sales_procurement_allocations(
    supply_plan_line_id,purchase_order_item_id,allocated_sales_quantity,allocated_sales_pallets,
    allocated_purchase_quantity,allocated_purchase_pallets,created_by
  ) values (
    v_plan.id,p_purchase_order_item_id,v_quantity,v_sales_pallets,v_quantity,v_purchase_pallets,p_actor
  ) returning * into v_allocation;

  return jsonb_build_object(
    'plan_id',v_plan.id,
    'procurement_allocation_id',v_allocation.id,
    'allocated_quantity',v_quantity,
    'allocated_pallets',v_sales_pallets,
    'allocated_sales_pallets',v_sales_pallets,
    'allocated_purchase_pallets',v_purchase_pallets
  );
end;
$$;

create or replace function public.assign_procurement_to_direct_shipment(
  p_sales_procurement_allocation_id uuid,
  p_shipment_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_procurement public.sales_procurement_allocations;
  v_sales_used numeric;
  v_sales_pallets_used numeric;
  v_purchase_used numeric;
  v_purchase_pallets_used numeric;
  v_direct public.direct_shipment_allocations;
begin
  select * into v_procurement
  from public.sales_procurement_allocations
  where id=p_sales_procurement_allocation_id
  for update;
  if not found then raise exception 'SUPPLY_PROCUREMENT_NOT_FOUND'; end if;

  select
    coalesce(sum(allocated_sales_quantity),0),
    coalesce(sum(allocated_sales_pallets),0),
    coalesce(sum(allocated_purchase_quantity),0),
    coalesce(sum(allocated_purchase_pallets),0)
  into v_sales_used,v_sales_pallets_used,v_purchase_used,v_purchase_pallets_used
  from public.direct_shipment_allocations
  where sales_procurement_allocation_id=p_sales_procurement_allocation_id;

  if v_procurement.allocated_sales_quantity-v_sales_used<=0
     or v_procurement.allocated_purchase_quantity-v_purchase_used<=0 then
    raise exception 'SUPPLY_QUICK_DIRECT_NO_ALLOCATION_BALANCE';
  end if;

  insert into public.direct_shipment_allocations(
    sales_procurement_allocation_id,shipment_id,
    allocated_sales_quantity,allocated_sales_pallets,
    allocated_purchase_quantity,allocated_purchase_pallets,
    notes,created_by
  ) values (
    p_sales_procurement_allocation_id,p_shipment_id,
    v_procurement.allocated_sales_quantity-v_sales_used,
    greatest(v_procurement.allocated_sales_pallets-v_sales_pallets_used,0),
    v_procurement.allocated_purchase_quantity-v_purchase_used,
    greatest(v_procurement.allocated_purchase_pallets-v_purchase_pallets_used,0),
    'Saldo asignado automaticamente.',p_actor
  ) returning * into v_direct;

  return jsonb_build_object(
    'direct_shipment_allocation_id',v_direct.id,
    'allocated_sales_quantity',v_direct.allocated_sales_quantity,
    'allocated_sales_pallets',v_direct.allocated_sales_pallets,
    'allocated_purchase_quantity',v_direct.allocated_purchase_quantity,
    'allocated_purchase_pallets',v_direct.allocated_purchase_pallets
  );
end;
$$;

revoke all on function public.create_sales_order_plan_with_nationalization(uuid,jsonb,uuid,date,timestamptz,text,text,text,uuid,text) from public,anon,authenticated;
revoke all on function public.replace_sales_order_plan_with_nationalization(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text,text) from public,anon,authenticated;
revoke all on function public.assign_sales_order_item_direct_ship(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.assign_procurement_to_direct_shipment(uuid,uuid,uuid) from public,anon,authenticated;

grant execute on function public.create_sales_order_plan_with_nationalization(uuid,jsonb,uuid,date,timestamptz,text,text,text,uuid,text) to service_role;
grant execute on function public.replace_sales_order_plan_with_nationalization(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text,text) to service_role;
grant execute on function public.assign_sales_order_item_direct_ship(uuid,uuid,uuid) to service_role;
grant execute on function public.assign_procurement_to_direct_shipment(uuid,uuid,uuid) to service_role;

comment on function public.assign_sales_order_item_direct_ship(uuid,uuid,uuid) is
  'Asigna automaticamente el saldo compatible entre una linea de venta y una compra Direct Ship confirmada.';

comment on function public.assign_procurement_to_direct_shipment(uuid,uuid,uuid) is
  'Asigna automaticamente todo el saldo pendiente de una vinculacion Direct Ship a un contenedor existente.';
