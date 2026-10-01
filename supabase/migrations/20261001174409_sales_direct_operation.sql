-- A single transaction records the supplier purchase and its Direct Ship links.
-- Customer collections never create supplier payments or supplier invoices.
create table private.sales_direct_operation_requests (
  request_id uuid primary key,
  actor_id uuid not null references private.admin_actor_identities(id),
  payload jsonb not null,
  result jsonb,
  created_at timestamptz not null default now()
);
alter table private.sales_direct_operation_requests enable row level security;
revoke all on private.sales_direct_operation_requests from public,anon,authenticated,service_role;

create function private.save_sales_direct_operation(p_payload jsonb,p_actor uuid,p_request_id uuid)
returns jsonb language plpgsql security definer
set search_path=pg_catalog,public,pg_temp
as $$
declare
  v_sale public.sales_orders;
  v_po public.purchase_orders;
  v_shipment public.shipments;
  v_bill public.supplier_bills;
  v_cached private.sales_direct_operation_requests;
  v_item record;
  v_plan record;
  v_purchase_item public.purchase_order_items;
  v_lines jsonb:='[]'::jsonb;
  v_bill_lines jsonb:='[]'::jsonb;
  v_links jsonb:='[]'::jsonb;
  v_cost numeric;
  v_qty numeric;
  v_pallets numeric;
  v_unplanned numeric;
  v_plan_id uuid;
  v_link jsonb;
  v_proc record;
  v_number text:=nullif(upper(btrim(p_payload->>'container_number')),'');
  v_invoice text:=nullif(btrim(p_payload->>'supplier_invoice_number'),'');
  v_new_purchase boolean:=nullif(p_payload->>'purchase_order_id','') is null;
  v_index integer:=0;
  v_result jsonb;
