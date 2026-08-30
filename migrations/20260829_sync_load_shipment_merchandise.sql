create or replace function public.guard_load_linked_shipment_mutation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_load_status text;
  v_sync_mode boolean := coalesce(current_setting('app.load_shipment_sync', true), '') = 'on';
begin
  select status into v_load_status
  from public.loads
  where shipment_id = old.id
  limit 1;

  if v_load_status is null then
    return new;
  end if;

  if not v_sync_mode and (
    new.product is distinct from old.product
    or new.quantity is distinct from old.quantity
    or new.quantity_unit is distinct from old.quantity_unit
  ) then
    raise exception 'LOAD_SHIPMENT_MERCHANDISE_DERIVED';
  end if;

  if v_load_status <> 'dispatched' then
    if new.delivered_at is not null and old.delivered_at is null then raise exception 'LOAD_NOT_DISPATCHED'; end if;
    if new.released_at is not null and old.released_at is null then raise exception 'LOAD_NOT_DISPATCHED'; end if;
    if new.active is false and old.active is true then raise exception 'LOAD_NOT_DISPATCHED'; end if;
  end if;

  return new;
end;
$function$;

create or replace function public.sync_load_shipment_merchandise(p_load_id uuid)
returns public.shipments
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_load public.loads;
  v_shipment public.shipments;
  v_product text;
  v_quantity numeric;
  v_unit text;
begin
  select * into v_load from public.loads where id = p_load_id for update;
  if not found then raise exception 'LOAD_NOT_FOUND'; end if;
  if v_load.shipment_id is null then return null; end if;

  select
    string_agg(distinct p.name, ', ' order by p.name),
    case when count(distinct nullif(btrim(li.unit),'')) <= 1 then sum(li.planned_quantity) else null end,
    case when count(distinct nullif(btrim(li.unit),'')) <= 1 then max(nullif(btrim(li.unit),'')) else null end
  into v_product, v_quantity, v_unit
  from public.load_items li
  join public.products p on p.id = li.product_id
  where li.load_id = p_load_id;

  perform set_config('app.load_shipment_sync', 'on', true);

  update public.shipments
  set product = nullif(v_product,''),
      quantity = v_quantity,
      quantity_unit = v_unit,
      client_id = coalesce(client_id, v_load.client_id),
      importer_id = coalesce(importer_id, v_load.importer_id),
      updated_at = now()
  where id = v_load.shipment_id
  returning * into v_shipment;

  return v_shipment;
end;
$function$;

revoke all on function public.sync_load_shipment_merchandise(uuid) from public, anon, authenticated;
grant execute on function public.sync_load_shipment_merchandise(uuid) to service_role;

do $block$
declare v_id uuid;
begin
  for v_id in select id from public.loads where shipment_id is not null loop
    perform public.sync_load_shipment_merchandise(v_id);
  end loop;
end;
$block$;
