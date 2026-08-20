-- B2.2 · Operaciones transaccionales de Purchase Orders y recepción PO → WR
-- El WR sigue siendo el único hecho físico que entra al inventario.

-- Los WR anulados conservan trazabilidad histórica pero dejan de contar como recibido.
create or replace view public.purchase_order_item_progress
with (security_invoker = true)
as
select
  poi.id as purchase_order_item_id,
  poi.purchase_order_id,
  poi.product_id,
  poi.ordered_quantity,
  poi.ordered_pallets,
  poi.unit,
  poi.units_per_pallet,
  poi.unit_cost,
  poi.currency,
  coalesce(sum(pra.received_quantity) filter (where wr.status = 'received'),0)::numeric as received_quantity,
  coalesce(sum(pra.received_pallets) filter (where wr.status = 'received'),0)::numeric as received_pallets,
  greatest(poi.ordered_quantity - coalesce(sum(pra.received_quantity) filter (where wr.status = 'received'),0),0)::numeric as remaining_quantity,
  greatest(poi.ordered_pallets - coalesce(sum(pra.received_pallets) filter (where wr.status = 'received'),0),0)::numeric as remaining_pallets,
  greatest(coalesce(sum(pra.received_quantity) filter (where wr.status = 'received'),0) - poi.ordered_quantity,0)::numeric as excess_quantity,
  greatest(coalesce(sum(pra.received_pallets) filter (where wr.status = 'received'),0) - poi.ordered_pallets,0)::numeric as excess_pallets,
  case
    when coalesce(sum(pra.received_quantity) filter (where wr.status = 'received'),0) = 0
         and coalesce(sum(pra.received_pallets) filter (where wr.status = 'received'),0) = 0 then 'pending'
    when (poi.ordered_quantity = 0 or coalesce(sum(pra.received_quantity) filter (where wr.status = 'received'),0) >= poi.ordered_quantity)
         and (poi.ordered_pallets = 0 or coalesce(sum(pra.received_pallets) filter (where wr.status = 'received'),0) >= poi.ordered_pallets) then 'received'
    else 'partial'
  end as receipt_status,
  (
    (poi.ordered_quantity > 0 and coalesce(sum(pra.received_quantity) filter (where wr.status = 'received'),0) > poi.ordered_quantity)
    or (poi.ordered_pallets > 0 and coalesce(sum(pra.received_pallets) filter (where wr.status = 'received'),0) > poi.ordered_pallets)
  ) as has_excess
from public.purchase_order_items poi
left join public.purchase_receipt_allocations pra on pra.purchase_order_item_id = poi.id
left join public.warehouse_receipt_items wri on wri.id = pra.receipt_item_id
left join public.warehouse_receipts wr on wr.id = wri.receipt_id
group by poi.id;

create or replace function public.guard_purchase_order_status_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_transition text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'PO_MUST_START_DRAFT';
    end if;
    return new;
  end if;

  if new.status is not distinct from old.status then
    return new;
  end if;

  v_transition := current_setting('export_mca.po_transition', true);

  if old.status = 'draft' and new.status = 'issued' and v_transition = 'issue' then return new; end if;
  if old.status = 'issued' and new.status = 'confirmed' and v_transition = 'confirm' then return new; end if;
  if old.status in ('draft','issued','confirmed') and new.status = 'cancelled' and v_transition = 'cancel' then return new; end if;
  if old.status in ('issued','confirmed') and new.status = 'closed' and v_transition = 'close' then return new; end if;

  raise exception 'INVALID_PO_STATUS_TRANSITION: % -> %', old.status, new.status;
end;
$function$;

create trigger purchase_orders_guard_status_transition_insert
before insert on public.purchase_orders
for each row execute function public.guard_purchase_order_status_transition();

create trigger purchase_orders_guard_status_transition_update
before update of status on public.purchase_orders
for each row execute function public.guard_purchase_order_status_transition();

create or replace function public.guard_purchase_order_item_mutation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_old_status text;
  v_new_status text;
begin
  if tg_op in ('UPDATE','DELETE') then
    select status into v_old_status from public.purchase_orders where id = old.purchase_order_id;
    if v_old_status is distinct from 'draft' then
      raise exception 'PO_ITEMS_LOCKED_BY_STATUS';
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    select status into v_new_status from public.purchase_orders where id = new.purchase_order_id;
    if v_new_status is distinct from 'draft' then
      raise exception 'PO_ITEMS_LOCKED_BY_STATUS';
    end if;
  end if;

  return coalesce(new, old);
