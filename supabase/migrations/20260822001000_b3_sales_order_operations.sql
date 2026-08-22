-- B3.3 · Operaciones transaccionales de Sales Orders
-- La UI/API nunca construye una SO por escrituras parciales.

create or replace function public.populate_sales_order_items(
  p_sales_order_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
set search_path = public
as $function$
declare
  v_line jsonb;
  v_product record;
  v_quantity numeric;
  v_pallets numeric;
  v_units_per_pallet numeric;
  v_unit_price numeric;
begin
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'SO_HAS_NO_ITEMS';
  end if;

  perform 1 from public.sales_orders where id=p_sales_order_id and status='draft';
  if not found then raise exception 'SO_NOT_DRAFT'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'SO_ITEM_INVALID'; end if;

    select id, unit, default_units_per_pallet, active
      into v_product
    from public.products
    where id = nullif(btrim(v_line->>'product_id'),'')::uuid;

    if not found then raise exception 'SO_PRODUCT_NOT_FOUND'; end if;
    if v_product.active is not true then raise exception 'SO_PRODUCT_INACTIVE'; end if;

    v_quantity := coalesce(nullif(btrim(v_line->>'ordered_quantity'),'')::numeric,0);
    v_pallets := coalesce(nullif(btrim(v_line->>'ordered_pallets'),'')::numeric,0);
    v_units_per_pallet := coalesce(nullif(btrim(v_line->>'units_per_pallet'),'')::numeric,v_product.default_units_per_pallet);
    v_unit_price := coalesce(nullif(btrim(v_line->>'unit_price'),'')::numeric,0);

    if v_quantity < 0 or v_pallets < 0 then raise exception 'SO_QUANTITY_INVALID'; end if;
    if v_units_per_pallet is not null and v_units_per_pallet <= 0 then raise exception 'SO_UNITS_PER_PALLET_INVALID'; end if;
    if v_unit_price < 0 then raise exception 'SO_UNIT_PRICE_INVALID'; end if;

    if v_quantity = 0 and v_pallets > 0 and v_units_per_pallet is not null then
      v_quantity := v_pallets * v_units_per_pallet;
    end if;
    if v_quantity <= 0 then raise exception 'SO_QUANTITY_REQUIRED'; end if;

    insert into public.sales_order_items(
      sales_order_id, product_id, ordered_quantity, ordered_pallets,
      unit, units_per_pallet, unit_price, notes
    ) values (
      p_sales_order_id, v_product.id, v_quantity, v_pallets,
      v_product.unit, v_units_per_pallet, v_unit_price,
      nullif(btrim(v_line->>'notes'),'')
    );
  end loop;
end;
$function$;

create or replace function public.create_sales_order_plan(
  p_client_id uuid,
  p_lines jsonb,
  p_importer_id uuid default null,
  p_order_date date default current_date,
  p_requested_at timestamptz default null,
  p_currency text default 'USD',
  p_customer_reference text default null,
  p_notes text default null,
  p_actor uuid default null
)
returns public.sales_orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_so public.sales_orders;
  v_currency text := upper(btrim(coalesce(p_currency,'USD')));
begin
  if p_client_id is null then raise exception 'SO_CLIENT_REQUIRED'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'SO_CURRENCY_INVALID'; end if;

  insert into public.sales_orders(
    client_id, importer_id, order_date, requested_at, currency,
    customer_reference, notes, created_by
  ) values (
    p_client_id, p_importer_id, coalesce(p_order_date,current_date), p_requested_at, v_currency,
    nullif(btrim(p_customer_reference),''), nullif(btrim(p_notes),''), p_actor
  ) returning * into v_so;

  perform public.populate_sales_order_items(v_so.id,p_lines);
  select * into v_so from public.sales_orders where id=v_so.id;
  return v_so;
end;
$function$;

create or replace function public.replace_sales_order_plan(
  p_sales_order_id uuid,
  p_client_id uuid,
  p_lines jsonb,
  p_importer_id uuid default null,
  p_order_date date default current_date,
  p_requested_at timestamptz default null,
  p_currency text default 'USD',
  p_customer_reference text default null,
  p_notes text default null
)
returns public.sales_orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_so public.sales_orders;
  v_currency text := upper(btrim(coalesce(p_currency,'USD')));
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  if v_so.status <> 'draft' then raise exception 'SO_NOT_DRAFT'; end if;
  if p_client_id is null then raise exception 'SO_CLIENT_REQUIRED'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'SO_CURRENCY_INVALID'; end if;

  delete from public.sales_order_items where sales_order_id=p_sales_order_id;

  update public.sales_orders
  set client_id=p_client_id,
      importer_id=p_importer_id,
      order_date=coalesce(p_order_date,current_date),
      requested_at=p_requested_at,
      currency=v_currency,
      customer_reference=nullif(btrim(p_customer_reference),''),
      notes=nullif(btrim(p_notes),'')
  where id=p_sales_order_id;

  perform public.populate_sales_order_items(p_sales_order_id,p_lines);
  select * into v_so from public.sales_orders where id=p_sales_order_id;
  return v_so;
end;
$function$;

create or replace function public.transition_sales_order(
  p_sales_order_id uuid,
  p_action text
)
returns public.sales_orders
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_so public.sales_orders;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_target text;
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;

  if v_action='confirm' then
    if v_so.status <> 'draft' then raise exception 'SO_NOT_DRAFT'; end if;
    v_target := 'confirmed';
  elsif v_action='cancel' then
    if v_so.status not in ('draft','confirmed') then raise exception 'SO_CANNOT_CANCEL'; end if;
    v_target := 'cancelled';
  elsif v_action='close' then
    if v_so.status <> 'confirmed' then raise exception 'SO_CANNOT_CLOSE'; end if;
    v_target := 'closed';
  else
    raise exception 'SO_ACTION_INVALID';
  end if;

  update public.sales_orders set status=v_target where id=v_so.id;
  select * into v_so from public.sales_orders where id=v_so.id;
  return v_so;
end;
$function$;

-- Mutaciones solo mediante RPCs transaccionales.
revoke insert, update, delete on table public.sales_orders from service_role;
revoke insert, update, delete on table public.sales_order_items from service_role;
grant select on table public.sales_orders to service_role;
grant select on table public.sales_order_items to service_role;

revoke all on function public.populate_sales_order_items(uuid,jsonb) from public,anon,authenticated;
revoke all on function public.create_sales_order_plan(uuid,jsonb,uuid,date,timestamptz,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.replace_sales_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) from public,anon,authenticated;
revoke all on function public.transition_sales_order(uuid,text) from public,anon,authenticated;

grant execute on function public.create_sales_order_plan(uuid,jsonb,uuid,date,timestamptz,text,text,text,uuid) to service_role;
grant execute on function public.replace_sales_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) to service_role;
grant execute on function public.transition_sales_order(uuid,text) to service_role;

comment on function public.create_sales_order_plan(uuid,jsonb,uuid,date,timestamptz,text,text,text,uuid) is 'Crea atómicamente cabecera y líneas de una Sales Order.';
comment on function public.replace_sales_order_plan(uuid,uuid,jsonb,uuid,date,timestamptz,text,text,text) is 'Reemplaza atómicamente una Sales Order mientras está en draft.';
comment on function public.transition_sales_order(uuid,text) is 'Ejecuta lifecycle comercial controlado: confirm, cancel, close.';