begin
  if p_request_id is null or jsonb_typeof(p_payload)<>'object' then raise exception 'DIRECT_OPERATION_SALE_INVALID'; end if;
  if not public.admin_actor_has_permission(p_actor,'sales.write') or not public.admin_actor_has_permission(p_actor,'procurement.write') then raise exception 'DIRECT_OPERATION_PERMISSION'; end if;
  if v_number is not null and not public.admin_actor_has_permission(p_actor,'logistics.write') then raise exception 'DIRECT_OPERATION_LOGISTICS_PERMISSION'; end if;
  if v_invoice is not null and not public.admin_actor_has_permission(p_actor,'finance.write') then raise exception 'DIRECT_OPERATION_FINANCE_PERMISSION'; end if;
  insert into private.sales_direct_operation_requests(request_id,actor_id,payload)
    values(p_request_id,p_actor,p_payload) on conflict(request_id) do nothing;
  select * into v_cached from private.sales_direct_operation_requests where request_id=p_request_id for update;
  if v_cached.actor_id<>p_actor or v_cached.payload<>p_payload then raise exception 'DIRECT_OPERATION_RETRY_CONFLICT'; end if;
  if v_cached.result is not null then return v_cached.result; end if;

  select * into v_sale from public.sales_orders where id=(p_payload->>'sales_order_id')::uuid for update;
  if not found or v_sale.status not in ('draft','confirmed') then raise exception 'DIRECT_OPERATION_SALE_INVALID'; end if;
  if v_sale.status='draft' then select * into v_sale from public.transition_sales_order(v_sale.id,'confirm'); end if;
  perform 1 from public.sales_order_items where sales_order_id=v_sale.id order by id for update;

  if v_new_purchase then
    if not exists(select 1 from public.suppliers where id=(p_payload->>'supplier_id')::uuid and active) then raise exception 'DIRECT_OPERATION_SUPPLIER_REQUIRED'; end if;
    for v_item in select i.* from public.sales_order_items i where i.sales_order_id=v_sale.id order by i.created_at,i.id loop
      select greatest(v_item.ordered_quantity-
        coalesce((select sum(p.planned_quantity) from public.sales_supply_plan_lines p where p.sales_order_item_id=v_item.id and p.supply_method<>'purchase_direct'),0)-
        coalesce((select sum(a.allocated_sales_quantity) from public.sales_procurement_allocations a join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id join public.purchase_order_items pi on pi.id=a.purchase_order_item_id join public.purchase_orders po on po.id=pi.purchase_order_id where p.sales_order_item_id=v_item.id and p.supply_method='purchase_direct' and po.status<>'cancelled'),0),0) into v_qty;
      if v_qty<=0 then continue; end if;
      select (x->>'total')::numeric into v_cost from jsonb_array_elements(coalesce(p_payload->'lines','[]')) x where (x->>'sales_order_item_id')::uuid=v_item.id;
      if v_cost is null or v_cost<0 or v_cost<>round(v_cost,2) then raise exception 'DIRECT_OPERATION_PRICES_REQUIRED'; end if;
      v_pallets:=case when v_item.ordered_quantity>0 then v_item.ordered_pallets*v_qty/v_item.ordered_quantity else 0 end;
      v_index:=v_index+1;
      v_lines:=v_lines||jsonb_build_array(jsonb_build_object('product_id',v_item.product_id,'ordered_quantity',v_qty,'ordered_pallets',v_pallets,'units_per_pallet',v_item.units_per_pallet,'line_total',v_cost,'notes',v_sale.so_number||' · línea '||v_index));
    end loop;
    if jsonb_array_length(v_lines)=0 then raise exception 'DIRECT_OPERATION_ALREADY_PURCHASED'; end if;
    select * into v_po from public.create_purchase_order_plan((p_payload->>'supplier_id')::uuid,v_lines,null,v_sale.order_date,null,v_sale.currency,nullif(btrim(p_payload->>'supplier_reference'),''),'Direct Ship · '||v_sale.so_number,p_actor);
    perform public.transition_purchase_order(v_po.id,'issue');
    select * into v_po from public.transition_purchase_order(v_po.id,'confirm');
  else
    select * into v_po from public.purchase_orders where id=(p_payload->>'purchase_order_id')::uuid for update;
    if not found or v_po.status<>'confirmed' or v_po.warehouse_id is not null then raise exception 'DIRECT_OPERATION_PO_INVALID'; end if;
  end if;

  v_index:=0;
  for v_item in select i.*,coalesce(p.unplanned_quantity,i.ordered_quantity) as unplanned_quantity from public.sales_order_items i left join public.sales_order_supply_item_progress p on p.sales_order_item_id=i.id where i.sales_order_id=v_sale.id order by i.created_at,i.id loop
    select greatest(v_item.ordered_quantity-
      coalesce((select sum(p.planned_quantity) from public.sales_supply_plan_lines p where p.sales_order_item_id=v_item.id and p.supply_method<>'purchase_direct'),0)-
      coalesce((select sum(a.allocated_sales_quantity) from public.sales_procurement_allocations a join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id join public.purchase_order_items pi on pi.id=a.purchase_order_item_id join public.purchase_orders po on po.id=pi.purchase_order_id where p.sales_order_item_id=v_item.id and p.supply_method='purchase_direct' and po.status<>'cancelled'),0),0) into v_qty;
    if v_qty<=0 then continue; end if;
    v_index:=v_index+1;
    select * into v_purchase_item from public.purchase_order_items pi where pi.purchase_order_id=v_po.id and pi.product_id=v_item.product_id
      and (not v_new_purchase or pi.notes=v_sale.so_number||' · línea '||v_index)
      and pi.ordered_quantity-coalesce((select sum(a.allocated_purchase_quantity) from public.sales_procurement_allocations a join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id join public.sales_order_items si on si.id=p.sales_order_item_id join public.sales_orders so on so.id=si.sales_order_id where a.purchase_order_item_id=pi.id and so.status<>'cancelled'),0)>=v_qty
      order by pi.id limit 1 for update;
    if not found then raise exception 'DIRECT_OPERATION_PURCHASE_BALANCE'; end if;
    if v_purchase_item.unit<>v_item.unit then raise exception 'DIRECT_OPERATION_UNITS_MISMATCH'; end if;
    if v_item.unplanned_quantity>0 then
      v_pallets:=greatest(v_item.ordered_pallets-coalesce((select sum(planned_pallets) from public.sales_supply_plan_lines where sales_order_item_id=v_item.id),0),0);
      insert into public.sales_supply_plan_lines(sales_order_item_id,supply_method,planned_quantity,planned_pallets,created_by)
        values(v_item.id,'purchase_direct',v_item.unplanned_quantity,v_pallets,p_actor) returning id into v_plan_id;
    end if;
    for v_plan in select p.* from public.sales_supply_plan_lines p where p.sales_order_item_id=v_item.id and p.supply_method='purchase_direct'
      and p.planned_quantity>coalesce((select sum(a.allocated_sales_quantity) from public.sales_procurement_allocations a join public.purchase_order_items pi on pi.id=a.purchase_order_item_id join public.purchase_orders po on po.id=pi.purchase_order_id where a.supply_plan_line_id=p.id and po.status<>'cancelled'),0) order by p.id for update loop
      v_link:=public.assign_sales_supply_plan_direct_purchase(v_plan.id,v_purchase_item.id,p_actor);
      v_links:=v_links||jsonb_build_array(v_link);
    end loop;
  end loop;

  if v_number is not null then
    if length(v_number)>40 or v_number !~ '^[A-Z0-9][A-Z0-9 ._/-]*$' then raise exception 'DIRECT_OPERATION_CONTAINER_INVALID'; end if;
    perform pg_advisory_xact_lock(hashtextextended('direct-container:'||v_number,0));
    select * into v_shipment from public.shipments where active and upper(container_number)=v_number order by created_at desc limit 1 for update;
    if found then
      if v_shipment.client_id<>v_sale.client_id or v_shipment.importer_id is distinct from v_sale.importer_id
        or exists(select 1 from public.loads where shipment_id=v_shipment.id and status<>'cancelled')
        or exists(select 1 from public.direct_shipment_allocations da join public.sales_procurement_allocations a on a.id=da.sales_procurement_allocation_id join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id join public.sales_order_items i on i.id=p.sales_order_item_id where da.shipment_id=v_shipment.id and i.sales_order_id<>v_sale.id)
        then raise exception 'DIRECT_OPERATION_CONTAINER_CONFLICT'; end if;
    else
      insert into public.shipments(client_id,importer_id,container_number,carrier,booking_number,bol_number,departure_date,active,last_status,operational_status)
        values(v_sale.client_id,v_sale.importer_id,v_number,nullif(btrim(p_payload->>'carrier'),''),nullif(btrim(p_payload->>'booking_number'),''),nullif(btrim(p_payload->>'bol_number'),''),nullif(p_payload->>'departure_date','')::date,true,'Registrado','Registrado') returning * into v_shipment;
      insert into public.shipment_history(shipment_id,client_id,event_type,title,details,source)
        values(v_shipment.id,v_sale.client_id,'created_direct_from_sale','Contenedor Direct Ship registrado',v_sale.so_number||' · '||v_number,'sales_supply');
    end if;
    for v_proc in select a.* from public.sales_procurement_allocations a join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id join public.sales_order_items i on i.id=p.sales_order_item_id join public.purchase_order_items pi on pi.id=a.purchase_order_item_id where i.sales_order_id=v_sale.id and pi.purchase_order_id=v_po.id and p.supply_method='purchase_direct'
      and a.allocated_sales_quantity>coalesce((select sum(d.allocated_sales_quantity) from public.direct_shipment_allocations d where d.sales_procurement_allocation_id=a.id),0) order by a.id for update of a loop
      perform public.assign_procurement_to_direct_shipment(v_proc.id,v_shipment.id,p_actor);
    end loop;
    if not exists(select 1 from public.direct_shipment_allocations d join public.sales_procurement_allocations a on a.id=d.sales_procurement_allocation_id join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id join public.sales_order_items i on i.id=p.sales_order_item_id where d.shipment_id=v_shipment.id and i.sales_order_id=v_sale.id) then
      raise exception 'DIRECT_OPERATION_CONTAINER_CONFLICT';
    end if;
  end if;

  if v_invoice is not null then
    if exists(select 1 from public.supplier_bills where purchase_order_id=v_po.id and status<>'void') then raise exception 'DIRECT_OPERATION_BILL_CONFLICT'; end if;
    select jsonb_agg(jsonb_build_object('purchase_order_item_id',id,'billed_quantity',ordered_quantity,'line_total',coalesce(entered_line_total,round(ordered_quantity*unit_cost,2)))) into v_bill_lines from public.purchase_order_items where purchase_order_id=v_po.id;
    select * into v_bill from public.create_supplier_bill_plan(v_po.id,v_bill_lines,v_invoice,current_date,null,'Registrada desde '||v_sale.so_number,p_actor);
    select * into v_bill from public.transition_supplier_bill(v_bill.id,'post',p_actor);
  end if;
  v_result:=jsonb_build_object('sales_order_id',v_sale.id,'purchase_order_id',v_po.id,'po_number',v_po.po_number,'supplier_reference',v_po.supplier_reference,'shipment_id',v_shipment.id,'container_number',v_number,'supplier_bill_id',v_bill.id,'links',v_links);
  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
    select p_actor,username,'sales_direct_operation_saved','sales_order',v_sale.id,v_result from public.admin_users where id=p_actor;
  update private.sales_direct_operation_requests set result=v_result where request_id=p_request_id;
  return v_result;
