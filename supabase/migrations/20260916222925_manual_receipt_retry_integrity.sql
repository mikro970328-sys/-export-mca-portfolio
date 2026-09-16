-- A manual receipt is one physical delivery, even when HTTP confirmation is lost.
-- Existing receipts and purchase-order receiving retain their original identities.
alter table public.warehouse_receipts
  add column registration_request_id uuid,
  add column registration_request_payload jsonb,
  add constraint warehouse_receipts_registration_request_pair check (
    (registration_request_id is null) = (registration_request_payload is null)
  );
create unique index warehouse_receipts_registration_request_unique
  on public.warehouse_receipts(registration_request_id) where registration_request_id is not null;

create function public.guard_warehouse_receipt_request_identity()
returns trigger language plpgsql set search_path=public,pg_temp as $function$
begin
  if tg_op='DELETE' then
    if old.registration_request_id is not null then raise exception 'WR_REQUEST_IDENTITY_IMMUTABLE'; end if;
    return old;
  end if;
  if new.registration_request_id is distinct from old.registration_request_id
    or new.registration_request_payload is distinct from old.registration_request_payload then
    raise exception 'WR_REQUEST_IDENTITY_IMMUTABLE';
  end if;
  return new;
end;
$function$;
create trigger warehouse_receipts_request_identity
before update or delete on public.warehouse_receipts
for each row execute function public.guard_warehouse_receipt_request_identity();
revoke all on function public.guard_warehouse_receipt_request_identity() from public,anon,authenticated;

create function public.create_warehouse_receipt_canonical(
  p_payload jsonb,p_actor uuid,p_request_id uuid
) returns jsonb language plpgsql security definer
set search_path=public,pg_temp as $function$
declare
  v_receipt public.warehouse_receipts;
  v_product public.products;
  v_supplier public.suppliers;
  v_warehouse uuid;
  v_supplier_id uuid;
  v_received_at timestamptz;
  v_payload jsonb;
  v_line jsonb;
  v_index integer:=0;
  v_product_id uuid;
  v_mode text;
  v_pallets numeric;
  v_units numeric;
  v_quantity numeric;
  v_net numeric;
  v_gross numeric;
  v_cost numeric;
  v_unit text;
  v_items jsonb;
