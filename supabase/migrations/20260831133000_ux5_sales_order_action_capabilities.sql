-- UX-5 · Sales Orders: one canonical owner for lifecycle and fulfillment actions.
-- Mirrors current Sales Order guards/read-models; UI/API consume this contract.

create or replace function public.sales_order_action_state(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_so public.sales_orders;
  v_item_count integer := 0;
  v_fulfillment_status text := 'pending';
  v_client_active boolean := false;
  v_importer_active boolean := true;
  v_client_importer_valid boolean := true;
  v_has_unallocated boolean := false;
  v_has_active_load_allocations boolean := false;
  v_has_supply_plan boolean := false;
  v_has_direct_shipment_allocations boolean := false;
  v_has_active_customer_advance boolean := false;
  v_edit_allowed boolean;
  v_confirm_allowed boolean;
  v_allocate_load_allowed boolean;
  v_close_allowed boolean;
  v_cancel_allowed boolean;
  v_confirm_reason text;
  v_cancel_reason text;
begin
  select * into v_so
  from public.sales_orders
  where id=p_sales_order_id;
  if not found then raise exception 'SO_NOT_FOUND'; end if;

  select coalesce(p.item_count,0),coalesce(p.fulfillment_status,'pending')
    into v_item_count,v_fulfillment_status
  from public.sales_order_progress p
  where p.sales_order_id=v_so.id;

  select coalesce(c.active,false) into v_client_active
  from public.clients c where c.id=v_so.client_id;

  if v_so.importer_id is not null then
    select coalesce(i.active,false) into v_importer_active
    from public.importers i where i.id=v_so.importer_id;
    select exists(
      select 1 from public.client_importers ci
      where ci.client_id=v_so.client_id and ci.importer_id=v_so.importer_id
    ) into v_client_importer_valid;
  end if;

  select exists(
    select 1 from public.sales_order_item_progress sip
    where sip.sales_order_id=v_so.id
      and (coalesce(sip.unallocated_quantity,0)>0 or coalesce(sip.unallocated_pallets,0)>0)
  ) into v_has_unallocated;

  select exists(
    select 1
    from public.sales_order_items soi
    join public.sales_fulfillment_allocations sfa on sfa.sales_order_item_id=soi.id
    join public.load_items li on li.id=sfa.load_item_id
    join public.loads l on l.id=li.load_id
    where soi.sales_order_id=v_so.id and l.status<>'cancelled'
  ) into v_has_active_load_allocations;

  select exists(
    select 1
    from public.sales_supply_plan_lines spl
    join public.sales_order_items soi on soi.id=spl.sales_order_item_id
    where soi.sales_order_id=v_so.id
  ) into v_has_supply_plan;

  select exists(
    select 1
    from public.sales_order_items soi
    join public.sales_supply_plan_lines spl on spl.sales_order_item_id=soi.id
    join public.sales_procurement_allocations spa on spa.supply_plan_line_id=spl.id
    join public.direct_shipment_allocations dsa on dsa.sales_procurement_allocation_id=spa.id
    where soi.sales_order_id=v_so.id
  ) into v_has_direct_shipment_allocations;

  select exists(
    select 1 from public.customer_advance_progress cap
    where cap.sales_order_id=v_so.id
      and cap.status='posted'
      and (cap.applied_amount>0 or cap.available_amount>0)
  ) into v_has_active_customer_advance;

  v_edit_allowed := v_so.status='draft';
  v_confirm_reason := case
    when v_so.status<>'draft' then 'SO_NOT_DRAFT'
    when v_item_count=0 then 'SO_HAS_NO_ITEMS'
    when v_client_active is not true then 'SO_CLIENT_INACTIVE'
    when v_importer_active is not true then 'SO_IMPORTER_INACTIVE'
    when v_client_importer_valid is not true then 'SO_CLIENT_IMPORTER_MISMATCH'
    else null
  end;
  v_confirm_allowed := v_confirm_reason is null;
  v_allocate_load_allowed := v_so.status='confirmed' and v_has_unallocated;
  v_close_allowed := v_so.status='confirmed' and v_item_count>0 and v_fulfillment_status='dispatched';

  v_cancel_reason := case
    when v_so.status not in ('draft','confirmed') then 'SO_CANNOT_CANCEL'
    when v_has_active_customer_advance then 'SO_HAS_ACTIVE_CUSTOMER_ADVANCE'
    when v_has_active_load_allocations then 'SO_HAS_ACTIVE_LOAD_ALLOCATIONS'
    when v_has_supply_plan then 'SO_HAS_ACTIVE_SUPPLY_PLAN'
    when v_has_direct_shipment_allocations then 'SO_HAS_DIRECT_SHIPMENT_ALLOCATIONS'
    else null
  end;
  v_cancel_allowed := v_cancel_reason is null;

  return jsonb_build_object(
    'commercial_status',v_so.status,
    'fulfillment_status',v_fulfillment_status,
    'item_count',v_item_count,
    'has_unallocated',v_has_unallocated,
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'SO_NOT_DRAFT' end),
      'confirm',jsonb_build_object('allowed',v_confirm_allowed,'reason',v_confirm_reason),
      'allocate_load',jsonb_build_object('allowed',v_allocate_load_allowed,'reason',case when v_allocate_load_allowed then null when v_so.status<>'confirmed' then 'SO_NOT_CONFIRMED' else 'SO_NO_UNALLOCATED_FULFILLMENT' end),
      'close',jsonb_build_object('allowed',v_close_allowed,'reason',case when v_close_allowed then null when v_so.status<>'confirmed' then 'SO_CANNOT_CLOSE' else 'SO_NOT_FULLY_DISPATCHED' end),
      'cancel',jsonb_build_object('allowed',v_cancel_allowed,'reason',v_cancel_reason)
    )
  );
