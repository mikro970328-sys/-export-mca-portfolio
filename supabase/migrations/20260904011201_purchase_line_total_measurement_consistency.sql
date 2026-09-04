-- Compras por costo unitario o valor total, con medidas coherentes entre
-- cantidad, pallets y unidades por pallet.

alter table public.purchase_order_items
  add column if not exists entered_line_total numeric;

alter table public.purchase_order_items
  drop constraint if exists purchase_order_items_entered_line_total_nonnegative;

alter table public.purchase_order_items
  add constraint purchase_order_items_entered_line_total_nonnegative
  check (entered_line_total is null or entered_line_total >= 0);

comment on column public.purchase_order_items.entered_line_total is
  'Exact purchase line total entered by the user. NULL means ordered_quantity * unit_cost is authoritative.';

-- Reparación puntual y verificable del registro creado para HUE840. La
-- cantidad física y comercial siempre fue 840 cajas en 28 pallets; el valor
-- 60 quedó heredado como unidades por pallet y duplicó la cantidad del cargue.
alter table public.purchase_order_items disable trigger purchase_order_items_guard_mutation;

update public.purchase_order_items poi
set units_per_pallet = poi.ordered_quantity / nullif(poi.ordered_pallets,0),
    unit = p.unit
from public.purchase_orders po,
     public.products p
where po.id = poi.purchase_order_id
  and p.id = poi.product_id
  and po.po_number = 'PO-0008'
  and p.sku = 'HUE840'
  and poi.ordered_quantity = 840
  and poi.ordered_pallets = 28
  and poi.units_per_pallet = 60;

alter table public.purchase_order_items enable trigger purchase_order_items_guard_mutation;

update public.warehouse_receipt_items wri
set units_per_pallet = wri.quantity / nullif(wri.pallets,0),
    unit = p.unit
from public.warehouse_receipts wr,
     public.products p
where wr.id = wri.receipt_id
  and p.id = wri.product_id
  and wr.receipt_number = 'WR-0007'
  and p.sku = 'HUE840'
  and wri.quantity = 840
  and wri.pallets = 28
  and wri.units_per_pallet = 60;

update public.load_allocations la
set allocated_quantity = la.allocated_pallets * wri.units_per_pallet,
    updated_at = now()
from public.load_items li,
     public.loads l,
     public.warehouse_receipt_items wri,
     public.warehouse_receipts wr
where li.id = la.load_item_id
  and l.id = li.load_id
  and wri.id = la.receipt_item_id
  and wr.id = wri.receipt_id
  and l.load_number = 'CG-0009'
  and l.status = 'draft'
  and wr.receipt_number = 'WR-0007'
  and la.allocated_quantity = 1680
  and la.allocated_pallets = 28
  and wri.quantity = 840
  and wri.pallets = 28
  and wri.units_per_pallet = 30;

update public.load_items li
set planned_quantity = totals.allocated_quantity,
    planned_pallets = totals.allocated_pallets,
    unit = p.unit,
    updated_at = now()
from (
  select la.load_item_id,
         sum(la.allocated_quantity) as allocated_quantity,
         sum(la.allocated_pallets) as allocated_pallets
  from public.load_allocations la
  group by la.load_item_id
) totals,
public.loads l,
public.products p
where totals.load_item_id = li.id
  and l.id = li.load_id
  and p.id = li.product_id
  and l.load_number = 'CG-0009'
  and l.status = 'draft';

update public.loads
set updated_at = now()
where load_number = 'CG-0009'
  and status = 'draft';

insert into public.audit_log(action,entity_type,entity_id,details)
select 'load_measurement_reconciled','load',l.id,
       jsonb_build_object(
         'load_number',l.load_number,
         'purchase_order','PO-0008',
         'warehouse_receipt','WR-0007',
         'quantity',840,
         'pallets',28,
         'units_per_pallet',30,
         'reason','Reconciled duplicated quantity caused by inconsistent units_per_pallet metadata.'
       )
from public.loads l
where l.load_number = 'CG-0009';

create or replace function public.validate_purchase_order_item_measurements()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if new.ordered_quantity > 0
     and new.ordered_pallets > 0
     and new.units_per_pallet is not null
     and abs(new.ordered_quantity - (new.ordered_pallets * new.units_per_pallet)) > 0.000001 then
    raise exception 'PO_QUANTITY_PALLET_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists purchase_order_items_measurement_consistency on public.purchase_order_items;
create trigger purchase_order_items_measurement_consistency
before insert or update of ordered_quantity,ordered_pallets,units_per_pallet
on public.purchase_order_items
for each row execute function public.validate_purchase_order_item_measurements();

create or replace function public.validate_warehouse_receipt_item_measurements()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if new.quantity > 0
     and new.pallets > 0
     and new.units_per_pallet is not null
     and abs(new.quantity - (new.pallets * new.units_per_pallet)) > 0.000001 then
    raise exception 'WR_QUANTITY_PALLET_MISMATCH';
  end if;
  return new;
