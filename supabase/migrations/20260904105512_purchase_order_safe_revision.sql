-- Las PO emitidas y confirmadas admiten correcciones seguras sin reescribir
-- recepciones, cuentas por pagar ni relaciones de abastecimiento.

create or replace function public.guard_purchase_order_item_mutation()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_old_status text;
  v_new_status text;
  v_revision_id text:=current_setting('export_mca.po_revision_id',true);
begin
  if tg_op in ('UPDATE','DELETE') then
    select status into v_old_status from public.purchase_orders where id=old.purchase_order_id;
    if v_old_status is distinct from 'draft'
       and v_revision_id is distinct from old.purchase_order_id::text then
      raise exception 'PO_ITEMS_LOCKED_BY_STATUS';
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select status into v_new_status from public.purchase_orders where id=new.purchase_order_id;
    if v_new_status is distinct from 'draft'
       and v_revision_id is distinct from new.purchase_order_id::text then
      raise exception 'PO_ITEMS_LOCKED_BY_STATUS';
    end if;
  end if;
  return coalesce(new,old);
end;
$$;

revoke all on function public.guard_purchase_order_item_mutation() from public,anon,authenticated;
grant execute on function public.guard_purchase_order_item_mutation() to service_role;

create or replace function public.purchase_order_action_state(p_purchase_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_po public.purchase_orders;
  v_receipt_status text:='pending';
  v_item_count integer:=0;
  v_supplier_active boolean:=false;
  v_warehouse_active boolean:=true;
  v_products_active boolean:=true;
  v_has_active_receipts boolean:=false;
  v_has_supply_links boolean:=false;
  v_has_finance_links boolean:=false;
  v_issue_reason text;
  v_edit_allowed boolean;
  v_issue_allowed boolean;
  v_confirm_allowed boolean;
  v_receive_allowed boolean;
  v_receive_excess_allowed boolean;
  v_close_allowed boolean;
  v_cancel_allowed boolean;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  select coalesce(p.receipt_status,'pending'),coalesce(p.item_count,0)
  into v_receipt_status,v_item_count from public.purchase_order_progress p where p.purchase_order_id=v_po.id;
  select coalesce(s.active,false) into v_supplier_active from public.suppliers s where s.id=v_po.supplier_id;
  if v_po.warehouse_id is not null then select coalesce(w.active,false) into v_warehouse_active from public.warehouses w where w.id=v_po.warehouse_id; end if;
  select not exists(select 1 from public.purchase_order_items poi left join public.products p on p.id=poi.product_id where poi.purchase_order_id=v_po.id and coalesce(p.active,false) is not true) into v_products_active;
  select exists(select 1 from public.purchase_order_items poi join public.purchase_receipt_allocations pra on pra.purchase_order_item_id=poi.id join public.warehouse_receipt_items wri on wri.id=pra.receipt_item_id join public.warehouse_receipts wr on wr.id=wri.receipt_id where poi.purchase_order_id=v_po.id and wr.status='received') into v_has_active_receipts;
  select exists(select 1 from public.purchase_order_items poi join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id where poi.purchase_order_id=v_po.id) into v_has_supply_links;
  select exists(select 1 from public.supplier_bills sb where sb.purchase_order_id=v_po.id and sb.status<>'void') or exists(select 1 from public.supplier_payments sp where sp.purchase_order_id=v_po.id and sp.status<>'reversed') into v_has_finance_links;

  v_edit_allowed:=v_po.status in ('draft','issued','confirmed');
  v_issue_reason:=case when v_po.status<>'draft' then 'PO_NOT_DRAFT' when v_item_count=0 then 'PO_HAS_NO_ITEMS' when v_supplier_active is not true then 'PO_SUPPLIER_INACTIVE' when v_warehouse_active is not true then 'PO_WAREHOUSE_INACTIVE' when v_products_active is not true then 'PO_HAS_INACTIVE_PRODUCT' else null end;
  v_issue_allowed:=v_issue_reason is null;
  v_confirm_allowed:=v_po.status='issued';
  v_receive_allowed:=v_po.warehouse_id is not null and v_po.status in ('issued','confirmed') and v_item_count>0 and v_receipt_status<>'received';
  v_receive_excess_allowed:=v_po.warehouse_id is not null and v_po.status in ('issued','confirmed') and v_item_count>0 and v_receipt_status='received';
  v_close_allowed:=v_po.status in ('issued','confirmed');
  v_cancel_allowed:=v_po.status in ('draft','issued','confirmed') and v_has_active_receipts is not true;
  return jsonb_build_object(
    'commercial_status',v_po.status,'destination_mode',case when v_po.warehouse_id is null then 'direct' else 'warehouse' end,'receipt_status',v_receipt_status,'item_count',v_item_count,
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'PO_NOT_EDITABLE' end,'mode',case when v_po.status='draft' then 'full' else 'protected' end,'supplier_locked',v_po.status<>'draft','currency_locked',v_po.status<>'draft','destination_locked',v_po.status<>'draft' and (v_has_active_receipts or v_has_supply_links),'has_finance_links',v_has_finance_links),
      'issue',jsonb_build_object('allowed',v_issue_allowed,'reason',v_issue_reason),
      'confirm',jsonb_build_object('allowed',v_confirm_allowed,'reason',case when v_confirm_allowed then null else 'PO_NOT_ISSUED' end),
      'receive_remaining',jsonb_build_object('allowed',v_receive_allowed,'reason',case when v_receive_allowed then null when v_po.warehouse_id is null then 'PO_DIRECT_SHIP_NO_WR' when v_po.status not in ('issued','confirmed') then 'PO_NOT_RECEIVABLE' when v_item_count=0 then 'PO_HAS_NO_ITEMS' else 'PO_ALREADY_FULLY_RECEIVED' end),
      'receive_excess',jsonb_build_object('allowed',v_receive_excess_allowed,'reason',case when v_receive_excess_allowed then null when v_po.warehouse_id is null then 'PO_DIRECT_SHIP_NO_WR' when v_po.status not in ('issued','confirmed') then 'PO_NOT_RECEIVABLE' else 'PO_NOT_FULLY_RECEIVED' end),
      'close',jsonb_build_object('allowed',v_close_allowed,'reason',case when v_close_allowed then null else 'PO_CANNOT_CLOSE' end),
      'cancel',jsonb_build_object('allowed',v_cancel_allowed,'reason',case when v_cancel_allowed then null when v_has_active_receipts then 'PO_HAS_ACTIVE_RECEIPTS' else 'PO_CANNOT_CANCEL' end)
    )
  );
