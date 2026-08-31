-- UX-5: editing a PO must use the same canonical action owner exposed to the UI.
create or replace function public.replace_purchase_order_plan(
  p_purchase_order_id uuid,
  p_supplier_id uuid,
  p_lines jsonb,
  p_warehouse_id uuid default null,
  p_order_date date default current_date,
  p_expected_at timestamptz default null,
  p_currency text default 'USD',
  p_supplier_reference text default null,
  p_notes text default null
)
returns public.purchase_orders
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_po public.purchase_orders;
  v_currency text:=upper(btrim(coalesce(p_currency,'USD')));
  v_active boolean;
begin
  select * into v_po from public.purchase_orders where id=p_purchase_order_id for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  perform public.assert_purchase_order_action(v_po.id,'edit');
  if v_currency!~'^[A-Z]{3}$' then raise exception 'PO_CURRENCY_INVALID'; end if;
  select active into v_active from public.suppliers where id=p_supplier_id;
  if not found then raise exception 'PO_SUPPLIER_NOT_FOUND'; end if;
  if v_active is not true then raise exception 'PO_SUPPLIER_INACTIVE'; end if;
  if p_warehouse_id is not null then
    select active into v_active from public.warehouses where id=p_warehouse_id;
    if not found then raise exception 'PO_WAREHOUSE_NOT_FOUND'; end if;
    if v_active is not true then raise exception 'PO_WAREHOUSE_INACTIVE'; end if;
  end if;
  delete from public.purchase_order_items where purchase_order_id=p_purchase_order_id;
  update public.purchase_orders
  set supplier_id=p_supplier_id,warehouse_id=p_warehouse_id,order_date=coalesce(p_order_date,current_date),expected_at=p_expected_at,currency=v_currency,supplier_reference=nullif(btrim(p_supplier_reference),''),notes=nullif(btrim(p_notes),'')
  where id=p_purchase_order_id;
  perform public.populate_purchase_order_items(p_purchase_order_id,p_lines);
  select * into v_po from public.purchase_orders where id=p_purchase_order_id;
  return v_po;
end;
$$;

revoke all on function public.replace_purchase_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) from public,anon,authenticated;
grant execute on function public.replace_purchase_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) to service_role;