begin
  if not public.admin_actor_has_permission(p_actor,'warehouse.write') then
    raise exception 'PERMISSION_REQUIRED';
  end if;
  if p_request_id is null then raise exception 'WR_REQUEST_ID_REQUIRED'; end if;
  if jsonb_typeof(p_payload) is distinct from 'object' then raise exception 'WR_PAYLOAD_INVALID'; end if;
  v_payload:=jsonb_build_object('actor',p_actor,'receipt',p_payload);
  perform pg_advisory_xact_lock(hashtextextended('manual-receipt:'||p_request_id::text,0));
  select * into v_receipt from public.warehouse_receipts where registration_request_id=p_request_id;
  if found then
    if v_receipt.registration_request_payload is distinct from v_payload then
      raise exception 'WR_REQUEST_CONFLICT';
    end if;
    -- Replays preserve the original receipt, including its later cancellation.
    select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at,i.id),'[]'::jsonb)
      into v_items from public.warehouse_receipt_items i where i.receipt_id=v_receipt.id;
    return (to_jsonb(v_receipt)-'registration_request_payload')||jsonb_build_object('items',v_items);
  end if;

  begin
    v_warehouse:=nullif(btrim(p_payload->>'warehouse_id'),'')::uuid;
    v_supplier_id:=nullif(btrim(p_payload->>'supplier_id'),'')::uuid;
    v_received_at:=coalesce(nullif(btrim(p_payload->>'received_at'),'')::timestamptz,now());
  exception when invalid_text_representation or invalid_datetime_format or datetime_field_overflow then
    raise exception 'WR_HEADER_INVALID';
  end;
  if v_warehouse is null then raise exception 'WR_WAREHOUSE_REQUIRED'; end if;
  perform 1 from public.warehouses where id=v_warehouse for key share;
  if not found then raise exception 'WR_WAREHOUSE_NOT_FOUND'; end if;
  if v_supplier_id is not null then
    select * into v_supplier from public.suppliers where id=v_supplier_id for key share;
    if not found then raise exception 'WR_SUPPLIER_NOT_FOUND'; end if;
    if v_supplier.active is false then raise exception 'WR_SUPPLIER_INACTIVE'; end if;
  end if;
  if jsonb_typeof(p_payload->'items') is distinct from 'array'
    or jsonb_array_length(p_payload->'items')=0 then raise exception 'WR_ITEMS_REQUIRED'; end if;

  insert into public.warehouse_receipts(warehouse_id,supplier_id,supplier_name,received_at,
    truck_reference,driver_name,reference_number,notes,created_by,registration_request_id,registration_request_payload)
  values(v_warehouse,v_supplier_id,v_supplier.name,v_received_at,
    nullif(btrim(p_payload->>'truck_reference'),''),nullif(btrim(p_payload->>'driver_name'),''),
    nullif(btrim(p_payload->>'reference_number'),''),nullif(btrim(p_payload->>'notes'),''),
    p_actor,p_request_id,v_payload)
  returning * into v_receipt;

  for v_line in select value from jsonb_array_elements(p_payload->'items') loop
    v_index:=v_index+1;
    if jsonb_typeof(v_line) is distinct from 'object' then raise exception 'WR_LINE_NUMBER_INVALID:%',v_index; end if;
    begin
      v_product_id:=nullif(btrim(v_line->>'product_id'),'')::uuid;
    exception when invalid_text_representation then
      raise exception 'WR_LINE_PRODUCT_NOT_FOUND:%',v_index;
    end;
    if v_product_id is null then raise exception 'WR_LINE_PRODUCT_REQUIRED:%',v_index; end if;
    select * into v_product from public.products where id=v_product_id for key share;
    if not found then raise exception 'WR_LINE_PRODUCT_NOT_FOUND:%',v_index; end if;
    v_mode:=coalesce(nullif(lower(btrim(v_line->>'entry_mode')),''),'units');
    v_pallets:=0;v_units:=null;v_quantity:=0;
    begin
      if v_mode='pallets' then
        v_pallets:=nullif(btrim(v_line->>'pallets'),'')::numeric;
        v_units:=coalesce(nullif(btrim(v_line->>'units_per_pallet'),'')::numeric,v_product.default_units_per_pallet);
      elsif v_mode='units' then
        v_quantity:=nullif(btrim(v_line->>'quantity'),'')::numeric;
      else
        raise exception 'WR_LINE_MODE_INVALID:%',v_index;
      end if;
      v_net:=nullif(btrim(v_line->>'net_weight_kg'),'')::numeric;
      v_gross:=nullif(btrim(v_line->>'gross_weight_kg'),'')::numeric;
      v_cost:=nullif(btrim(v_line->>'unit_cost'),'')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'WR_LINE_NUMBER_INVALID:%',v_index;
    end;
    if v_mode='pallets' then
      if coalesce(v_pallets,0)<=0 or v_pallets::text in ('NaN','Infinity','-Infinity') then raise exception 'WR_LINE_PALLETS_INVALID:%',v_index; end if;
      if coalesce(v_units,0)<=0 or v_units::text in ('NaN','Infinity','-Infinity') then raise exception 'WR_LINE_UNITS_INVALID:%',v_index; end if;
      v_quantity:=v_pallets*v_units;
    end if;
    if coalesce(v_quantity,0)<=0 or v_quantity::text in ('NaN','Infinity','-Infinity') then raise exception 'WR_LINE_QUANTITY_INVALID:%',v_index; end if;
    if v_net<0 or v_net::text in ('NaN','Infinity','-Infinity') then raise exception 'WR_LINE_NET_INVALID:%',v_index; end if;
    if v_gross<0 or v_gross::text in ('NaN','Infinity','-Infinity') then raise exception 'WR_LINE_GROSS_INVALID:%',v_index; end if;
    if v_cost<0 or v_cost::text in ('NaN','Infinity','-Infinity') then raise exception 'WR_LINE_COST_INVALID:%',v_index; end if;
    v_unit:=coalesce(nullif(btrim(v_product.unit),''),'unidades');
    if v_unit ~ '^[-+]?[0-9]+([.,][0-9]+)?$' then v_unit:='unidades'; end if;
    insert into public.warehouse_receipt_items(receipt_id,product_id,pallets,quantity,unit,
      units_per_pallet,net_weight_kg,gross_weight_kg,unit_cost,currency,lot_number,notes)
    values(v_receipt.id,v_product_id,v_pallets,v_quantity,v_unit,v_units,v_net,v_gross,v_cost,
      coalesce(nullif(upper(btrim(v_line->>'currency')),''),'USD'),
      nullif(btrim(v_line->>'lot_number'),''),nullif(btrim(v_line->>'notes'),''));
  end loop;

  insert into public.audit_log(actor_admin_id,actor_username,action,entity_type,entity_id,details)
  select p_actor,(select username from public.admin_users where id=p_actor),
    'warehouse_receipt_created','warehouse_receipt',v_receipt.id,
    jsonb_build_object('receipt_number',v_receipt.receipt_number,'warehouse_id',v_warehouse,
      'supplier_id',v_supplier_id,'lines',count(*),'total_quantity',sum(quantity),'total_pallets',sum(pallets))
  from public.warehouse_receipt_items where receipt_id=v_receipt.id;
  select coalesce(jsonb_agg(to_jsonb(i) order by i.created_at,i.id),'[]'::jsonb)
    into v_items from public.warehouse_receipt_items i where i.receipt_id=v_receipt.id;
  return (to_jsonb(v_receipt)-'registration_request_payload')||jsonb_build_object('items',v_items);
end;
$function$;
revoke all on function public.create_warehouse_receipt_canonical(jsonb,uuid,uuid) from public,anon,authenticated;
grant execute on function public.create_warehouse_receipt_canonical(jsonb,uuid,uuid) to service_role;
comment on function public.create_warehouse_receipt_canonical(jsonb,uuid,uuid) is
  'Atomic manual receipt, lines and audit; same authorized actor and request payload recover the original delivery without adding stock.';