end;
$$;

revoke all on function public.purchase_order_action_state(uuid) from public,anon,authenticated;
grant execute on function public.purchase_order_action_state(uuid) to service_role;

create or replace function public.replace_purchase_order_plan(
  p_purchase_order_id uuid,p_supplier_id uuid,p_lines jsonb,p_warehouse_id uuid default null,
  p_order_date date default current_date,p_expected_at timestamptz default null,p_currency text default 'USD',
  p_supplier_reference text default null,p_notes text default null
)
returns public.purchase_orders
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_po public.purchase_orders;
  v_line jsonb;
  v_item public.purchase_order_items;
  v_product record;
  v_currency text:=upper(btrim(coalesce(p_currency,'USD')));
  v_quantity numeric;
  v_pallets numeric;
  v_units_per_pallet numeric;
  v_unit_cost numeric;
  v_line_total numeric;
  v_committed_quantity numeric;
  v_committed_pallets numeric;
  v_has_receipts boolean;
  v_has_supply boolean;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  perform public.assert_purchase_order_action(v_po.id,'edit');
  if v_currency!~'^[A-Z]{3}$' then raise exception 'PO_CURRENCY_INVALID'; end if;
  if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)=0 then raise exception 'PO_HAS_NO_ITEMS'; end if;

  if v_po.status='draft' then
    delete from public.purchase_order_items where purchase_order_id=v_po.id;
    update public.purchase_orders set supplier_id=p_supplier_id,warehouse_id=p_warehouse_id,order_date=coalesce(p_order_date,current_date),expected_at=p_expected_at,currency=v_currency,supplier_reference=nullif(btrim(p_supplier_reference),''),notes=nullif(btrim(p_notes),'') where id=v_po.id;
    perform public.populate_purchase_order_items(v_po.id,p_lines);
    select * into v_po from public.purchase_orders where id=v_po.id;
    return v_po;
  end if;

  if v_po.status not in ('issued','confirmed') then raise exception 'PO_NOT_EDITABLE'; end if;
  if p_supplier_id is distinct from v_po.supplier_id then raise exception 'PO_CONFIRMED_SUPPLIER_LOCKED'; end if;
  if v_currency is distinct from v_po.currency then raise exception 'PO_CONFIRMED_CURRENCY_LOCKED'; end if;
  select exists(select 1 from public.purchase_order_items poi join public.purchase_receipt_allocations pra on pra.purchase_order_item_id=poi.id join public.warehouse_receipt_items wri on wri.id=pra.receipt_item_id join public.warehouse_receipts wr on wr.id=wri.receipt_id where poi.purchase_order_id=v_po.id and wr.status='received') into v_has_receipts;
  select exists(select 1 from public.purchase_order_items poi join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id where poi.purchase_order_id=v_po.id) into v_has_supply;
  if p_warehouse_id is distinct from v_po.warehouse_id and (v_has_receipts or v_has_supply) then raise exception 'PO_DESTINATION_LOCKED'; end if;
  if jsonb_array_length(p_lines)<>(select count(*) from public.purchase_order_items where purchase_order_id=v_po.id) then raise exception 'PO_CONFIRMED_STRUCTURE_LOCKED'; end if;
  if exists(select 1 from jsonb_array_elements(p_lines) line where nullif(btrim(line->>'id'),'') is null) then raise exception 'PO_CONFIRMED_STRUCTURE_LOCKED'; end if;
  if exists(select 1 from public.purchase_order_items poi where poi.purchase_order_id=v_po.id and not exists(select 1 from jsonb_array_elements(p_lines) line where nullif(btrim(line->>'id'),'')::uuid=poi.id)) then raise exception 'PO_CONFIRMED_STRUCTURE_LOCKED'; end if;

  update public.purchase_orders set warehouse_id=p_warehouse_id,order_date=coalesce(p_order_date,current_date),expected_at=p_expected_at,supplier_reference=nullif(btrim(p_supplier_reference),''),notes=nullif(btrim(p_notes),'') where id=v_po.id;
  perform set_config('export_mca.po_revision_id',v_po.id::text,true);
  for v_line in select value from jsonb_array_elements(p_lines) loop
    select * into v_item from public.purchase_order_items where id=nullif(btrim(v_line->>'id'),'')::uuid and purchase_order_id=v_po.id for update;
    if not found then raise exception 'PO_CONFIRMED_STRUCTURE_LOCKED'; end if;
    if nullif(btrim(v_line->>'product_id'),'')::uuid is distinct from v_item.product_id then raise exception 'PO_CONFIRMED_STRUCTURE_LOCKED'; end if;
    select id,unit,default_units_per_pallet,active into v_product from public.products where id=v_item.product_id;
    if v_product.active is not true then raise exception 'PO_PRODUCT_INACTIVE'; end if;
    v_quantity:=coalesce(nullif(btrim(v_line->>'ordered_quantity'),'')::numeric,0);
    v_pallets:=coalesce(nullif(btrim(v_line->>'ordered_pallets'),'')::numeric,0);
    v_units_per_pallet:=coalesce(nullif(btrim(v_line->>'units_per_pallet'),'')::numeric,v_product.default_units_per_pallet);
    v_unit_cost:=nullif(btrim(v_line->>'unit_cost'),'')::numeric;
    v_line_total:=nullif(btrim(v_line->>'line_total'),'')::numeric;
    if v_quantity<0 or v_pallets<0 then raise exception 'PO_QUANTITY_INVALID'; end if;
    if v_units_per_pallet is not null and v_units_per_pallet<=0 then raise exception 'PO_UNITS_PER_PALLET_INVALID'; end if;
    if v_quantity=0 and v_pallets>0 and v_units_per_pallet is not null then v_quantity:=v_pallets*v_units_per_pallet; end if;
    if v_quantity<=0 and v_pallets<=0 then raise exception 'PO_QUANTITY_REQUIRED'; end if;
    if v_quantity>0 and v_pallets>0 and v_units_per_pallet is not null and abs(v_quantity-(v_pallets*v_units_per_pallet))>0.000001 then raise exception 'PO_QUANTITY_PALLET_MISMATCH'; end if;
    if v_line_total is not null then if v_line_total<0 then raise exception 'PO_LINE_TOTAL_INVALID'; end if; if v_quantity<=0 then raise exception 'PO_LINE_TOTAL_REQUIRES_QUANTITY'; end if; v_unit_cost:=v_line_total/v_quantity; elsif v_unit_cost is not null and v_unit_cost<0 then raise exception 'PO_UNIT_COST_INVALID'; end if;
    select greatest(
      coalesce((select sum(pra.received_quantity) from public.purchase_receipt_allocations pra join public.warehouse_receipt_items wri on wri.id=pra.receipt_item_id join public.warehouse_receipts wr on wr.id=wri.receipt_id where pra.purchase_order_item_id=v_item.id and wr.status='received'),0),
      coalesce((select sum(spa.allocated_purchase_quantity) from public.sales_procurement_allocations spa where spa.purchase_order_item_id=v_item.id),0),
      coalesce((select sum(sbi.billed_quantity) from public.supplier_bill_items sbi join public.supplier_bills sb on sb.id=sbi.supplier_bill_id where sbi.purchase_order_item_id=v_item.id and sb.status<>'void'),0)
    ), greatest(
      coalesce((select sum(pra.received_pallets) from public.purchase_receipt_allocations pra join public.warehouse_receipt_items wri on wri.id=pra.receipt_item_id join public.warehouse_receipts wr on wr.id=wri.receipt_id where pra.purchase_order_item_id=v_item.id and wr.status='received'),0),
      coalesce((select sum(spa.allocated_purchase_pallets) from public.sales_procurement_allocations spa where spa.purchase_order_item_id=v_item.id),0)
    ) into v_committed_quantity,v_committed_pallets;
    if v_quantity<v_committed_quantity then raise exception 'PO_QUANTITY_BELOW_COMMITTED'; end if;
    if v_pallets<v_committed_pallets then raise exception 'PO_PALLETS_BELOW_COMMITTED'; end if;
    if exists(select 1 from public.purchase_receipt_allocations pra join public.warehouse_receipt_items wri on wri.id=pra.receipt_item_id join public.warehouse_receipts wr on wr.id=wri.receipt_id where pra.purchase_order_item_id=v_item.id and wr.status='received') and v_units_per_pallet is distinct from v_item.units_per_pallet then raise exception 'PO_RECEIVED_MEASURE_LOCKED'; end if;
    update public.purchase_order_items set ordered_quantity=v_quantity,ordered_pallets=v_pallets,units_per_pallet=v_units_per_pallet,unit_cost=v_unit_cost,entered_line_total=v_line_total,notes=nullif(btrim(v_line->>'notes'),'') where id=v_item.id;
  end loop;
  select * into v_po from public.purchase_orders where id=v_po.id;
  return v_po;
end;
$$;

revoke all on function public.replace_purchase_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.replace_purchase_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) to service_role;

comment on function public.replace_purchase_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) is
  'Revises draft plans freely and issued/confirmed plans in place while preserving committed operational and financial history.';