end;
$$;

revoke all on function public.sales_order_action_state(uuid) from public,anon,authenticated;
grant execute on function public.sales_order_action_state(uuid) to service_role;

create or replace function public.assert_sales_order_action(p_sales_order_id uuid,p_action text)
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
  if v_action not in ('edit','confirm','allocate_load','close','cancel') then
    raise exception 'SO_ACTION_INVALID';
  end if;
  v_state:=public.sales_order_action_state(p_sales_order_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'SO_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

revoke all on function public.assert_sales_order_action(uuid,text) from public,anon,authenticated;
grant execute on function public.assert_sales_order_action(uuid,text) to service_role;

create or replace view public.sales_order_action_capabilities
with (security_invoker=true)
as
select so.id as sales_order_id,public.sales_order_action_state(so.id) as capabilities
from public.sales_orders so;

revoke all on public.sales_order_action_capabilities from public,anon,authenticated;
grant select on public.sales_order_action_capabilities to service_role;

create or replace function public.transition_sales_order(p_sales_order_id uuid,p_action text)
returns public.sales_orders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_so public.sales_orders;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_target text;
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  perform public.assert_sales_order_action(v_so.id,v_action);
  v_target:=case v_action when 'confirm' then 'confirmed' when 'cancel' then 'cancelled' when 'close' then 'closed' else null end;
  if v_target is null then raise exception 'SO_ACTION_INVALID'; end if;
  update public.sales_orders set status=v_target where id=v_so.id;
  select * into v_so from public.sales_orders where id=v_so.id;
  return v_so;
end;
$$;

revoke all on function public.transition_sales_order(uuid,text) from public,anon,authenticated;
grant execute on function public.transition_sales_order(uuid,text) to service_role;

create or replace function public.replace_sales_order_plan(
  p_sales_order_id uuid,p_client_id uuid,p_lines jsonb,p_importer_id uuid default null,
  p_order_date date default current_date,p_requested_at timestamptz default null,
  p_currency text default 'USD',p_customer_reference text default null,p_notes text default null
)
returns public.sales_orders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_so public.sales_orders;
  v_currency text:=upper(btrim(coalesce(p_currency,'USD')));
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  perform public.assert_sales_order_action(v_so.id,'edit');
  if p_client_id is null then raise exception 'SO_CLIENT_REQUIRED'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'SO_CURRENCY_INVALID'; end if;
  delete from public.sales_order_items where sales_order_id=p_sales_order_id;
  update public.sales_orders
  set client_id=p_client_id,importer_id=p_importer_id,order_date=coalesce(p_order_date,current_date),requested_at=p_requested_at,
      currency=v_currency,customer_reference=nullif(btrim(p_customer_reference),''),notes=nullif(btrim(p_notes),'')
  where id=p_sales_order_id;
  perform public.populate_sales_order_items(p_sales_order_id,p_lines);
  select * into v_so from public.sales_orders where id=p_sales_order_id;
  return v_so;
end;
$$;

revoke all on function public.replace_sales_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.replace_sales_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) to service_role;