end;
$function$;

create trigger purchase_order_items_guard_mutation
before insert or update or delete on public.purchase_order_items
for each row execute function public.guard_purchase_order_item_mutation();

create or replace function public.populate_purchase_order_items(
  p_purchase_order_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
set search_path to 'public'
as $function$
declare
  v_line jsonb;
  v_product record;
  v_currency text;
  v_quantity numeric;
  v_pallets numeric;
  v_units_per_pallet numeric;
  v_unit_cost numeric;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'PO_HAS_NO_ITEMS';
  end if;

  select currency into v_currency
  from public.purchase_orders
  where id = p_purchase_order_id and status = 'draft';

  if not found then
    raise exception 'PO_NOT_DRAFT';
  end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then
      raise exception 'PO_ITEM_INVALID';
    end if;

    select id, unit, default_units_per_pallet, active
      into v_product
    from public.products
    where id = nullif(btrim(v_line->>'product_id'),'')::uuid;

    if not found then raise exception 'PO_PRODUCT_NOT_FOUND'; end if;
    if v_product.active is not true then raise exception 'PO_PRODUCT_INACTIVE'; end if;

    v_quantity := coalesce(nullif(btrim(v_line->>'ordered_quantity'),'')::numeric,0);
    v_pallets := coalesce(nullif(btrim(v_line->>'ordered_pallets'),'')::numeric,0);
    v_units_per_pallet := coalesce(
      nullif(btrim(v_line->>'units_per_pallet'),'')::numeric,
      v_product.default_units_per_pallet
    );
    v_unit_cost := nullif(btrim(v_line->>'unit_cost'),'')::numeric;

    if v_quantity < 0 or v_pallets < 0 then raise exception 'PO_QUANTITY_INVALID'; end if;
    if v_units_per_pallet is not null and v_units_per_pallet <= 0 then raise exception 'PO_UNITS_PER_PALLET_INVALID'; end if;
    if v_unit_cost is not null and v_unit_cost < 0 then raise exception 'PO_UNIT_COST_INVALID'; end if;

    if v_quantity = 0 and v_pallets > 0 and v_units_per_pallet is not null then
      v_quantity := v_pallets * v_units_per_pallet;
    end if;

    if v_quantity <= 0 and v_pallets <= 0 then
      raise exception 'PO_QUANTITY_REQUIRED';
    end if;

    insert into public.purchase_order_items(
      purchase_order_id, product_id, ordered_quantity, ordered_pallets, unit,
      units_per_pallet, unit_cost, currency, notes
    ) values (
      p_purchase_order_id, v_product.id, v_quantity, v_pallets, v_product.unit,
      v_units_per_pallet, v_unit_cost, v_currency, nullif(btrim(v_line->>'notes'),'')
    );
  end loop;
end;
$function$;

create or replace function public.create_purchase_order_plan(
  p_supplier_id uuid,
  p_lines jsonb,
  p_warehouse_id uuid default null,
  p_order_date date default current_date,
  p_expected_at timestamptz default null,
  p_currency text default 'USD',
  p_supplier_reference text default null,
  p_notes text default null,
  p_actor uuid default null
)
returns public.purchase_orders
language plpgsql
set search_path to 'public'
as $function$
declare
  v_po public.purchase_orders;
  v_currency text := upper(btrim(coalesce(p_currency,'USD')));
  v_active boolean;
begin
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'PO_CURRENCY_INVALID'; end if;

  select active into v_active from public.suppliers where id = p_supplier_id;
  if not found then raise exception 'PO_SUPPLIER_NOT_FOUND'; end if;
  if v_active is not true then raise exception 'PO_SUPPLIER_INACTIVE'; end if;

  if p_warehouse_id is not null then
    select active into v_active from public.warehouses where id = p_warehouse_id;
    if not found then raise exception 'PO_WAREHOUSE_NOT_FOUND'; end if;
    if v_active is not true then raise exception 'PO_WAREHOUSE_INACTIVE'; end if;
  end if;

  insert into public.purchase_orders(
    supplier_id, warehouse_id, order_date, expected_at, currency,
    supplier_reference, notes, created_by
  ) values (
    p_supplier_id, p_warehouse_id, coalesce(p_order_date,current_date), p_expected_at, v_currency,
    nullif(btrim(p_supplier_reference),''), nullif(btrim(p_notes),''), p_actor
  ) returning * into v_po;

  perform public.populate_purchase_order_items(v_po.id, p_lines);
  select * into v_po from public.purchase_orders where id = v_po.id;
  return v_po;
end;
$function$;

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
set search_path to 'public'
as $function$
declare
  v_po public.purchase_orders;
  v_currency text := upper(btrim(coalesce(p_currency,'USD')));
  v_active boolean;
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;
  if v_po.status <> 'draft' then raise exception 'PO_NOT_DRAFT'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'PO_CURRENCY_INVALID'; end if;

  select active into v_active from public.suppliers where id = p_supplier_id;
  if not found then raise exception 'PO_SUPPLIER_NOT_FOUND'; end if;
  if v_active is not true then raise exception 'PO_SUPPLIER_INACTIVE'; end if;

  if p_warehouse_id is not null then
    select active into v_active from public.warehouses where id = p_warehouse_id;
    if not found then raise exception 'PO_WAREHOUSE_NOT_FOUND'; end if;
    if v_active is not true then raise exception 'PO_WAREHOUSE_INACTIVE'; end if;
  end if;

  delete from public.purchase_order_items where purchase_order_id = p_purchase_order_id;

  update public.purchase_orders
  set supplier_id = p_supplier_id,
      warehouse_id = p_warehouse_id,
      order_date = coalesce(p_order_date,current_date),
      expected_at = p_expected_at,
      currency = v_currency,
      supplier_reference = nullif(btrim(p_supplier_reference),''),
      notes = nullif(btrim(p_notes),'')
  where id = p_purchase_order_id;

  perform public.populate_purchase_order_items(p_purchase_order_id, p_lines);
  select * into v_po from public.purchase_orders where id = p_purchase_order_id;
  return v_po;
end;
$function$;

create or replace function public.transition_purchase_order(
  p_purchase_order_id uuid,
  p_action text
)
returns public.purchase_orders
language plpgsql
set search_path to 'public'
as $function$
declare
  v_po public.purchase_orders;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_target text;
  v_active boolean;
begin
  select * into v_po from public.purchase_orders where id = p_purchase_order_id for update;
  if not found then raise exception 'PO_NOT_FOUND'; end if;

  if v_action = 'issue' then
    if v_po.status <> 'draft' then raise exception 'PO_NOT_DRAFT'; end if;
    if not exists (select 1 from public.purchase_order_items where purchase_order_id = v_po.id) then raise exception 'PO_HAS_NO_ITEMS'; end if;
    select active into v_active from public.suppliers where id = v_po.supplier_id;
    if v_active is not true then raise exception 'PO_SUPPLIER_INACTIVE'; end if;
    if v_po.warehouse_id is not null then
      select active into v_active from public.warehouses where id = v_po.warehouse_id;
      if v_active is not true then raise exception 'PO_WAREHOUSE_INACTIVE'; end if;
    end if;
    if exists (
      select 1 from public.purchase_order_items poi
      join public.products p on p.id = poi.product_id
      where poi.purchase_order_id = v_po.id and p.active is not true
    ) then raise exception 'PO_HAS_INACTIVE_PRODUCT'; end if;
    v_target := 'issued';
  elsif v_action = 'confirm' then
    if v_po.status <> 'issued' then raise exception 'PO_NOT_ISSUED'; end if;
    v_target := 'confirmed';
  elsif v_action = 'cancel' then
    if v_po.status not in ('draft','issued','confirmed') then raise exception 'PO_CANNOT_CANCEL'; end if;
    if exists (
      select 1
      from public.purchase_order_items poi
      join public.purchase_receipt_allocations pra on pra.purchase_order_item_id = poi.id
      join public.warehouse_receipt_items wri on wri.id = pra.receipt_item_id
      join public.warehouse_receipts wr on wr.id = wri.receipt_id
      where poi.purchase_order_id = v_po.id and wr.status = 'received'
    ) then raise exception 'PO_HAS_ACTIVE_RECEIPTS'; end if;
    v_target := 'cancelled';
  elsif v_action = 'close' then
    if v_po.status not in ('issued','confirmed') then raise exception 'PO_CANNOT_CLOSE'; end if;
    v_target := 'closed';
  else
    raise exception 'PO_ACTION_INVALID';
  end if;

  perform set_config('export_mca.po_transition', v_action, true);
  update public.purchase_orders set status = v_target where id = v_po.id;
  select * into v_po from public.purchase_orders where id = v_po.id;
  return v_po;
end;
$function$;

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
set search_path to 'public'
as $function$
declare
  v_line jsonb;
  v_item_id uuid;
  v_item record;
  v_po record;
  v_supplier_id uuid;
  v_supplier_name text;
  v_po_numbers text[] := array[]::text[];
  v_reference_number text;
  v_warehouse_active boolean;
  v_receipt public.warehouse_receipts;
  v_receipt_item_id uuid;
  v_quantity numeric;
  v_pallets numeric;
  v_units_per_pallet numeric;
  v_net_weight numeric;
  v_gross_weight numeric;
  v_existing_quantity numeric;
  v_existing_pallets numeric;
begin
  if p_warehouse_id is null then raise exception 'WAREHOUSE_REQUIRED'; end if;
  select active into v_warehouse_active from public.warehouses where id = p_warehouse_id;
  if not found then raise exception 'PO_WAREHOUSE_NOT_FOUND'; end if;
  if v_warehouse_active is not true then raise exception 'PO_WAREHOUSE_INACTIVE'; end if;

  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'PO_RECEIPT_HAS_NO_ITEMS';
  end if;

  -- Lock commercial headers first, then item rows, always in deterministic order.
  for v_item_id in
    select distinct poi.purchase_order_id
    from jsonb_array_elements(p_lines) line
    join public.purchase_order_items poi on poi.id = nullif(btrim(line->>'purchase_order_item_id'),'')::uuid
    order by poi.purchase_order_id
  loop
    perform 1 from public.purchase_orders where id = v_item_id for update;
  end loop;

  for v_item_id in
    select distinct nullif(btrim(line->>'purchase_order_item_id'),'')::uuid
    from jsonb_array_elements(p_lines) line
    order by 1
  loop
    perform 1 from public.purchase_order_items where id = v_item_id for update;
    if not found then raise exception 'PO_ITEM_NOT_FOUND'; end if;
  end loop;

  -- Validate all referenced POs before creating the physical WR.
  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'PO_RECEIPT_ITEM_INVALID'; end if;
    v_item_id := nullif(btrim(v_line->>'purchase_order_item_id'),'')::uuid;

    select poi.*, po.supplier_id as po_supplier_id, po.warehouse_id as po_warehouse_id,
           po.status as po_status, po.po_number
      into v_item
    from public.purchase_order_items poi
    join public.purchase_orders po on po.id = poi.purchase_order_id
    where poi.id = v_item_id;

    if not found then raise exception 'PO_ITEM_NOT_FOUND'; end if;
    if v_item.po_status not in ('issued','confirmed') then raise exception 'PO_NOT_RECEIVABLE'; end if;
    if v_item.po_warehouse_id is not null and v_item.po_warehouse_id <> p_warehouse_id then raise exception 'PO_WR_WAREHOUSE_MISMATCH'; end if;

    if v_supplier_id is null then
      v_supplier_id := v_item.po_supplier_id;
      select name into v_supplier_name from public.suppliers where id = v_supplier_id;
      if not found then raise exception 'PO_SUPPLIER_NOT_FOUND'; end if;
    elsif v_supplier_id <> v_item.po_supplier_id then
      raise exception 'PO_RECEIPT_MULTIPLE_SUPPLIERS';
    end if;

    if not (v_item.po_number = any(v_po_numbers)) then
      v_po_numbers := array_append(v_po_numbers, v_item.po_number);
    end if;
  end loop;

  v_reference_number := coalesce(nullif(btrim(p_reference_number),''), array_to_string(v_po_numbers, ', '));

  insert into public.warehouse_receipts(
    warehouse_id, supplier_id, supplier_name, received_at, truck_reference,
    driver_name, reference_number, notes, created_by
  ) values (
    p_warehouse_id, v_supplier_id, v_supplier_name, coalesce(p_received_at,now()),
    nullif(btrim(p_truck_reference),''), nullif(btrim(p_driver_name),''),
    v_reference_number, nullif(btrim(p_notes),''), p_actor
  ) returning * into v_receipt;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    v_item_id := nullif(btrim(v_line->>'purchase_order_item_id'),'')::uuid;

    select * into v_item from public.purchase_order_items where id = v_item_id;

    v_quantity := coalesce(nullif(btrim(v_line->>'received_quantity'),'')::numeric,0);
    v_pallets := coalesce(nullif(btrim(v_line->>'received_pallets'),'')::numeric,0);
    v_units_per_pallet := coalesce(
      nullif(btrim(v_line->>'units_per_pallet'),'')::numeric,
      v_item.units_per_pallet
    );
    v_net_weight := nullif(btrim(v_line->>'net_weight_kg'),'')::numeric;
    v_gross_weight := nullif(btrim(v_line->>'gross_weight_kg'),'')::numeric;

    if v_quantity < 0 or v_pallets < 0 then raise exception 'PO_RECEIPT_QUANTITY_INVALID'; end if;
    if v_units_per_pallet is not null and v_units_per_pallet <= 0 then raise exception 'PO_UNITS_PER_PALLET_INVALID'; end if;
    if v_net_weight is not null and v_net_weight < 0 then raise exception 'WR_NET_WEIGHT_INVALID'; end if;
    if v_gross_weight is not null and v_gross_weight < 0 then raise exception 'WR_GROSS_WEIGHT_INVALID'; end if;
    if v_net_weight is not null and v_gross_weight is not null and v_gross_weight < v_net_weight then raise exception 'WR_GROSS_WEIGHT_LT_NET'; end if;

    if v_quantity = 0 and v_pallets > 0 and v_units_per_pallet is not null then
      v_quantity := v_pallets * v_units_per_pallet;
    end if;

    if v_quantity <= 0 then raise exception 'PO_RECEIPT_QUANTITY_REQUIRED'; end if;

    select
      coalesce(sum(pra.received_quantity) filter (where wr.status = 'received'),0),
      coalesce(sum(pra.received_pallets) filter (where wr.status = 'received'),0)
      into v_existing_quantity, v_existing_pallets
    from public.purchase_receipt_allocations pra
    join public.warehouse_receipt_items wri on wri.id = pra.receipt_item_id
    join public.warehouse_receipts wr on wr.id = wri.receipt_id
    where pra.purchase_order_item_id = v_item_id;

    if p_allow_over_receipt is not true and (
      (v_item.ordered_quantity > 0 and v_existing_quantity + v_quantity > v_item.ordered_quantity)
      or (v_item.ordered_pallets > 0 and v_existing_pallets + v_pallets > v_item.ordered_pallets)
    ) then
      raise exception 'PO_OVER_RECEIPT_REQUIRES_CONFIRMATION';
    end if;

    insert into public.warehouse_receipt_items(
      receipt_id, product_id, pallets, quantity, unit, units_per_pallet,
      net_weight_kg, gross_weight_kg, unit_cost, currency, lot_number, notes
    ) values (
      v_receipt.id, v_item.product_id, v_pallets, v_quantity, v_item.unit, v_units_per_pallet,
      v_net_weight, v_gross_weight, v_item.unit_cost, v_item.currency,
      nullif(btrim(v_line->>'lot_number'),''), nullif(btrim(v_line->>'notes'),'')
    ) returning id into v_receipt_item_id;

    insert into public.purchase_receipt_allocations(
      purchase_order_item_id, receipt_item_id, received_quantity, received_pallets, created_by
    ) values (
      v_item_id, v_receipt_item_id, v_quantity, v_pallets, p_actor
    );
  end loop;

  return v_receipt;
end;
$function$;

-- RPCs operativos: solo backend service_role.
revoke execute on function public.populate_purchase_order_items(uuid,jsonb) from public, anon, authenticated;
revoke execute on function public.create_purchase_order_plan(uuid,jsonb,uuid,date,timestamptz,text,text,text,uuid) from public, anon, authenticated;
revoke execute on function public.replace_purchase_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) from public, anon, authenticated;
revoke execute on function public.transition_purchase_order(uuid,text) from public, anon, authenticated;
revoke execute on function public.receive_purchase_order_lines(uuid,jsonb,timestamptz,text,text,text,text,boolean,uuid) from public, anon, authenticated;

grant execute on function public.populate_purchase_order_items(uuid,jsonb) to service_role;
grant execute on function public.create_purchase_order_plan(uuid,jsonb,uuid,date,timestamptz,text,text,text,uuid) to service_role;
grant execute on function public.replace_purchase_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) to service_role;
grant execute on function public.transition_purchase_order(uuid,text) to service_role;
grant execute on function public.receive_purchase_order_lines(uuid,jsonb,timestamptz,text,text,text,text,boolean,uuid) to service_role;

comment on function public.create_purchase_order_plan is 'Crea cabecera y líneas de PO atómicamente. No crea inventario.';
comment on function public.replace_purchase_order_plan is 'Reemplaza una PO en borrador de forma atómica.';
comment on function public.transition_purchase_order is 'Único propietario de transiciones comerciales de Purchase Order.';
comment on function public.receive_purchase_order_lines is 'Crea un único WR físico y allocations desde una o varias POs del mismo proveedor, de forma atómica.';