end;
$$;
revoke all on function private.save_sales_direct_operation(jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function private.save_sales_direct_operation(jsonb,uuid,uuid) to service_role;
create function public.save_sales_direct_operation(p_payload jsonb,p_actor uuid,p_request_id uuid)
returns jsonb language sql security invoker set search_path=pg_catalog
as $$ select private.save_sales_direct_operation(p_payload,p_actor,p_request_id) $$;
revoke all on function public.save_sales_direct_operation(jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.save_sales_direct_operation(jsonb,uuid,uuid) to service_role;

-- Estimates remain separate from recognized dispatch COGS.
create view public.sales_order_direct_operation_summary with (security_invoker=true) as
with lines as (
  select i.id,i.sales_order_id,i.ordered_quantity,
    coalesce((select sum(p.planned_quantity) from public.sales_supply_plan_lines p where p.sales_order_item_id=i.id and p.supply_method<>'purchase_direct'),0) as non_direct_quantity
  from public.sales_order_items i
), purchases as (
  select p.sales_order_item_id,a.allocated_sales_quantity,
    (coalesce(pi.entered_line_total,pi.ordered_quantity*pi.unit_cost)*a.allocated_purchase_quantity/nullif(pi.ordered_quantity,0)) as purchase_amount,
    po.id as purchase_order_id,po.po_number,po.supplier_reference,po.currency,coalesce(s.legal_name,s.name) as supplier_name
  from public.sales_procurement_allocations a join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id
  join public.purchase_order_items pi on pi.id=a.purchase_order_item_id join public.purchase_orders po on po.id=pi.purchase_order_id
  join public.suppliers s on s.id=po.supplier_id where p.supply_method='purchase_direct' and po.status<>'cancelled'
), purchase_totals as (
  select l.sales_order_id,sum(p.allocated_sales_quantity) as purchased_quantity,round(sum(p.purchase_amount),2) as purchase_amount,
    count(distinct p.currency) as currency_count,min(p.currency) as currency
  from lines l join purchases p on p.sales_order_item_id=l.id group by l.sales_order_id
), order_purchases as (
  select distinct l.sales_order_id,p.purchase_order_id,p.po_number,p.supplier_reference,p.supplier_name from lines l join purchases p on p.sales_order_item_id=l.id
), containers as (
  select distinct i.sales_order_id,s.id as shipment_id,s.container_number
  from public.direct_shipment_allocations d join public.shipments s on s.id=d.shipment_id and s.active
  join public.sales_procurement_allocations a on a.id=d.sales_procurement_allocation_id join public.sales_supply_plan_lines p on p.id=a.supply_plan_line_id
  join public.sales_order_items i on i.id=p.sales_order_item_id
)
select l.sales_order_id,sum(l.ordered_quantity-l.non_direct_quantity) as direct_required_quantity,
  greatest(sum(l.ordered_quantity-l.non_direct_quantity)-coalesce(t.purchased_quantity,0),0) as direct_pending_purchase_quantity,
  sum(l.non_direct_quantity) as non_direct_quantity,t.purchase_amount as direct_purchase_amount,
  coalesce(t.currency_count,0) as direct_purchase_currency_count,t.currency as direct_purchase_currency,
  coalesce((select jsonb_agg(to_jsonb(p)-'sales_order_id') from order_purchases p where p.sales_order_id=l.sales_order_id),'[]'::jsonb) as purchase_orders,
  coalesce((select jsonb_agg(to_jsonb(c)-'sales_order_id') from containers c where c.sales_order_id=l.sales_order_id),'[]'::jsonb) as containers
from lines l left join purchase_totals t on t.sales_order_id=l.sales_order_id
group by l.sales_order_id,t.purchased_quantity,t.purchase_amount,t.currency_count,t.currency;
revoke all on public.sales_order_direct_operation_summary from public,anon,authenticated;
grant select on public.sales_order_direct_operation_summary to service_role;
