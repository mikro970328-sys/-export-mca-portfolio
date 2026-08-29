create or replace function public.validate_load_shipment_link()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
  v_active boolean;
  v_delivered_at timestamptz;
  v_released_at timestamptz;
  v_discharged_at timestamptz;
begin
  if tg_op = 'UPDATE' and new.shipment_id is not distinct from old.shipment_id then
    return new;
  end if;

  v_status := case when tg_op = 'INSERT' then new.status else old.status end;
  if v_status not in ('draft','reserved','loading','loaded') then
    raise exception 'LOAD_SHIPMENT_LOCKED_BY_STATUS';
  end if;

  if new.shipment_id is null then
    return new;
  end if;

  select active, delivered_at, released_at, discharged_at
    into v_active, v_delivered_at, v_released_at, v_discharged_at
  from public.shipments
  where id = new.shipment_id
  for update;

  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;
  if v_active is not true or v_delivered_at is not null or v_released_at is not null or v_discharged_at is not null then
    raise exception 'SHIPMENT_NOT_ELIGIBLE_FOR_LOAD';
  end if;

  return new;
end;
$function$;
