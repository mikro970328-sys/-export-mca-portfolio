-- Direct Ship: vincular compras completas sin pedir cantidades repetidas.

create or replace function public.assign_sales_supply_plan_direct_purchase(
  p_supply_plan_line_id uuid,
  p_purchase_order_item_id uuid,
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_plan record;
  v_purchase record;
  v_plan_allocated_quantity numeric;
  v_plan_allocated_pallets numeric;
  v_purchase_allocated_quantity numeric;
  v_purchase_allocated_pallets numeric;
  v_plan_remaining_quantity numeric;
  v_purchase_remaining_quantity numeric;
  v_quantity numeric;
  v_sales_pallets numeric;
  v_purchase_pallets numeric;
  v_allocation public.sales_procurement_allocations;
begin
  select spl.id,spl.supply_method,spl.planned_quantity,spl.planned_pallets,
         soi.product_id,so.status as sales_status
    into v_plan
  from public.sales_supply_plan_lines spl
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where spl.id=p_supply_plan_line_id
  for update of spl,soi,so;
  if not found then raise exception 'SUPPLY_PLAN_NOT_FOUND'; end if;
  if v_plan.supply_method<>'purchase_direct' then raise exception 'SUPPLY_PLAN_NOT_DIRECT'; end if;
  if v_plan.sales_status<>'confirmed' then raise exception 'SUPPLY_SO_NOT_CONFIRMED'; end if;

  select poi.id,poi.product_id,poi.ordered_quantity,poi.ordered_pallets,
         po.status,po.warehouse_id
    into v_purchase
  from public.purchase_order_items poi
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where poi.id=p_purchase_order_item_id
  for update of poi,po;
  if not found then raise exception 'SUPPLY_PO_ITEM_NOT_FOUND'; end if;
  if v_purchase.status<>'confirmed' then raise exception 'SUPPLY_QUICK_DIRECT_PO_NOT_CONFIRMED'; end if;
  if v_purchase.warehouse_id is not null then raise exception 'SUPPLY_DIRECT_PO_HAS_WAREHOUSE'; end if;
  if v_purchase.product_id<>v_plan.product_id then raise exception 'SUPPLY_PRODUCT_MISMATCH'; end if;

  select coalesce(sum(spa.allocated_sales_quantity),0),
         coalesce(sum(spa.allocated_sales_pallets),0)
    into v_plan_allocated_quantity,v_plan_allocated_pallets
  from public.sales_procurement_allocations spa
  join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where spa.supply_plan_line_id=p_supply_plan_line_id
    and po.status<>'cancelled';

  select coalesce(sum(spa.allocated_purchase_quantity),0),
         coalesce(sum(spa.allocated_purchase_pallets),0)
    into v_purchase_allocated_quantity,v_purchase_allocated_pallets
  from public.sales_procurement_allocations spa
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  join public.sales_orders so on so.id=soi.sales_order_id
  where spa.purchase_order_item_id=p_purchase_order_item_id
    and so.status<>'cancelled';

  v_plan_remaining_quantity:=greatest(v_plan.planned_quantity-v_plan_allocated_quantity,0);
  v_purchase_remaining_quantity:=greatest(v_purchase.ordered_quantity-v_purchase_allocated_quantity,0);
  v_quantity:=least(v_plan_remaining_quantity,v_purchase_remaining_quantity);
  if v_quantity<=0 and v_plan_remaining_quantity<=0 then
    raise exception 'SUPPLY_QUICK_DIRECT_NO_SALE_BALANCE';
  end if;
  if v_quantity<=0 then raise exception 'SUPPLY_QUICK_DIRECT_NO_PURCHASE_BALANCE'; end if;

  v_sales_pallets:=case
    when coalesce(v_plan.planned_pallets,0)<=0 then 0
    when v_quantity=v_plan_remaining_quantity then greatest(v_plan.planned_pallets-v_plan_allocated_pallets,0)
    else greatest(v_plan.planned_pallets-v_plan_allocated_pallets,0)*v_quantity/v_plan_remaining_quantity
  end;
  v_purchase_pallets:=case
    when coalesce(v_purchase.ordered_pallets,0)<=0 then 0
    when v_quantity=v_purchase_remaining_quantity then greatest(v_purchase.ordered_pallets-v_purchase_allocated_pallets,0)
    else greatest(v_purchase.ordered_pallets-v_purchase_allocated_pallets,0)*v_quantity/v_purchase_remaining_quantity
  end;

  insert into public.sales_procurement_allocations(
    supply_plan_line_id,purchase_order_item_id,allocated_sales_quantity,allocated_sales_pallets,
    allocated_purchase_quantity,allocated_purchase_pallets,notes,created_by
  ) values (
    p_supply_plan_line_id,p_purchase_order_item_id,v_quantity,v_sales_pallets,
    v_quantity,v_purchase_pallets,'Saldo Direct Ship asignado automaticamente.',p_actor
  ) returning * into v_allocation;

  return jsonb_build_object(
    'plan_id',p_supply_plan_line_id,
    'procurement_allocation_id',v_allocation.id,
    'allocated_quantity',v_quantity,
    'allocated_sales_pallets',v_sales_pallets,
    'allocated_purchase_pallets',v_purchase_pallets
  );
end;
$$;

create or replace function public.create_direct_sale_from_purchase_order(
  p_purchase_order_id uuid,
  p_client_id uuid,
  p_line_totals jsonb,
  p_importer_id uuid default null,
  p_currency text default null,
  p_customer_reference text default null,
  p_nationalization_status text default 'not_nationalized',
  p_actor uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_po public.purchase_orders;
  v_sale public.sales_orders;
  v_sale_item public.sales_order_items;
  v_purchase_item record;
  v_link jsonb;
  v_links jsonb:='[]'::jsonb;
  v_currency text;
  v_status text:=nullif(btrim(coalesce(p_nationalization_status,'')),'');
  v_line_total numeric;
  v_match_count integer;
  v_item_count integer;
begin
  if p_client_id is null then raise exception 'SO_CLIENT_REQUIRED'; end if;
  if jsonb_typeof(p_line_totals)<>'array' then raise exception 'DIRECT_SALE_PRICES_INVALID'; end if;
  if v_status is null or v_status not in ('nationalized','not_nationalized') then
    raise exception 'SO_NATIONALIZATION_STATUS_INVALID';
  end if;

  select * into v_po
  from public.purchase_orders
  where id=p_purchase_order_id
  for update;
  if not found then raise exception 'DIRECT_SALE_PO_NOT_FOUND'; end if;
  if v_po.status<>'confirmed' then raise exception 'DIRECT_SALE_PO_NOT_CONFIRMED'; end if;
  if v_po.warehouse_id is not null then raise exception 'DIRECT_SALE_PO_NOT_DIRECT'; end if;

  select count(*) into v_item_count
  from public.purchase_order_items
  where purchase_order_id=v_po.id;
  if v_item_count=0 then raise exception 'DIRECT_SALE_PO_EMPTY'; end if;
  if jsonb_array_length(p_line_totals)<>v_item_count then raise exception 'DIRECT_SALE_PRICES_INCOMPLETE'; end if;

  if exists (
    select 1
    from public.purchase_order_items poi
    join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id
    join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
    join public.sales_order_items soi on soi.id=spl.sales_order_item_id
    join public.sales_orders so on so.id=soi.sales_order_id
    where poi.purchase_order_id=v_po.id
      and so.status<>'cancelled'
  ) then raise exception 'DIRECT_SALE_PO_ALREADY_LINKED'; end if;

  v_currency:=upper(btrim(coalesce(nullif(p_currency,''),v_po.currency,'USD')));
  if v_currency!~'^[A-Z]{3}$' then raise exception 'SO_CURRENCY_INVALID'; end if;

  insert into public.sales_orders(
    client_id,importer_id,order_date,requested_at,currency,customer_reference,
    nationalization_status,notes,created_by
  ) values (
    p_client_id,p_importer_id,current_date,v_po.expected_at,v_currency,
    nullif(btrim(p_customer_reference),''),v_status,
    'Direct Ship creado desde '||v_po.po_number,p_actor
  ) returning * into v_sale;

  for v_purchase_item in
    select poi.*,p.active as product_active,p.unit as product_unit
    from public.purchase_order_items poi
    join public.products p on p.id=poi.product_id
    where poi.purchase_order_id=v_po.id
    order by poi.created_at,poi.id
  loop
    if v_purchase_item.product_active is not true then raise exception 'SO_PRODUCT_INACTIVE'; end if;
    select count(*),max(nullif(btrim(entry->>'line_total'),'')::numeric)
      into v_match_count,v_line_total
    from jsonb_array_elements(p_line_totals) entry
    where entry->>'purchase_order_item_id'=v_purchase_item.id::text;
    if v_match_count<>1 or v_line_total is null then raise exception 'DIRECT_SALE_PRICES_INCOMPLETE'; end if;
    if v_line_total<0 then raise exception 'SO_LINE_TOTAL_INVALID'; end if;

    insert into public.sales_order_items(
      sales_order_id,product_id,ordered_quantity,ordered_pallets,unit,
      units_per_pallet,unit_price,entered_line_total,notes
    ) values (
      v_sale.id,v_purchase_item.product_id,v_purchase_item.ordered_quantity,
      v_purchase_item.ordered_pallets,v_purchase_item.product_unit,
      v_purchase_item.units_per_pallet,v_line_total/v_purchase_item.ordered_quantity,
      v_line_total,'Mercancia vinculada desde '||v_po.po_number
    ) returning * into v_sale_item;

    v_links:=v_links||jsonb_build_array(jsonb_build_object(
      'purchase_order_item_id',v_purchase_item.id,
      'sales_order_item_id',v_sale_item.id
    ));
  end loop;

  perform public.transition_sales_order(v_sale.id,'confirm');
  for v_link in select value from jsonb_array_elements(v_links)
  loop
    perform public.assign_sales_order_item_direct_ship(
      (v_link->>'sales_order_item_id')::uuid,
      (v_link->>'purchase_order_item_id')::uuid,
      p_actor
    );
  end loop;

  select * into v_sale from public.sales_orders where id=v_sale.id;
  return jsonb_build_object(
    'sales_order_id',v_sale.id,
    'so_number',v_sale.so_number,
    'status',v_sale.status,
    'linked_lines',v_item_count
  );
end;
$$;

revoke all on function public.assign_sales_supply_plan_direct_purchase(uuid,uuid,uuid) from public,anon,authenticated;
revoke all on function public.create_direct_sale_from_purchase_order(uuid,uuid,jsonb,uuid,text,text,text,uuid) from public,anon,authenticated;

grant execute on function public.assign_sales_supply_plan_direct_purchase(uuid,uuid,uuid) to service_role;
grant execute on function public.create_direct_sale_from_purchase_order(uuid,uuid,jsonb,uuid,text,text,text,uuid) to service_role;

comment on function public.assign_sales_supply_plan_direct_purchase(uuid,uuid,uuid) is
  'Vincula automaticamente el saldo de una ruta Direct Ship existente con una compra confirmada.';
comment on function public.create_direct_sale_from_purchase_order(uuid,uuid,jsonb,uuid,text,text,text,uuid) is
  'Crea, confirma y vincula una venta Direct Ship completa desde una PO confirmada sin repetir cantidades.';