end;
$$;

drop trigger if exists warehouse_receipt_items_measurement_consistency on public.warehouse_receipt_items;
create trigger warehouse_receipt_items_measurement_consistency
before insert or update of quantity,pallets,units_per_pallet
on public.warehouse_receipt_items
for each row execute function public.validate_warehouse_receipt_item_measurements();

create or replace function public.normalize_load_allocation_quantity()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_units_per_pallet numeric;
begin
  new.allocated_quantity := coalesce(new.allocated_quantity,0);
  new.allocated_pallets := coalesce(new.allocated_pallets,0);

  if new.allocated_quantity < 0 or new.allocated_pallets < 0 then
    raise exception 'LOAD_QUANTITY_INVALID';
  end if;

  if new.allocated_pallets > 0 then
    select units_per_pallet into v_units_per_pallet
    from public.warehouse_receipt_items
    where id = new.receipt_item_id;

    if new.allocated_quantity = 0 then
      if coalesce(v_units_per_pallet,0) <= 0 then
        raise exception 'LOAD_QUANTITY_REQUIRED_FOR_PALLETS';
      end if;
      new.allocated_quantity := new.allocated_pallets * v_units_per_pallet;
    elsif v_units_per_pallet is not null
          and abs(new.allocated_quantity - (new.allocated_pallets * v_units_per_pallet)) > 0.000001 then
      raise exception 'LOAD_QUANTITY_PALLET_MISMATCH';
    end if;
  end if;

  if new.allocated_quantity = 0 and new.allocated_pallets = 0 then
    raise exception 'LOAD_QUANTITY_REQUIRED';
  end if;

  return new;
end;
$$;

create or replace function public.populate_purchase_order_items(
  p_purchase_order_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_line jsonb;
  v_product record;
  v_currency text;
  v_quantity numeric;
  v_pallets numeric;
  v_units_per_pallet numeric;
  v_unit_cost numeric;
  v_line_total numeric;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'PO_HAS_NO_ITEMS';
  end if;

  select currency into v_currency
  from public.purchase_orders
  where id = p_purchase_order_id and status = 'draft';
  if not found then raise exception 'PO_NOT_DRAFT'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'PO_ITEM_INVALID'; end if;

    select id,unit,default_units_per_pallet,active
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
    v_line_total := nullif(btrim(v_line->>'line_total'),'')::numeric;

    if v_quantity < 0 or v_pallets < 0 then raise exception 'PO_QUANTITY_INVALID'; end if;
    if v_units_per_pallet is not null and v_units_per_pallet <= 0 then raise exception 'PO_UNITS_PER_PALLET_INVALID'; end if;
    if v_quantity = 0 and v_pallets > 0 and v_units_per_pallet is not null then
      v_quantity := v_pallets * v_units_per_pallet;
    end if;
    if v_quantity <= 0 and v_pallets <= 0 then raise exception 'PO_QUANTITY_REQUIRED'; end if;
    if v_quantity > 0 and v_pallets > 0 and v_units_per_pallet is not null
       and abs(v_quantity - (v_pallets * v_units_per_pallet)) > 0.000001 then
      raise exception 'PO_QUANTITY_PALLET_MISMATCH';
    end if;

    if v_line_total is not null then
      if v_line_total < 0 then raise exception 'PO_LINE_TOTAL_INVALID'; end if;
      if v_quantity <= 0 then raise exception 'PO_LINE_TOTAL_REQUIRES_QUANTITY'; end if;
      v_unit_cost := v_line_total / v_quantity;
    elsif v_unit_cost is not null and v_unit_cost < 0 then
      raise exception 'PO_UNIT_COST_INVALID';
    end if;

    insert into public.purchase_order_items(
      purchase_order_id,product_id,ordered_quantity,ordered_pallets,unit,
      units_per_pallet,unit_cost,entered_line_total,currency,notes
    ) values (
      p_purchase_order_id,v_product.id,v_quantity,v_pallets,v_product.unit,
      v_units_per_pallet,v_unit_cost,v_line_total,v_currency,nullif(btrim(v_line->>'notes'),'')
    );
  end loop;
end;
$$;

revoke execute on function public.validate_purchase_order_item_measurements() from public,anon,authenticated;
revoke execute on function public.validate_warehouse_receipt_item_measurements() from public,anon,authenticated;
revoke execute on function public.normalize_load_allocation_quantity() from public,anon,authenticated;
revoke execute on function public.populate_purchase_order_items(uuid,jsonb) from public,anon,authenticated;

grant execute on function public.validate_purchase_order_item_measurements() to service_role;
grant execute on function public.validate_warehouse_receipt_item_measurements() to service_role;
grant execute on function public.normalize_load_allocation_quantity() to service_role;
grant execute on function public.populate_purchase_order_items(uuid,jsonb) to service_role;

comment on function public.populate_purchase_order_items(uuid,jsonb) is
  'Creates Purchase Order lines from unit cost or an exact entered line total.';
