begin;

-- Deterministic fixture; use existing active master data but create no persistent rows.
do $$
begin
  if exists(select 1 from public.purchase_orders where id='18500000-0000-4000-8000-000000000001'::uuid or po_number='UX5-PO-FIXTURE') then
    raise exception 'UX5_PO_FIXTURE_ALREADY_EXISTS';
  end if;
  if exists(select 1 from public.warehouse_receipts where id='18500000-0000-4000-8000-000000000003'::uuid or receipt_number='UX5-WR-FIXTURE') then
    raise exception 'UX5_WR_FIXTURE_ALREADY_EXISTS';
  end if;
end;
$$;

insert into public.purchase_orders(id,po_number,supplier_id,warehouse_id,currency,status,supplier_reference)
select '18500000-0000-4000-8000-000000000001'::uuid,'UX5-PO-FIXTURE',s.id,w.id,'USD','draft','UX5-FIXTURE'
from (select id from public.suppliers where active=true order by id limit 1) s
cross join (select id from public.warehouses where active=true order by id limit 1) w;

insert into public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,ordered_pallets,unit,unit_cost,currency)
select '18500000-0000-4000-8000-000000000002'::uuid,'18500000-0000-4000-8000-000000000001'::uuid,p.id,10,0,coalesce(nullif(btrim(p.unit),''),'unidades'),1,'USD'
from (select id,unit from public.products where active=true order by id limit 1) p;

do $$
declare s jsonb;
begin
  s:=public.purchase_order_action_state('18500000-0000-4000-8000-000000000001'::uuid);
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is not true then raise exception 'UX5_DRAFT_EDIT_EXPECTED'; end if;
  if coalesce((s#>>'{actions,issue,allowed}')::boolean,false) is not true then raise exception 'UX5_DRAFT_ISSUE_EXPECTED'; end if;
  if coalesce((s#>>'{actions,receive_remaining,allowed}')::boolean,false) is true then raise exception 'UX5_DRAFT_RECEIVE_FORBIDDEN'; end if;
end;
$$;

select public.transition_purchase_order('18500000-0000-4000-8000-000000000001'::uuid,'issue');
select public.transition_purchase_order('18500000-0000-4000-8000-000000000001'::uuid,'confirm');

do $$
declare s jsonb;
begin
  s:=public.purchase_order_action_state('18500000-0000-4000-8000-000000000001'::uuid);
  if coalesce((s#>>'{actions,receive_remaining,allowed}')::boolean,false) is not true then raise exception 'UX5_CONFIRMED_RECEIVE_EXPECTED'; end if;
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is true then raise exception 'UX5_CONFIRMED_EDIT_FORBIDDEN'; end if;
  begin
    perform public.assert_purchase_order_action('18500000-0000-4000-8000-000000000001'::uuid,'edit');
    raise exception 'UX5_EDIT_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('PO_NOT_DRAFT' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

insert into public.warehouse_receipts(id,receipt_number,warehouse_id,supplier_id,supplier_name,status,reference_number)
select '18500000-0000-4000-8000-000000000003'::uuid,'UX5-WR-FIXTURE',po.warehouse_id,po.supplier_id,s.name,'received','UX5-FIXTURE'
from public.purchase_orders po join public.suppliers s on s.id=po.supplier_id
where po.id='18500000-0000-4000-8000-000000000001'::uuid;

insert into public.warehouse_receipt_items(id,receipt_id,product_id,pallets,quantity,unit,unit_cost,currency)
select '18500000-0000-4000-8000-000000000004'::uuid,'18500000-0000-4000-8000-000000000003'::uuid,poi.product_id,0,10,poi.unit,poi.unit_cost,poi.currency
from public.purchase_order_items poi where poi.id='18500000-0000-4000-8000-000000000002'::uuid;

insert into public.purchase_receipt_allocations(id,purchase_order_item_id,receipt_item_id,received_quantity,received_pallets)
values('18500000-0000-4000-8000-000000000005'::uuid,'18500000-0000-4000-8000-000000000002'::uuid,'18500000-0000-4000-8000-000000000004'::uuid,10,0);

do $$
declare s jsonb;
begin
  s:=public.purchase_order_action_state('18500000-0000-4000-8000-000000000001'::uuid);
  if s->>'receipt_status'<>'received' then raise exception 'UX5_RECEIPT_STATUS_EXPECTED_RECEIVED'; end if;
  if coalesce((s#>>'{actions,receive_remaining,allowed}')::boolean,false) is true then raise exception 'UX5_FULL_RECEIVE_MUST_DISAPPEAR'; end if;
  if coalesce((s#>>'{actions,receive_excess,allowed}')::boolean,false) is not true then raise exception 'UX5_EXCESS_ACTION_EXPECTED'; end if;
  if coalesce((s#>>'{actions,cancel,allowed}')::boolean,false) is true then raise exception 'UX5_CANCEL_WITH_ACTIVE_RECEIPT_FORBIDDEN'; end if;
  begin
    perform public.assert_purchase_order_action('18500000-0000-4000-8000-000000000001'::uuid,'receive_remaining');
    raise exception 'UX5_RECEIVE_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('PO_ALREADY_FULLY_RECEIVED' in sqlerrm)=0 then raise; end if;
  end;
  perform public.assert_purchase_order_action('18500000-0000-4000-8000-000000000001'::uuid,'receive_excess');
end;
$$;

rollback;

select
  (select count(*) from public.purchase_orders where id='18500000-0000-4000-8000-000000000001'::uuid or po_number='UX5-PO-FIXTURE') as purchase_order_fixture_residue,
  (select count(*) from public.purchase_order_items where id='18500000-0000-4000-8000-000000000002'::uuid) as purchase_item_fixture_residue,
  (select count(*) from public.warehouse_receipts where id='18500000-0000-4000-8000-000000000003'::uuid or receipt_number='UX5-WR-FIXTURE') as warehouse_receipt_fixture_residue,
  (select count(*) from public.warehouse_receipt_items where id='18500000-0000-4000-8000-000000000004'::uuid) as warehouse_item_fixture_residue,
  (select count(*) from public.purchase_receipt_allocations where id='18500000-0000-4000-8000-000000000005'::uuid) as allocation_fixture_residue;
