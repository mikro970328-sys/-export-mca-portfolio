-- UX-5: one canonical DB owner for Purchase Order action availability.
-- UI/API consume this contract; mutation RPCs revalidate it under row locks.

create or replace function public.purchase_order_action_state(p_purchase_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_po public.purchase_orders;
  v_receipt_status text := 'pending';
  v_item_count integer := 0;
  v_supplier_active boolean := false;
  v_warehouse_active boolean := true;
  v_products_active boolean := true;
  v_has_active_receipts boolean := false;
  v_issue_reason text;
  v_edit_allowed boolean;
  v_issue_allowed boolean;
  v_confirm_allowed boolean;
  v_receive_allowed boolean;
  v_receive_excess_allowed boolean;
  v_close_allowed boolean;
  v_cancel_allowed boolean;
begin
  select * into v_po
  from public.purchase_orders
  where id=p_purchase_order_id;
  if not found then raise exception 'PO_NOT_FOUND'; end if;

  select coalesce(p.receipt_status,'pending'),coalesce(p.item_count,0)
  into v_receipt_status,v_item_count
  from public.purchase_order_progress p
  where p.purchase_order_id=v_po.id;

  select coalesce(s.active,false) into v_supplier_active
  from public.suppliers s where s.id=v_po.supplier_id;

  if v_po.warehouse_id is not null then
    select coalesce(w.active,false) into v_warehouse_active
    from public.warehouses w where w.id=v_po.warehouse_id;
  end if;

  select not exists(
    select 1
    from public.purchase_order_items poi
    left join public.products p on p.id=poi.product_id
    where poi.purchase_order_id=v_po.id
      and coalesce(p.active,false) is not true
  ) into v_products_active;

  select exists(
    select 1
    from public.purchase_order_items poi
    join public.purchase_receipt_allocations pra on pra.purchase_order_item_id=poi.id
    join public.warehouse_receipt_items wri on wri.id=pra.receipt_item_id
    join public.warehouse_receipts wr on wr.id=wri.receipt_id
    where poi.purchase_order_id=v_po.id and wr.status='received'
  ) into v_has_active_receipts;

  v_edit_allowed := v_po.status='draft';
  v_issue_reason := case
    when v_po.status<>'draft' then 'PO_NOT_DRAFT'
    when v_item_count=0 then 'PO_HAS_NO_ITEMS'
    when v_supplier_active is not true then 'PO_SUPPLIER_INACTIVE'
    when v_warehouse_active is not true then 'PO_WAREHOUSE_INACTIVE'
    when v_products_active is not true then 'PO_HAS_INACTIVE_PRODUCT'
    else null
  end;
  v_issue_allowed := v_issue_reason is null;
  v_confirm_allowed := v_po.status='issued';
  v_receive_allowed := v_po.status in ('issued','confirmed') and v_item_count>0 and v_receipt_status<>'received';
  -- Once fully received, excess/correction is a separate explicit action, never the normal Receive CTA.
  v_receive_excess_allowed := v_po.status in ('issued','confirmed') and v_item_count>0 and v_receipt_status='received';
  v_close_allowed := v_po.status in ('issued','confirmed');
  v_cancel_allowed := v_po.status in ('draft','issued','confirmed') and v_has_active_receipts is not true;

  return jsonb_build_object(
    'commercial_status',v_po.status,
    'receipt_status',v_receipt_status,
    'item_count',v_item_count,
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'PO_NOT_DRAFT' end),
      'issue',jsonb_build_object('allowed',v_issue_allowed,'reason',v_issue_reason),
      'confirm',jsonb_build_object('allowed',v_confirm_allowed,'reason',case when v_confirm_allowed then null else 'PO_NOT_ISSUED' end),
      'receive_remaining',jsonb_build_object('allowed',v_receive_allowed,'reason',case when v_receive_allowed then null when v_po.status not in ('issued','confirmed') then 'PO_NOT_RECEIVABLE' when v_item_count=0 then 'PO_HAS_NO_ITEMS' else 'PO_ALREADY_FULLY_RECEIVED' end),
      'receive_excess',jsonb_build_object('allowed',v_receive_excess_allowed,'reason',case when v_receive_excess_allowed then null when v_po.status not in ('issued','confirmed') then 'PO_NOT_RECEIVABLE' else 'PO_NOT_FULLY_RECEIVED' end),
      'close',jsonb_build_object('allowed',v_close_allowed,'reason',case when v_close_allowed then null else 'PO_CANNOT_CLOSE' end),
      'cancel',jsonb_build_object('allowed',v_cancel_allowed,'reason',case when v_cancel_allowed then null when v_has_active_receipts then 'PO_HAS_ACTIVE_RECEIPTS' else 'PO_CANNOT_CANCEL' end)
    )
  );
end;
$$;

revoke all on function public.purchase_order_action_state(uuid) from public,anon,authenticated;
grant execute on function public.purchase_order_action_state(uuid) to service_role;