create or replace function public.create_load_from_sales_order(
  p_sales_order_id uuid,p_warehouse_id uuid,p_lines jsonb,p_scheduled_at timestamptz default null,p_notes text default null,p_actor uuid default null
)
returns public.loads
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_so public.sales_orders; v_load public.loads; v_line jsonb; v_so_item record; v_load_item_id uuid; v_load_item public.load_items;
begin
  if p_sales_order_id is null then raise exception 'SO_REQUIRED'; end if;
  if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
  if p_lines is null or jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;
  if jsonb_array_length(p_lines)>500 then raise exception 'SO_LOAD_PLAN_TOO_LARGE'; end if;
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  perform public.assert_sales_order_action(v_so.id,'allocate_load');
  if exists(select 1 from jsonb_array_elements(p_lines) line where jsonb_typeof(line)<>'object' or nullif(btrim(line->>'sales_order_item_id'),'') is null or jsonb_typeof(line->'allocations')<>'array' or jsonb_array_length(line->'allocations')=0) then raise exception 'SO_LOAD_PLAN_ENTRY_INVALID'; end if;
  if exists(select 1 from (select line->>'sales_order_item_id' as sales_order_item_id,count(*) as n from jsonb_array_elements(p_lines) line group by 1 having count(*)>1) d) then raise exception 'SO_LOAD_DUPLICATE_SALES_ITEM'; end if;
  perform soi.id from public.sales_order_items soi where soi.sales_order_id=p_sales_order_id and soi.id in (select distinct (line->>'sales_order_item_id')::uuid from jsonb_array_elements(p_lines) line) order by soi.id for update;
  if (select count(*) from public.sales_order_items soi where soi.sales_order_id=p_sales_order_id and soi.id in (select distinct (line->>'sales_order_item_id')::uuid from jsonb_array_elements(p_lines) line))<>jsonb_array_length(p_lines) then raise exception 'SO_ITEM_NOT_IN_ORDER'; end if;
  insert into public.loads(warehouse_id,client_id,importer_id,scheduled_at,notes,created_by)
  values(p_warehouse_id,v_so.client_id,v_so.importer_id,p_scheduled_at,nullif(btrim(p_notes),''),p_actor) returning * into v_load;
  for v_line in select value from jsonb_array_elements(p_lines) loop
    select soi.id,soi.product_id,soi.ordered_pallets into v_so_item from public.sales_order_items soi where soi.id=(v_line->>'sales_order_item_id')::uuid and soi.sales_order_id=p_sales_order_id;
    if not found then raise exception 'SO_ITEM_NOT_IN_ORDER'; end if;
    v_load_item_id:=public.insert_load_item_with_allocations(v_load.id,v_so_item.product_id,v_line->'allocations',v_line->>'notes');
    select * into v_load_item from public.load_items where id=v_load_item_id;
    insert into public.sales_fulfillment_allocations(sales_order_item_id,load_item_id,allocated_quantity,allocated_pallets,created_by)
    values(v_so_item.id,v_load_item.id,v_load_item.planned_quantity,case when coalesce(v_so_item.ordered_pallets,0)>0 then v_load_item.planned_pallets else 0 end,p_actor);
  end loop;
  select * into v_load from public.loads where id=v_load.id;
  return v_load;
end;
$$;

