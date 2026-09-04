-- Una PO sin almacén representa mercancía comprada para Direct Ship.
-- No crea WR ni inventario propio; su salida se controla desde Ventas.

comment on column public.purchase_orders.warehouse_id is
  'Destination warehouse. NULL means Direct Ship: supplier to customer, without a warehouse receipt or owned inventory.';

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
  v_receive_allowed := v_po.warehouse_id is not null
    and v_po.status in ('issued','confirmed')
    and v_item_count>0
    and v_receipt_status<>'received';
  v_receive_excess_allowed := v_po.warehouse_id is not null
    and v_po.status in ('issued','confirmed')
    and v_item_count>0
    and v_receipt_status='received';
  v_close_allowed := v_po.status in ('issued','confirmed');
  v_cancel_allowed := v_po.status in ('draft','issued','confirmed') and v_has_active_receipts is not true;

  return jsonb_build_object(
    'commercial_status',v_po.status,
    'destination_mode',case when v_po.warehouse_id is null then 'direct' else 'warehouse' end,
    'receipt_status',v_receipt_status,
    'item_count',v_item_count,
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'PO_NOT_DRAFT' end),
      'issue',jsonb_build_object('allowed',v_issue_allowed,'reason',v_issue_reason),
      'confirm',jsonb_build_object('allowed',v_confirm_allowed,'reason',case when v_confirm_allowed then null else 'PO_NOT_ISSUED' end),
      'receive_remaining',jsonb_build_object(
        'allowed',v_receive_allowed,
        'reason',case
          when v_receive_allowed then null
          when v_po.warehouse_id is null then 'PO_DIRECT_SHIP_NO_WR'
          when v_po.status not in ('issued','confirmed') then 'PO_NOT_RECEIVABLE'
          when v_item_count=0 then 'PO_HAS_NO_ITEMS'
          else 'PO_ALREADY_FULLY_RECEIVED'
        end
      ),
      'receive_excess',jsonb_build_object(
        'allowed',v_receive_excess_allowed,
        'reason',case
          when v_receive_excess_allowed then null
          when v_po.warehouse_id is null then 'PO_DIRECT_SHIP_NO_WR'
          when v_po.status not in ('issued','confirmed') then 'PO_NOT_RECEIVABLE'
          else 'PO_NOT_FULLY_RECEIVED'
        end
      ),
      'close',jsonb_build_object('allowed',v_close_allowed,'reason',case when v_close_allowed then null else 'PO_CANNOT_CLOSE' end),
      'cancel',jsonb_build_object('allowed',v_cancel_allowed,'reason',case when v_cancel_allowed then null when v_has_active_receipts then 'PO_HAS_ACTIVE_RECEIPTS' else 'PO_CANNOT_CANCEL' end)
    )
  );
end;
$$;

revoke all on function public.purchase_order_action_state(uuid) from public,anon,authenticated;
grant execute on function public.purchase_order_action_state(uuid) to service_role;

comment on function public.purchase_order_action_state(uuid) is
  'Canonical Purchase Order actions. A PO without warehouse is Direct Ship and cannot create warehouse receipts.';
