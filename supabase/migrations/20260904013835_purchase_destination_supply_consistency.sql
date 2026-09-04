-- Una compra destinada a almacén sólo puede abastecer una ruta de almacén.
-- Una compra sin almacén sólo puede abastecer una ruta Direct Ship.

create or replace function public.validate_sales_procurement_purchase_destination()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_supply_method text;
  v_supply_warehouse_id uuid;
  v_purchase_warehouse_id uuid;
begin
  select spl.supply_method,spl.warehouse_id,po.warehouse_id
  into v_supply_method,v_supply_warehouse_id,v_purchase_warehouse_id
  from public.sales_supply_plan_lines spl
  join public.purchase_order_items poi on poi.id=new.purchase_order_item_id
  join public.purchase_orders po on po.id=poi.purchase_order_id
  where spl.id=new.supply_plan_line_id;

  if not found then return new; end if;

  if v_supply_method='purchase_direct' and v_purchase_warehouse_id is not null then
    raise exception 'SUPPLY_DIRECT_PO_HAS_WAREHOUSE';
  end if;

  if v_supply_method='purchase_warehouse' then
    if v_purchase_warehouse_id is null then
      raise exception 'SUPPLY_WAREHOUSE_PO_REQUIRED';
    end if;
    if v_purchase_warehouse_id is distinct from v_supply_warehouse_id then
      raise exception 'SUPPLY_PO_WAREHOUSE_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists sales_procurement_allocations_destination_consistency
on public.sales_procurement_allocations;

create trigger sales_procurement_allocations_destination_consistency
before insert or update of supply_plan_line_id,purchase_order_item_id
on public.sales_procurement_allocations
for each row execute function public.validate_sales_procurement_purchase_destination();

create or replace function public.guard_purchase_order_supply_context()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
begin
  if new.warehouse_id is not distinct from old.warehouse_id then return new; end if;

  if exists (
    select 1
    from public.purchase_order_items poi
    join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id
    join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
    where poi.purchase_order_id=old.id
      and (
        (spl.supply_method='purchase_direct' and new.warehouse_id is not null)
        or (
          spl.supply_method='purchase_warehouse'
          and (
            new.warehouse_id is null
            or new.warehouse_id is distinct from spl.warehouse_id
          )
        )
      )
  ) then
    raise exception 'PO_WAREHOUSE_CONFLICTS_WITH_SUPPLY_PLAN';
  end if;

  return new;
end;
$$;

revoke execute on function public.validate_sales_procurement_purchase_destination()
from public,anon,authenticated;
revoke execute on function public.guard_purchase_order_supply_context()
from public,anon,authenticated;

grant execute on function public.validate_sales_procurement_purchase_destination()
to service_role;
grant execute on function public.guard_purchase_order_supply_context()
to service_role;

comment on function public.validate_sales_procurement_purchase_destination() is
  'Enforces that warehouse purchase orders only fund warehouse routes and NULL-warehouse purchase orders only fund Direct Ship routes.';