revoke all on function public.create_load_from_sales_order(uuid,uuid,jsonb,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.create_load_from_sales_order(uuid,uuid,jsonb,timestamptz,text,uuid) to service_role;

create or replace function public.link_existing_load_to_sales_order(p_sales_order_id uuid,p_load_id uuid,p_actor uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_so record; v_load record; v_item record; v_match_count integer; v_sales_order_item_id uuid; v_inserted integer:=0;
begin
  select id,so_number,client_id,importer_id,status into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  perform public.assert_sales_order_action(v_so.id,'allocate_load');
  select l.id,l.load_number,l.status,l.client_id,l.importer_id,l.shipment_id,s.client_id as shipment_client_id,s.importer_id as shipment_importer_id
    into v_load from public.loads l left join public.shipments s on s.id=l.shipment_id where l.id=p_load_id for update of l;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.status not in ('draft','reserved','loading','loaded','dispatched') then raise exception 'SO_LOAD_REPAIR_STATUS_INVALID'; end if;
  if exists(select 1 from public.load_items li join public.sales_fulfillment_allocations sfa on sfa.load_item_id=li.id where li.load_id=p_load_id) then raise exception 'LOAD_ALREADY_LINKED_TO_SALE'; end if;
  if v_load.client_id is not null and v_load.client_id<>v_so.client_id then raise exception 'LOAD_SALES_CONTEXT_MISMATCH'; end if;
  if v_load.importer_id is not null and v_load.importer_id is distinct from v_so.importer_id then raise exception 'LOAD_SALES_CONTEXT_MISMATCH'; end if;
  if v_load.shipment_client_id is not null and v_load.shipment_client_id<>v_so.client_id then raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH'; end if;
  if v_load.shipment_importer_id is not null and v_load.shipment_importer_id is distinct from v_so.importer_id then raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH'; end if;
  if v_load.shipment_id is not null then update public.shipments set client_id=coalesce(client_id,v_so.client_id),importer_id=coalesce(importer_id,v_so.importer_id) where id=v_load.shipment_id; end if;
  update public.loads set client_id=v_so.client_id,importer_id=v_so.importer_id where id=p_load_id;
  perform set_config('app.sales_load_repair','on',true);
  for v_item in select li.id,li.product_id,li.unit,li.planned_quantity,li.planned_pallets from public.load_items li where li.load_id=p_load_id order by li.created_at,li.id loop
    select count(*),(array_agg(soi.id order by soi.created_at,soi.id))[1]
      into v_match_count,v_sales_order_item_id
    from public.sales_order_items soi join public.sales_order_item_progress sip on sip.sales_order_item_id=soi.id
    where soi.sales_order_id=p_sales_order_id and soi.product_id=v_item.product_id and btrim(soi.unit)=btrim(v_item.unit)
      and sip.unallocated_quantity=v_item.planned_quantity and coalesce(sip.unallocated_pallets,0)=coalesce(v_item.planned_pallets,0);
    if v_match_count=0 then raise exception 'NO_EXACT_SALES_LINE_MATCH'; end if;
    if v_match_count>1 then raise exception 'AMBIGUOUS_SALES_LINE_MATCH'; end if;
    insert into public.sales_fulfillment_allocations(sales_order_item_id,load_item_id,allocated_quantity,allocated_pallets,created_by)
    values(v_sales_order_item_id,v_item.id,v_item.planned_quantity,coalesce(v_item.planned_pallets,0),p_actor);
    v_inserted:=v_inserted+1;
  end loop;
  if v_inserted=0 then raise exception 'LOAD_HAS_NO_ITEMS'; end if;
  return jsonb_build_object('sales_order_id',p_sales_order_id,'so_number',v_so.so_number,'load_id',p_load_id,'load_number',v_load.load_number,'allocation_count',v_inserted);
end;
$$;

revoke all on function public.link_existing_load_to_sales_order(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.link_existing_load_to_sales_order(uuid,uuid,uuid) to service_role;

create or replace function public.sales_order_linkable_existing_loads(p_sales_order_id uuid)
returns table(load_id uuid,load_number text,load_status text,shipment_id uuid,container_number text,warehouse_id uuid,warehouse_name text,item_summary text)
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_so record; v_state jsonb;
begin
  select id,client_id,importer_id,status into v_so from public.sales_orders where id=p_sales_order_id;
  if not found then return; end if;
  v_state:=public.sales_order_action_state(v_so.id);
  if coalesce((v_state#>>'{actions,allocate_load,allowed}')::boolean,false) is not true then return; end if;
  return query
  select l.id,l.load_number,l.status,l.shipment_id,s.container_number,l.warehouse_id,w.name,
         string_agg(coalesce(p.sku||' · ','')||p.name||' · '||trim(to_char(li.planned_quantity,'FM999999999999990.###'))||' '||li.unit,' | ' order by li.created_at)
  from public.loads l
  join public.load_items li on li.load_id=l.id
  join public.products p on p.id=li.product_id
  left join public.shipments s on s.id=l.shipment_id
  left join public.warehouses w on w.id=l.warehouse_id
  where l.status in ('draft','reserved','loading','loaded','dispatched')
    and not exists(select 1 from public.load_items lix join public.sales_fulfillment_allocations sfa on sfa.load_item_id=lix.id where lix.load_id=l.id)
    and (l.client_id is null or l.client_id=v_so.client_id)
    and (l.importer_id is null or l.importer_id is not distinct from v_so.importer_id)
    and (s.id is null or s.client_id is null or s.client_id=v_so.client_id)
    and (s.id is null or s.importer_id is null or s.importer_id is not distinct from v_so.importer_id)
    and not exists(
      select 1 from public.load_items lix where lix.load_id=l.id and (
        select count(*) from public.sales_order_items soi join public.sales_order_item_progress sip on sip.sales_order_item_id=soi.id
        where soi.sales_order_id=p_sales_order_id and soi.product_id=lix.product_id and btrim(soi.unit)=btrim(lix.unit)
          and sip.unallocated_quantity=lix.planned_quantity and coalesce(sip.unallocated_pallets,0)=coalesce(lix.planned_pallets,0)
      )<>1
    )
  group by l.id,l.load_number,l.status,l.shipment_id,s.container_number,l.warehouse_id,w.name
  order by l.created_at desc;
end;
$$;

revoke all on function public.sales_order_linkable_existing_loads(uuid) from public,anon,authenticated;
grant execute on function public.sales_order_linkable_existing_loads(uuid) to service_role;
