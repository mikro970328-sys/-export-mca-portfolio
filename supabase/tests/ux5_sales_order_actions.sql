begin;

-- Deterministic IDs and identity override keep the fixture traceable without consuming a live SO number.
do $$
begin
  if exists(select 1 from public.sales_orders where id='18510000-0000-4000-8000-000000000001'::uuid or customer_reference='UX5-SALES-FIXTURE') then
    raise exception 'UX5_SALES_FIXTURE_ALREADY_EXISTS';
  end if;
  if not exists(select 1 from public.clients where active=true) then raise exception 'UX5_ACTIVE_CLIENT_REQUIRED'; end if;
  if not exists(select 1 from public.products where active=true) then raise exception 'UX5_ACTIVE_PRODUCT_REQUIRED'; end if;
end;
$$;

insert into public.sales_orders(id,so_serial,client_id,importer_id,currency,status,customer_reference,notes)
overriding system value
select '18510000-0000-4000-8000-000000000001'::uuid,1851000001,c.id,null,'USD','draft','UX5-SALES-FIXTURE','UX5 reversible canonical action fixture'
from (select id from public.clients where active=true order by id limit 1) c;

insert into public.sales_order_items(id,sales_order_id,product_id,ordered_quantity,ordered_pallets,unit,units_per_pallet,unit_price,notes)
select '18510000-0000-4000-8000-000000000002'::uuid,'18510000-0000-4000-8000-000000000001'::uuid,p.id,10,0,coalesce(nullif(btrim(p.unit),''),'unidades'),p.default_units_per_pallet,2.5,'UX5 fixture line'
from (select id,unit,default_units_per_pallet from public.products where active=true order by id limit 1) p;

do $$
declare s jsonb;
begin
  s:=public.sales_order_action_state('18510000-0000-4000-8000-000000000001'::uuid);
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is not true then raise exception 'UX5_SALES_DRAFT_EDIT_EXPECTED'; end if;
  if coalesce((s#>>'{actions,confirm,allowed}')::boolean,false) is not true then raise exception 'UX5_SALES_DRAFT_CONFIRM_EXPECTED'; end if;
  if coalesce((s#>>'{actions,cancel,allowed}')::boolean,false) is not true then raise exception 'UX5_SALES_DRAFT_CANCEL_EXPECTED'; end if;
  if coalesce((s#>>'{actions,allocate_load,allowed}')::boolean,false) is true then raise exception 'UX5_SALES_DRAFT_ALLOCATE_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,close,allowed}')::boolean,false) is true then raise exception 'UX5_SALES_DRAFT_CLOSE_FORBIDDEN'; end if;
end;
$$;

select public.transition_sales_order('18510000-0000-4000-8000-000000000001'::uuid,'confirm');

do $$
declare s jsonb;
begin
  s:=public.sales_order_action_state('18510000-0000-4000-8000-000000000001'::uuid);
  if s->>'commercial_status'<>'confirmed' then raise exception 'UX5_SALES_CONFIRMED_STATUS_EXPECTED'; end if;
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is true then raise exception 'UX5_SALES_CONFIRMED_EDIT_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,confirm,allowed}')::boolean,false) is true then raise exception 'UX5_SALES_DOUBLE_CONFIRM_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,allocate_load,allowed}')::boolean,false) is not true then raise exception 'UX5_SALES_ALLOCATE_EXPECTED'; end if;
  if coalesce((s#>>'{actions,close,allowed}')::boolean,false) is true then raise exception 'UX5_SALES_CLOSE_BEFORE_DISPATCH_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,cancel,allowed}')::boolean,false) is not true then raise exception 'UX5_SALES_CANCEL_EXPECTED'; end if;

  begin
    perform public.assert_sales_order_action('18510000-0000-4000-8000-000000000001'::uuid,'edit');
    raise exception 'UX5_SALES_EDIT_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('SO_NOT_DRAFT' in sqlerrm)=0 then raise; end if;
  end;

  begin
    perform public.assert_sales_order_action('18510000-0000-4000-8000-000000000001'::uuid,'close');
    raise exception 'UX5_SALES_CLOSE_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('SO_NOT_FULLY_DISPATCHED' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

do $$
declare v_client uuid; v_product uuid; v_unit text; v_upp numeric;
begin
  select client_id into v_client from public.sales_orders where id='18510000-0000-4000-8000-000000000001'::uuid;
  select product_id,unit,units_per_pallet into v_product,v_unit,v_upp from public.sales_order_items where id='18510000-0000-4000-8000-000000000002'::uuid;
  begin
    perform public.replace_sales_order_plan(
      '18510000-0000-4000-8000-000000000001'::uuid,
      v_client,
      jsonb_build_array(jsonb_build_object('product_id',v_product,'ordered_quantity','10','ordered_pallets','0','units_per_pallet',v_upp,'unit_price','2.5')),
      null,current_date,null,'USD','UX5-SALES-FIXTURE','must remain blocked after confirmation'
    );
    raise exception 'UX5_SALES_REPLACE_DID_NOT_BLOCK';
  exception when others then
    if position('SO_NOT_DRAFT' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

select public.transition_sales_order('18510000-0000-4000-8000-000000000001'::uuid,'cancel');

do $$
declare s jsonb;
begin
  s:=public.sales_order_action_state('18510000-0000-4000-8000-000000000001'::uuid);
  if s->>'commercial_status'<>'cancelled' then raise exception 'UX5_SALES_CANCELLED_STATUS_EXPECTED'; end if;
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) or coalesce((s#>>'{actions,confirm,allowed}')::boolean,false) or coalesce((s#>>'{actions,allocate_load,allowed}')::boolean,false) or coalesce((s#>>'{actions,close,allowed}')::boolean,false) or coalesce((s#>>'{actions,cancel,allowed}')::boolean,false) then
    raise exception 'UX5_SALES_FINAL_STATE_ACTION_LEAK';
  end if;
end;
$$;

rollback;

select
  (select count(*) from public.sales_orders where id='18510000-0000-4000-8000-000000000001'::uuid or customer_reference='UX5-SALES-FIXTURE') as sales_order_fixture_residue,
  (select count(*) from public.sales_order_items where id='18510000-0000-4000-8000-000000000002'::uuid or sales_order_id='18510000-0000-4000-8000-000000000001'::uuid) as sales_item_fixture_residue,
  (select count(*) from public.sales_fulfillment_allocations where sales_order_item_id='18510000-0000-4000-8000-000000000002'::uuid) as fulfillment_fixture_residue,
  (select count(*) from public.sales_supply_plan_lines where sales_order_item_id='18510000-0000-4000-8000-000000000002'::uuid) as supply_plan_fixture_residue,
  (select count(*) from public.operational_tasks where entity_type='sales_order' and entity_id='18510000-0000-4000-8000-000000000001'::uuid) as workflow_task_fixture_residue;