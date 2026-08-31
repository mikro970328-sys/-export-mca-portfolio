begin;

do $$
declare
  v_src record;
  v_qty numeric;
  v_state jsonb;
  v_load_id constant uuid:='18520000-0000-4000-8000-000000000001'::uuid;
  v_item_id constant uuid:='18520000-0000-4000-8000-000000000002'::uuid;
begin
  if exists(select 1 from public.loads where id=v_load_id or notes='UX5-LOAD-FIXTURE') then
    raise exception 'UX5_LOAD_FIXTURE_ALREADY_EXISTS';
  end if;
  if exists(select 1 from public.shipments where container_number='UX5-LOAD-FIXTURE-185') then
    raise exception 'UX5_LOAD_SHIPMENT_FIXTURE_ALREADY_EXISTS';
  end if;

  select * into v_src
  from public.inventory_source_balances
  where physical_quantity-reserved_quantity>0
  order by receipt_item_id
  limit 1;
  if not found then raise exception 'UX5_LOAD_AVAILABLE_WR_REQUIRED'; end if;
  v_qty:=least(1::numeric,v_src.physical_quantity-v_src.reserved_quantity);

  insert into public.loads(id,load_serial,warehouse_id,status,notes)
  overriding system value
  values(v_load_id,1852000001,v_src.warehouse_id,'draft','UX5-LOAD-FIXTURE');

  insert into public.load_items(id,load_id,product_id,planned_quantity,planned_pallets,unit,notes)
  values(v_item_id,v_load_id,v_src.product_id,v_qty,0,coalesce(nullif(btrim(v_src.product_unit),''),nullif(btrim(v_src.receipt_unit),''),'unit'),'UX5 fixture item');

  insert into public.load_allocations(load_item_id,receipt_item_id,allocated_quantity,allocated_pallets)
  values(v_item_id,v_src.receipt_item_id,v_qty,0);

  v_state:=public.load_action_state(v_load_id);
  if coalesce((v_state#>>'{actions,edit,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_DRAFT_EDIT_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,reserve,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_DRAFT_RESERVE_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,cancel,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_DRAFT_CANCEL_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,create_container,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_DRAFT_CONTAINER_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,dispatch,allowed}')::boolean,false) is true then raise exception 'UX5_LOAD_DRAFT_DISPATCH_FORBIDDEN'; end if;

  perform public.execute_load_action(v_load_id,'reserve',null);
  v_state:=public.load_action_state(v_load_id);
  if v_state->>'status'<>'reserved' then raise exception 'UX5_LOAD_RESERVED_STATUS_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,release,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_RELEASE_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,start_loading,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_START_LOADING_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,cancel,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_RESERVED_CANCEL_EXPECTED'; end if;

  perform public.execute_load_action(v_load_id,'start_loading',null);
  v_state:=public.load_action_state(v_load_id);
  if v_state->>'status'<>'loading' then raise exception 'UX5_LOAD_LOADING_STATUS_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,mark_loaded,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_MARK_LOADED_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,create_container,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_LOADING_CONTAINER_EXPECTED'; end if;

  perform public.execute_load_action(v_load_id,'mark_loaded',null);
  v_state:=public.load_action_state(v_load_id);
  if v_state->>'status'<>'loaded' then raise exception 'UX5_LOAD_LOADED_STATUS_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,dispatch,allowed}')::boolean,false) is true then raise exception 'UX5_LOAD_DISPATCH_WITHOUT_CONTAINER_FORBIDDEN'; end if;
  if v_state#>>'{actions,dispatch,reason}'<>'LOAD_HAS_NO_CONTAINER' then raise exception 'UX5_LOAD_DISPATCH_REASON_EXPECTED'; end if;

  begin
    perform public.assert_load_action(v_load_id,'dispatch');
    raise exception 'UX5_LOAD_DISPATCH_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('LOAD_HAS_NO_CONTAINER' in sqlerrm)=0 then raise; end if;
  end;

  perform public.create_load_shipment_canonical(v_load_id,'UX5-LOAD-FIXTURE-185',null,null,null,null,null,null);
  v_state:=public.load_action_state(v_load_id);
  if coalesce((v_state#>>'{actions,dispatch,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_DISPATCH_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,view_tracking,allowed}')::boolean,false) is not true then raise exception 'UX5_LOAD_TRACKING_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,create_container,allowed}')::boolean,false) is true then raise exception 'UX5_LOAD_DOUBLE_CONTAINER_FORBIDDEN'; end if;

  perform public.execute_load_action(v_load_id,'dispatch',null);
  v_state:=public.load_action_state(v_load_id);
  if v_state->>'status'<>'dispatched' then raise exception 'UX5_LOAD_DISPATCHED_STATUS_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,reserve,allowed}')::boolean,false)
     or coalesce((v_state#>>'{actions,release,allowed}')::boolean,false)
     or coalesce((v_state#>>'{actions,start_loading,allowed}')::boolean,false)
     or coalesce((v_state#>>'{actions,mark_loaded,allowed}')::boolean,false)
     or coalesce((v_state#>>'{actions,dispatch,allowed}')::boolean,false)
     or coalesce((v_state#>>'{actions,cancel,allowed}')::boolean,false)
     or coalesce((v_state#>>'{actions,assign_container,allowed}')::boolean,false)
     or coalesce((v_state#>>'{actions,unassign_container,allowed}')::boolean,false)
  then raise exception 'UX5_LOAD_FINAL_STATE_ACTION_LEAK'; end if;
end;
$$;

rollback;

select
  (select count(*) from public.loads where id='18520000-0000-4000-8000-000000000001'::uuid or notes='UX5-LOAD-FIXTURE') as load_fixture_residue,
  (select count(*) from public.load_items where id='18520000-0000-4000-8000-000000000002'::uuid or load_id='18520000-0000-4000-8000-000000000001'::uuid) as load_item_fixture_residue,
  (select count(*) from public.load_allocations la join public.load_items li on li.id=la.load_item_id where li.load_id='18520000-0000-4000-8000-000000000001'::uuid) as load_allocation_fixture_residue,
  (select count(*) from public.inventory_movements where reference_type='load' and reference_id='18520000-0000-4000-8000-000000000001'::uuid) as inventory_movement_fixture_residue,
  (select count(*) from public.shipments where container_number='UX5-LOAD-FIXTURE-185') as shipment_fixture_residue;
