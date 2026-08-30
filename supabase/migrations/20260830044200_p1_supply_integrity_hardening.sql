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
begin
  select soi.ordered_quantity,soi.ordered_pallets,so.status
    into v_item
  from public.sales_order_items soi
  join public.sales_orders so on so.id=soi.sales_order_id
  where soi.id=new.sales_order_item_id;
  if not found then raise exception 'SUPPLY_SO_ITEM_NOT_FOUND'; end if;
  if v_item.status<>'confirmed' then raise exception 'SUPPLY_SO_NOT_CONFIRMED'; end if;

  if tg_op='UPDATE' and new.sales_order_item_id is distinct from old.sales_order_item_id then
    raise exception 'SUPPLY_PLAN_SALES_ITEM_IMMUTABLE';
  end if;

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
  if v_other_quantity+new.planned_quantity>v_item.ordered_quantity then raise exception 'SUPPLY_PLAN_EXCEEDS_ORDER_QUANTITY'; end if;
  if coalesce(v_item.ordered_pallets,0)>0 and v_other_pallets+new.planned_pallets>v_item.ordered_pallets then raise exception 'SUPPLY_PLAN_EXCEEDS_ORDER_PALLETS'; end if;

  if tg_op='UPDATE' then
    select exists(select 1 from public.sales_procurement_allocations where supply_plan_line_id=old.id)
      into v_has_procurement;
    if v_has_procurement and (
      new.supply_method is distinct from old.supply_method
      or new.warehouse_id is distinct from old.warehouse_id
    ) then raise exception 'SUPPLY_PLAN_CONTEXT_LOCKED_BY_PROCUREMENT'; end if;

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
    from public.direct_shipment_allocations
    where sales_procurement_allocation_id=old.id;
    if v_direct_sales_q>new.allocated_sales_quantity then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_SALES_QUANTITY'; end if;
    if new.allocated_sales_pallets>0 and v_direct_sales_p>new.allocated_sales_pallets then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_SALES_PALLETS'; end if;
    if v_direct_purchase_q>new.allocated_purchase_quantity then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_PURCHASE_QUANTITY'; end if;
    if new.allocated_purchase_pallets>0 and v_direct_purchase_p>new.allocated_purchase_pallets then raise exception 'SUPPLY_PROCUREMENT_BELOW_DIRECT_PURCHASE_PALLETS'; end if;
  end if;

  return new;
end;
$function$;
