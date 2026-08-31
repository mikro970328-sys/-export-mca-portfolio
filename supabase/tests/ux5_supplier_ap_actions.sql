begin;

-- Reversible AP fixture using active master data and an isolated deterministic PO.
do $$
begin
  if exists(select 1 from public.purchase_orders where id='18540000-0000-4000-8000-000000000001'::uuid or po_number='UX5-AP-PO-FIXTURE') then
    raise exception 'UX5_AP_PO_FIXTURE_ALREADY_EXISTS';
  end if;
  if exists(select 1 from public.supplier_bills where supplier_invoice_number='UX5-AP-INVOICE-1854') then
    raise exception 'UX5_AP_BILL_FIXTURE_ALREADY_EXISTS';
  end if;
end;
$$;

insert into public.purchase_orders(id,po_number,supplier_id,warehouse_id,currency,status,supplier_reference)
select '18540000-0000-4000-8000-000000000001'::uuid,'UX5-AP-PO-FIXTURE',s.id,w.id,'USD','draft','UX5-AP-FIXTURE'
from (select id from public.suppliers where active=true order by id limit 1) s
cross join (select id from public.warehouses where active=true order by id limit 1) w;

insert into public.purchase_order_items(id,purchase_order_id,product_id,ordered_quantity,ordered_pallets,unit,unit_cost,currency)
select '18540000-0000-4000-8000-000000000002'::uuid,'18540000-0000-4000-8000-000000000001'::uuid,p.id,10,0,coalesce(nullif(btrim(p.unit),''),'unidades'),10,'USD'
from (select id,unit from public.products where active=true order by id limit 1) p;

select public.transition_purchase_order('18540000-0000-4000-8000-000000000001'::uuid,'issue');
select public.transition_purchase_order('18540000-0000-4000-8000-000000000001'::uuid,'confirm');

-- Start without supplier invoice number to prove post eligibility is DB-owned.
select public.create_supplier_bill_plan(
  '18540000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_array(jsonb_build_object(
    'purchase_order_item_id','18540000-0000-4000-8000-000000000002',
    'billed_quantity','10',
    'unit_cost','10'
  )),
  null,current_date,current_date + 30,'UX5 AP reversible fixture',null
);