create or replace function public.assert_purchase_order_action(
  p_purchase_order_id uuid,
  p_action text
)
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
  if v_action not in ('edit','issue','confirm','receive_remaining','receive_excess','close','cancel') then
    raise exception 'PO_ACTION_INVALID';
  end if;
  v_state:=public.purchase_order_action_state(p_purchase_order_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'PO_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

revoke all on function public.assert_purchase_order_action(uuid,text) from public,anon,authenticated;
grant execute on function public.assert_purchase_order_action(uuid,text) to service_role;

create or replace view public.purchase_order_action_capabilities
with (security_invoker=true)
as
select po.id as purchase_order_id,
       public.purchase_order_action_state(po.id) as capabilities
from public.purchase_orders po;

revoke all on public.purchase_order_action_capabilities from public,anon,authenticated;
grant select on public.purchase_order_action_capabilities to service_role;

create or replace function public.transition_purchase_order(p_purchase_order_id uuid,p_action text)
returns public.purchase_orders
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_po public.purchase_orders;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_target text;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;

  perform public.assert_purchase_order_action(v_po.id,v_action);

  v_target:=case v_action
    when 'issue' then 'issued'
    when 'confirm' then 'confirmed'
    when 'cancel' then 'cancelled'
    when 'close' then 'closed'
    else null
  end;
  if v_target is null then raise exception 'PO_ACTION_INVALID'; end if;

  perform set_config('export_mca.po_transition',v_action,true);
  update public.purchase_orders set status=v_target where id=v_po.id;
  select * into v_po from public.purchase_orders where id=v_po.id;
  return v_po;
end;
$$;

revoke all on function public.transition_purchase_order(uuid,text) from public,anon,authenticated;
grant execute on function public.transition_purchase_order(uuid,text) to service_role;

create or replace function public.receive_purchase_order_lines(
  p_warehouse_id uuid,
  p_lines jsonb,
  p_received_at timestamptz default now(),
  p_truck_reference text default null,
  p_driver_name text default null,
  p_reference_number text default null,
  p_notes text default null,
  p_allow_over_receipt boolean default false,
  p_actor uuid default null
)
returns public.warehouse_receipts
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
 v_line jsonb; v_item_id uuid; v_item record; v_supplier_id uuid; v_supplier_name text; v_po_numbers text[]:=array[]::text[]; v_reference_number text; v_warehouse_active boolean;
 v_receipt public.warehouse_receipts; v_receipt_item_id uuid; v_quantity numeric; v_pallets numeric; v_units_per_pallet numeric; v_net_weight numeric; v_gross_weight numeric; v_existing_quantity numeric; v_existing_pallets numeric;
 v_po_id uuid; v_po_state jsonb; v_receipt_action text;
begin
 if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
 select active into v_warehouse_active from public.warehouses where id=p_warehouse_id; if not found then raise exception 'PO_WAREHOUSE_NOT_FOUND'; end if; if v_warehouse_active is not true then raise exception 'PO_WAREHOUSE_INACTIVE'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'PO_RECEIPT_HAS_NO_ITEMS'; end if;

 for v_po_id in select distinct poi.purchase_order_id from jsonb_array_elements(p_lines) line join public.purchase_order_items poi on poi.id=nullif(btrim(line->>'purchase_order_item_id'),'')::uuid order by poi.purchase_order_id loop
   perform 1 from public.purchase_orders where id=v_po_id for update;
   v_po_state:=public.purchase_order_action_state(v_po_id);
   v_receipt_action:=case when coalesce(v_po_state->>'receipt_status','pending')='received' and p_allow_over_receipt then 'receive_excess' else 'receive_remaining' end;
   perform public.assert_purchase_order_action(v_po_id,v_receipt_action);
 end loop;

 for v_item_id in select distinct nullif(btrim(line->>'purchase_order_item_id'),'')::uuid from jsonb_array_elements(p_lines) line order by 1 loop perform 1 from public.purchase_order_items where id=v_item_id for update; if not found then raise exception 'PO_ITEM_NOT_FOUND'; end if; end loop;
 for v_line in select value from jsonb_array_elements(p_lines) loop
   if jsonb_typeof(v_line)<>'object' then raise exception 'PO_RECEIPT_ITEM_INVALID'; end if;
   v_item_id:=nullif(btrim(v_line->>'purchase_order_item_id'),'')::uuid;
   select poi.*,po.supplier_id as po_supplier_id,po.warehouse_id as po_warehouse_id,po.status as po_status,po.po_number into v_item from public.purchase_order_items poi join public.purchase_orders po on po.id=poi.purchase_order_id where poi.id=v_item_id;
   if not found then raise exception 'PO_ITEM_NOT_FOUND'; end if; if v_item.po_warehouse_id is not null and v_item.po_warehouse_id<>p_warehouse_id then raise exception 'PO_WR_WAREHOUSE_MISMATCH'; end if;
   if v_supplier_id is null then v_supplier_id:=v_item.po_supplier_id; select name into v_supplier_name from public.suppliers where id=v_supplier_id; if not found then raise exception 'PO_SUPPLIER_NOT_FOUND'; end if; elsif v_supplier_id<>v_item.po_supplier_id then raise exception 'PO_RECEIPT_MULTIPLE_SUPPLIERS'; end if;
   if not (v_item.po_number=any(v_po_numbers)) then v_po_numbers:=array_append(v_po_numbers,v_item.po_number); end if;
 end loop;
 v_reference_number:=coalesce(nullif(btrim(p_reference_number),''),array_to_string(v_po_numbers,', '));
 insert into public.warehouse_receipts(warehouse_id,supplier_id,supplier_name,received_at,truck_reference,driver_name,reference_number,notes,created_by)
 values(p_warehouse_id,v_supplier_id,v_supplier_name,coalesce(p_received_at,now()),nullif(btrim(p_truck_reference),''),nullif(btrim(p_driver_name),''),v_reference_number,nullif(btrim(p_notes),''),p_actor) returning * into v_receipt;
 for v_line in select value from jsonb_array_elements(p_lines) loop
   v_item_id:=nullif(btrim(v_line->>'purchase_order_item_id'),'')::uuid; select * into v_item from public.purchase_order_items where id=v_item_id;
   v_quantity:=coalesce(nullif(btrim(v_line->>'received_quantity'),'')::numeric,0); v_pallets:=coalesce(nullif(btrim(v_line->>'received_pallets'),'')::numeric,0); v_units_per_pallet:=coalesce(nullif(btrim(v_line->>'units_per_pallet'),'')::numeric,v_item.units_per_pallet); v_net_weight:=nullif(btrim(v_line->>'net_weight_kg'),'')::numeric; v_gross_weight:=nullif(btrim(v_line->>'gross_weight_kg'),'')::numeric;
   if v_quantity<0 or v_pallets<0 then raise exception 'PO_RECEIPT_QUANTITY_INVALID'; end if; if v_units_per_pallet is not null and v_units_per_pallet<=0 then raise exception 'PO_UNITS_PER_PALLET_INVALID'; end if; if v_net_weight is not null and v_net_weight<0 then raise exception 'WR_NET_WEIGHT_INVALID'; end if; if v_gross_weight is not null and v_gross_weight<0 then raise exception 'WR_GROSS_WEIGHT_INVALID'; end if; if v_net_weight is not null and v_gross_weight is not null and v_gross_weight<v_net_weight then raise exception 'WR_GROSS_WEIGHT_LT_NET'; end if;
   if v_quantity=0 and v_pallets>0 and v_units_per_pallet is not null then v_quantity:=v_pallets*v_units_per_pallet; end if; if v_quantity<=0 then raise exception 'PO_RECEIPT_QUANTITY_REQUIRED'; end if;
   select coalesce(sum(pra.received_quantity) filter(where wr.status='received'),0),coalesce(sum(pra.received_pallets) filter(where wr.status='received'),0) into v_existing_quantity,v_existing_pallets from public.purchase_receipt_allocations pra join public.warehouse_receipt_items wri on wri.id=pra.receipt_item_id join public.warehouse_receipts wr on wr.id=wri.receipt_id where pra.purchase_order_item_id=v_item_id;
   if p_allow_over_receipt is not true and ((v_item.ordered_quantity>0 and v_existing_quantity+v_quantity>v_item.ordered_quantity) or (v_item.ordered_pallets>0 and v_existing_pallets+v_pallets>v_item.ordered_pallets)) then raise exception 'PO_OVER_RECEIPT_REQUIRES_CONFIRMATION'; end if;
   insert into public.warehouse_receipt_items(receipt_id,product_id,pallets,quantity,unit,units_per_pallet,net_weight_kg,gross_weight_kg,unit_cost,currency,lot_number,notes)
   values(v_receipt.id,v_item.product_id,v_pallets,v_quantity,v_item.unit,v_units_per_pallet,v_net_weight,v_gross_weight,v_item.unit_cost,v_item.currency,nullif(btrim(v_line->>'lot_number'),''),nullif(btrim(v_line->>'notes'),'')) returning id into v_receipt_item_id;
   insert into public.purchase_receipt_allocations(purchase_order_item_id,receipt_item_id,received_quantity,received_pallets,created_by) values(v_item_id,v_receipt_item_id,v_quantity,v_pallets,p_actor);
 end loop;
 return v_receipt;
end;
$$;

revoke all on function public.receive_purchase_order_lines(uuid,jsonb,timestamptz,text,text,text,text,boolean,uuid) from public,anon,authenticated;
grant execute on function public.receive_purchase_order_lines(uuid,jsonb,timestamptz,text,text,text,text,boolean,uuid) to service_role;
