begin;

do $$
declare
  v_shipment_id constant uuid:='18530000-0000-4000-8000-000000000001'::uuid;
  v_load_id constant uuid:='18530000-0000-4000-8000-000000000002'::uuid;
  v_warehouse_id uuid;
  v_state jsonb;
begin
  if exists(select 1 from public.shipments where id=v_shipment_id or container_number='UX5CONTAINER185') then raise exception 'UX5_SHIPMENT_FIXTURE_ALREADY_EXISTS'; end if;
  if exists(select 1 from public.loads where id=v_load_id or notes='UX5-CONTAINER-FIXTURE') then raise exception 'UX5_SHIPMENT_LOAD_FIXTURE_ALREADY_EXISTS'; end if;

  select id into v_warehouse_id from public.warehouses where active is true order by id limit 1;
  if v_warehouse_id is null then raise exception 'UX5_ACTIVE_WAREHOUSE_REQUIRED'; end if;

  insert into public.shipments(id,container_number,active,last_status,operational_status)
  values(v_shipment_id,'UX5CONTAINER185',true,'Registrado','Registrado');

  v_state:=public.shipment_action_state(v_shipment_id);
  if coalesce((v_state#>>'{actions,edit,allowed}')::boolean,false) is not true then raise exception 'UX5_SHIPMENT_EDIT_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,assign_client,allowed}')::boolean,false) is not true then raise exception 'UX5_SHIPMENT_ASSIGN_CLIENT_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,manual_tracking,allowed}')::boolean,false) is not true then raise exception 'UX5_SHIPMENT_TRACKING_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,release,allowed}')::boolean,false) is not true then raise exception 'UX5_SHIPMENT_RELEASE_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,deliver,allowed}')::boolean,false) is not true then raise exception 'UX5_SHIPMENT_DELIVER_EXPECTED'; end if;
  if coalesce((v_state#>>'{actions,reactivate,allowed}')::boolean,false) is true then raise exception 'UX5_SHIPMENT_REACTIVATE_FORBIDDEN'; end if;
  if coalesce((v_state#>>'{actions,delete,allowed}')::boolean,false) is not true then raise exception 'UX5_SHIPMENT_DELETE_EXPECTED'; end if;

  insert into public.loads(id,load_serial,warehouse_id,shipment_id,status,notes)
  overriding system value
  values(v_load_id,1853000002,v_warehouse_id,v_shipment_id,'draft','UX5-CONTAINER-FIXTURE');
  v_state:=public.shipment_action_state(v_shipment_id);
  if coalesce((v_state#>>'{actions,delete,allowed}')::boolean,false) is true then raise exception 'UX5_SHIPMENT_LINKED_DELETE_FORBIDDEN'; end if;
  if v_state#>>'{actions,delete,reason}'<>'SHIPMENT_LINKED_TO_LOAD' then raise exception 'UX5_SHIPMENT_LINKED_DELETE_REASON'; end if;
  begin
    perform public.assert_shipment_action(v_shipment_id,'delete');
    raise exception 'UX5_SHIPMENT_DELETE_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('SHIPMENT_LINKED_TO_LOAD' in sqlerrm)=0 then raise; end if;
  end;

  delete from public.loads where id=v_load_id;
  update public.shipments set released_at=now(),last_status='Liberado',operational_status='Liberado' where id=v_shipment_id;
  v_state:=public.shipment_action_state(v_shipment_id);
  if coalesce((v_state#>>'{actions,release,allowed}')::boolean,false) is true then raise exception 'UX5_SHIPMENT_REPEAT_RELEASE_FORBIDDEN'; end if;
  if v_state#>>'{actions,release,reason}'<>'SHIPMENT_ALREADY_RELEASED' then raise exception 'UX5_SHIPMENT_REPEAT_RELEASE_REASON'; end if;

  update public.shipments set active=false,delivered_at=now(),last_status='Entregado',operational_status='Entregado' where id=v_shipment_id;
  v_state:=public.shipment_action_state(v_shipment_id);
  if coalesce((v_state#>>'{actions,manual_tracking,allowed}')::boolean,false) is true then raise exception 'UX5_SHIPMENT_DELIVERED_TRACKING_FORBIDDEN'; end if;
  if coalesce((v_state#>>'{actions,deliver,allowed}')::boolean,false) is true then raise exception 'UX5_SHIPMENT_REPEAT_DELIVER_FORBIDDEN'; end if;
  if coalesce((v_state#>>'{actions,reactivate,allowed}')::boolean,false) is not true then raise exception 'UX5_SHIPMENT_REACTIVATE_EXPECTED'; end if;
  begin
    perform public.assert_shipment_action(v_shipment_id,'manual_tracking');
    raise exception 'UX5_SHIPMENT_TRACKING_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('SHIPMENT_ALREADY_DELIVERED' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

rollback;

select
  (select count(*) from public.shipments where id='18530000-0000-4000-8000-000000000001'::uuid or container_number='UX5CONTAINER185') as shipment_fixture_residue,
  (select count(*) from public.loads where id='18530000-0000-4000-8000-000000000002'::uuid or notes='UX5-CONTAINER-FIXTURE') as load_fixture_residue;