do $$
declare v_bill uuid; s jsonb;
begin
  select id into v_bill from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid;
  s:=public.supplier_bill_action_state(v_bill);
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_DRAFT_EDIT_EXPECTED'; end if;
  if coalesce((s#>>'{actions,post,allowed}')::boolean,false) is true then raise exception 'UX5_AP_POST_WITHOUT_INVOICE_FORBIDDEN'; end if;
  if s#>>'{actions,post,reason}' <> 'SUPPLIER_BILL_INVOICE_NUMBER_REQUIRED' then raise exception 'UX5_AP_INVOICE_REASON_EXPECTED'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_DRAFT_VOID_EXPECTED'; end if;
  if coalesce((s#>>'{actions,pay,allowed}')::boolean,false) is true then raise exception 'UX5_AP_DRAFT_PAY_FORBIDDEN'; end if;
end;
$$;

select public.replace_supplier_bill_plan_canonical(
  (select id from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid),
  '18540000-0000-4000-8000-000000000001'::uuid,
  jsonb_build_array(jsonb_build_object(
    'purchase_order_item_id','18540000-0000-4000-8000-000000000002',
    'billed_quantity','10',
    'line_total','100'
  )),
  'UX5-AP-INVOICE-1854',current_date,current_date + 30,'UX5 AP canonical edit'
);

do $$
declare v_bill uuid; s jsonb;
begin
  select id into v_bill from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid;
  s:=public.supplier_bill_action_state(v_bill);
  if coalesce((s#>>'{actions,post,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_POST_EXPECTED'; end if;
  perform public.assert_supplier_bill_action(v_bill,'post');
end;
$$;

select public.transition_supplier_bill_canonical(
  (select id from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid),
  'post',null
);

do $$
declare v_bill uuid; s jsonb;
begin
  select id into v_bill from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid;
  s:=public.supplier_bill_action_state(v_bill);
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is true then raise exception 'UX5_AP_POSTED_EDIT_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,pay,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_POSTED_PAY_EXPECTED'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_POSTED_VOID_EXPECTED_WITHOUT_PAYMENT'; end if;
  begin
    perform public.assert_supplier_bill_action(v_bill,'edit');
    raise exception 'UX5_AP_EDIT_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('SUPPLIER_BILL_NOT_DRAFT' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

select public.pay_supplier_bill_canonical(
  (select id from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid),
  40,current_date,'wire','UX5-AP-PAYMENT-1854','partial payment',null
);

do $$
declare v_bill uuid; v_payment uuid; bs jsonb; ps jsonb;
begin
  select id into v_bill from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid;
  select id into v_payment from public.supplier_payments where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid and reference='UX5-AP-PAYMENT-1854';
  bs:=public.supplier_bill_action_state(v_bill);
  ps:=public.supplier_payment_action_state(v_payment);
  if coalesce((bs#>>'{actions,void,allowed}')::boolean,false) is true then raise exception 'UX5_AP_VOID_WITH_ACTIVE_PAYMENT_FORBIDDEN'; end if;
  if bs#>>'{actions,void,reason}' <> 'SUPPLIER_BILL_HAS_ACTIVE_PAYMENTS' then raise exception 'UX5_AP_ACTIVE_PAYMENT_REASON_EXPECTED'; end if;
  if coalesce((bs#>>'{actions,pay,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_PARTIAL_PAY_EXPECTED'; end if;
  if coalesce((ps#>>'{actions,allocate,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_ALLOCATE_EXPECTED'; end if;
  if coalesce((ps#>>'{actions,reverse,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_REVERSE_EXPECTED'; end if;
end;
$$;

-- Canonical allocation wrapper can remove the application while payment stays posted.
select public.replace_supplier_payment_applications_canonical(
  (select id from public.supplier_payments where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid and reference='UX5-AP-PAYMENT-1854'),
  '[]'::jsonb,null
);

do $$
declare v_bill uuid; s jsonb;
begin
  select id into v_bill from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid;
  s:=public.supplier_bill_action_state(v_bill);
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX5_AP_VOID_AFTER_DEALLOCATE_EXPECTED'; end if;
end;
$$;

select public.reverse_supplier_payment_canonical(
  (select id from public.supplier_payments where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid and reference='UX5-AP-PAYMENT-1854'),
  'UX5 reversible test',null
);

do $$
declare v_payment uuid; s jsonb;
begin
  select id into v_payment from public.supplier_payments where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid and reference='UX5-AP-PAYMENT-1854';
  s:=public.supplier_payment_action_state(v_payment);
  if coalesce((s#>>'{actions,allocate,allowed}')::boolean,false) is true then raise exception 'UX5_AP_REVERSED_ALLOCATE_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,reverse,allowed}')::boolean,false) is true then raise exception 'UX5_AP_REPEAT_REVERSE_FORBIDDEN'; end if;
  begin
    perform public.assert_supplier_payment_action(v_payment,'reverse');
    raise exception 'UX5_AP_REVERSE_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('SUPPLIER_PAYMENT_ALREADY_REVERSED' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

select public.transition_supplier_bill_canonical(
  (select id from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid),
  'void',null
);

do $$
declare v_bill uuid; s jsonb;
begin
  select id into v_bill from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid;
  s:=public.supplier_bill_action_state(v_bill);
  if coalesce((s#>>'{actions,pay,allowed}')::boolean,false) is true then raise exception 'UX5_AP_VOID_PAY_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is true then raise exception 'UX5_AP_REPEAT_VOID_FORBIDDEN'; end if;
end;
$$;

rollback;

select
  (select count(*) from public.purchase_orders where id='18540000-0000-4000-8000-000000000001'::uuid or po_number='UX5-AP-PO-FIXTURE') as purchase_order_fixture_residue,
  (select count(*) from public.purchase_order_items where id='18540000-0000-4000-8000-000000000002'::uuid) as purchase_item_fixture_residue,
  (select count(*) from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid or supplier_invoice_number='UX5-AP-INVOICE-1854') as supplier_bill_fixture_residue,
  (select count(*) from public.supplier_bill_items where supplier_bill_id in (select id from public.supplier_bills where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid)) as supplier_bill_item_fixture_residue,
  (select count(*) from public.supplier_payments where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid or reference='UX5-AP-PAYMENT-1854') as supplier_payment_fixture_residue,
  (select count(*) from public.supplier_payment_applications where supplier_payment_id in (select id from public.supplier_payments where purchase_order_id='18540000-0000-4000-8000-000000000001'::uuid)) as supplier_application_fixture_residue;