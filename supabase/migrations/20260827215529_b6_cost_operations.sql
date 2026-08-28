-- B6.2 · Transactional Cost Charge operations
-- Todas las mutaciones B6 son backend-only mediante RPC SECURITY DEFINER.
-- No introduce UI, COGS downstream, FX ni prorrateos automáticos.

create or replace function public.assert_active_cost_actor(
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_actor is null then
    raise exception 'COST_CHARGE_ACTOR_REQUIRED';
  end if;

  if not exists (
    select 1
    from public.admin_users au
    where au.id = p_actor
      and au.is_active = true
  ) then
    raise exception 'COST_CHARGE_ACTOR_INVALID';
  end if;
end;
$function$;

create or replace function public.populate_cost_charge_allocations(
  p_cost_charge_id uuid,
  p_allocations jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
  v_allocation jsonb;
  v_amount numeric;
  v_basis text;
  v_purchase_order_id uuid;
  v_warehouse_receipt_id uuid;
  v_load_id uuid;
  v_shipment_id uuid;
  v_operation_id uuid;
begin
  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status <> 'draft' then raise exception 'COST_CHARGE_NOT_DRAFT'; end if;

  if p_allocations is null then
    p_allocations := '[]'::jsonb;
  end if;

  if jsonb_typeof(p_allocations) <> 'array' then
    raise exception 'COST_CHARGE_ALLOCATIONS_INVALID';
  end if;

  if jsonb_array_length(p_allocations) > 500 then
    raise exception 'COST_CHARGE_TOO_MANY_ALLOCATIONS';
  end if;

  for v_allocation in select value from jsonb_array_elements(p_allocations)
  loop
    if jsonb_typeof(v_allocation) <> 'object' then
      raise exception 'COST_CHARGE_ALLOCATION_INVALID';
    end if;

    v_amount := nullif(btrim(v_allocation->>'amount'),'')::numeric;
    v_basis := lower(coalesce(nullif(btrim(v_allocation->>'basis'),''),'manual'));
    v_purchase_order_id := nullif(btrim(v_allocation->>'purchase_order_id'),'')::uuid;
    v_warehouse_receipt_id := nullif(btrim(v_allocation->>'warehouse_receipt_id'),'')::uuid;
    v_load_id := nullif(btrim(v_allocation->>'load_id'),'')::uuid;
    v_shipment_id := nullif(btrim(v_allocation->>'shipment_id'),'')::uuid;
    v_operation_id := nullif(btrim(v_allocation->>'operation_id'),'')::uuid;

    if v_amount is null or v_amount <= 0 then
      raise exception 'COST_CHARGE_ALLOCATION_AMOUNT_INVALID';
    end if;

    if v_basis not in ('manual','quantity','pallets','value','weight') then
      raise exception 'COST_CHARGE_ALLOCATION_BASIS_INVALID';
    end if;

    if num_nonnulls(
      v_purchase_order_id,
      v_warehouse_receipt_id,
      v_load_id,
      v_shipment_id,
      v_operation_id
    ) <> 1 then
      raise exception 'COST_CHARGE_ALLOCATION_TARGET_INVALID';
    end if;

    insert into public.cost_charge_allocations(
      cost_charge_id,
      amount,
      basis,
      purchase_order_id,
      warehouse_receipt_id,
      load_id,
      shipment_id,
      operation_id,
      notes,
      created_by
    ) values (
      p_cost_charge_id,
      v_amount,
      v_basis,
      v_purchase_order_id,
      v_warehouse_receipt_id,
      v_load_id,
      v_shipment_id,
      v_operation_id,
      nullif(btrim(v_allocation->>'notes'),''),
      p_actor
    );
  end loop;
end;
$function$;

create or replace function public.create_cost_charge(
  p_category text,
  p_stage text,
  p_amount numeric,
  p_currency text default 'USD',
  p_incurred_date date default current_date,
  p_supplier_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb,
  p_actor uuid default null
)
returns public.cost_charges
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
  v_category text := lower(btrim(coalesce(p_category,'')));
  v_stage text := lower(btrim(coalesce(p_stage,'')));
  v_currency text := upper(coalesce(nullif(btrim(p_currency),''),'USD'));
begin
  perform public.assert_active_cost_actor(p_actor);

  if v_category not in (
    'domestic_trucking','ocean_freight','insurance','customs_duties','port_terminal',
    'warehouse','inspection','brokerage','nationalization','other'
  ) then
    raise exception 'COST_CHARGE_CATEGORY_INVALID';
  end if;

  if v_stage not in ('inbound','fulfillment','destination','overhead') then
    raise exception 'COST_CHARGE_STAGE_INVALID';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'COST_CHARGE_AMOUNT_INVALID';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'COST_CHARGE_CURRENCY_INVALID';
  end if;

  insert into public.cost_charges(
    category,
    stage,
    amount,
    currency,
    incurred_date,
    supplier_id,
    reference,
    status,
    notes,
    created_by
  ) values (
    v_category,
    v_stage,
    p_amount,
    v_currency,
    coalesce(p_incurred_date,current_date),
    p_supplier_id,
    nullif(btrim(p_reference),''),
    'draft',
    nullif(btrim(p_notes),''),
    p_actor
  ) returning * into v_charge;

  perform public.populate_cost_charge_allocations(v_charge.id, p_allocations, p_actor);

  select *
    into v_charge
  from public.cost_charges
  where id = v_charge.id;

  return v_charge;
end;
$function$;

create or replace function public.replace_cost_charge(
  p_cost_charge_id uuid,
  p_category text,
  p_stage text,
  p_amount numeric,
  p_currency text default 'USD',
  p_incurred_date date default current_date,
  p_supplier_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb,
  p_actor uuid default null
)
returns public.cost_charges
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
  v_category text := lower(btrim(coalesce(p_category,'')));
  v_stage text := lower(btrim(coalesce(p_stage,'')));
  v_currency text := upper(coalesce(nullif(btrim(p_currency),''),'USD'));
begin
  perform public.assert_active_cost_actor(p_actor);

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status <> 'draft' then raise exception 'COST_CHARGE_NOT_DRAFT'; end if;

  if v_category not in (
    'domestic_trucking','ocean_freight','insurance','customs_duties','port_terminal',
    'warehouse','inspection','brokerage','nationalization','other'
  ) then
    raise exception 'COST_CHARGE_CATEGORY_INVALID';
  end if;

  if v_stage not in ('inbound','fulfillment','destination','overhead') then
    raise exception 'COST_CHARGE_STAGE_INVALID';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'COST_CHARGE_AMOUNT_INVALID';
  end if;

  if v_currency !~ '^[A-Z]{3}$' then
    raise exception 'COST_CHARGE_CURRENCY_INVALID';
  end if;

  delete from public.cost_charge_allocations
  where cost_charge_id = p_cost_charge_id;

  update public.cost_charges
     set category = v_category,
         stage = v_stage,
         amount = p_amount,
         currency = v_currency,
         incurred_date = coalesce(p_incurred_date,current_date),
         supplier_id = p_supplier_id,
         reference = nullif(btrim(p_reference),''),
         notes = nullif(btrim(p_notes),'')
   where id = p_cost_charge_id;

  perform public.populate_cost_charge_allocations(p_cost_charge_id, p_allocations, p_actor);

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id;

  return v_charge;
end;
$function$;

create or replace function public.replace_cost_charge_allocations(
  p_cost_charge_id uuid,
  p_allocations jsonb,
  p_actor uuid default null
)
returns public.cost_charges
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
begin
  perform public.assert_active_cost_actor(p_actor);

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status <> 'draft' then raise exception 'COST_CHARGE_NOT_DRAFT'; end if;

  delete from public.cost_charge_allocations
  where cost_charge_id = p_cost_charge_id;

  perform public.populate_cost_charge_allocations(p_cost_charge_id, p_allocations, p_actor);

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id;

  return v_charge;
end;
$function$;

create or replace function public.post_cost_charge(
  p_cost_charge_id uuid,
  p_actor uuid default null
)
returns public.cost_charges
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
begin
  perform public.assert_active_cost_actor(p_actor);

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status <> 'draft' then raise exception 'COST_CHARGE_NOT_DRAFT'; end if;

  perform set_config('export_mca.cost_charge_transition','post',true);

  update public.cost_charges
     set status = 'posted',
         posted_at = now(),
         posted_by = p_actor
   where id = p_cost_charge_id;

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id;

  return v_charge;
end;
$function$;

create or replace function public.void_cost_charge(
  p_cost_charge_id uuid,
  p_actor uuid default null
)
returns public.cost_charges
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
begin
  perform public.assert_active_cost_actor(p_actor);

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status not in ('draft','posted') then raise exception 'COST_CHARGE_CANNOT_VOID'; end if;

  perform set_config('export_mca.cost_charge_transition','void',true);

  update public.cost_charges
     set status = 'void',
         voided_at = now(),
         voided_by = p_actor
   where id = p_cost_charge_id;

  select *
    into v_charge
  from public.cost_charges
  where id = p_cost_charge_id;

  return v_charge;
end;
$function$;

revoke all on function public.assert_active_cost_actor(uuid) from public, anon, authenticated, service_role;
revoke all on function public.populate_cost_charge_allocations(uuid,jsonb,uuid) from public, anon, authenticated, service_role;

revoke all on function public.create_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function public.replace_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function public.replace_cost_charge_allocations(uuid,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function public.post_cost_charge(uuid,uuid) from public, anon, authenticated, service_role;
revoke all on function public.void_cost_charge(uuid,uuid) from public, anon, authenticated, service_role;

grant execute on function public.create_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid) to service_role;
grant execute on function public.replace_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) to service_role;
grant execute on function public.replace_cost_charge_allocations(uuid,jsonb,uuid) to service_role;
grant execute on function public.post_cost_charge(uuid,uuid) to service_role;
grant execute on function public.void_cost_charge(uuid,uuid) to service_role;

comment on function public.create_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid) is 'Creates a draft Cost Charge and its explicit allocation plan atomically.';
comment on function public.replace_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) is 'Atomically replaces the editable draft Cost Charge header and allocation plan.';
comment on function public.replace_cost_charge_allocations(uuid,jsonb,uuid) is 'Atomically redistributes a draft Cost Charge across explicit operational targets.';
comment on function public.post_cost_charge(uuid,uuid) is 'Posts a fully allocated Cost Charge through the guarded lifecycle transition.';
comment on function public.void_cost_charge(uuid,uuid) is 'Voids a draft or posted Cost Charge while preserving financial history.';
