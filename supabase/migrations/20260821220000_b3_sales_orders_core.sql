-- B3.1 · Núcleo Sales Orders
-- La Sales Order representa compromiso comercial del cliente.
-- No crea, reserva ni descuenta inventario.
-- Cargues sigue siendo el único propietario de la reserva física por WR.

create table public.sales_orders (
  id uuid primary key default gen_random_uuid(),
  so_serial bigint generated always as identity,
  so_number text generated always as ('SO-' || lpad(so_serial::text, 4, '0')) stored,
  client_id uuid not null references public.clients(id) on delete restrict,
  importer_id uuid references public.importers(id) on delete restrict,
  order_date date not null default current_date,
  requested_at timestamptz,
  currency text not null default 'USD',
  customer_reference text,
  status text not null default 'draft',
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_orders_so_number_unique unique (so_number),
  constraint sales_orders_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint sales_orders_status_check check (status in ('draft','confirmed','closed','cancelled')),
  constraint sales_orders_client_importer_fkey
    foreign key (client_id, importer_id)
    references public.client_importers(client_id, importer_id)
    on delete restrict
);

alter table public.sales_orders enable row level security;

create index sales_orders_client_id_idx on public.sales_orders(client_id);
create index sales_orders_importer_id_idx on public.sales_orders(importer_id) where importer_id is not null;
create index sales_orders_status_idx on public.sales_orders(status);
create index sales_orders_order_date_idx on public.sales_orders(order_date desc);
create index sales_orders_created_by_idx on public.sales_orders(created_by) where created_by is not null;

create trigger sales_orders_set_updated_at
before update on public.sales_orders
for each row execute function public.set_erp_updated_at();

create or replace function public.validate_sales_order_parties()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_client_active boolean;
  v_importer_active boolean;
begin
  select active into v_client_active
  from public.clients
  where id = new.client_id;

  if not found then
    raise exception 'SO_CLIENT_NOT_FOUND';
  end if;

  if v_client_active is not true then
    raise exception 'SO_CLIENT_INACTIVE';
  end if;

  if new.importer_id is not null then
    select active into v_importer_active
    from public.importers
    where id = new.importer_id;

    if not found then
      raise exception 'SO_IMPORTER_NOT_FOUND';
    end if;

    if v_importer_active is not true then
      raise exception 'SO_IMPORTER_INACTIVE';
    end if;

    if not exists (
      select 1
      from public.client_importers
      where client_id = new.client_id
        and importer_id = new.importer_id
    ) then
      raise exception 'SO_CLIENT_IMPORTER_MISMATCH';
    end if;
  end if;

  return new;
end;
$function$;

create trigger sales_orders_validate_parties
before insert or update of client_id, importer_id on public.sales_orders
for each row execute function public.validate_sales_order_parties();

create or replace function public.prevent_sales_order_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  raise exception 'SO_DELETE_NOT_ALLOWED';
end;
$function$;

create trigger sales_orders_prevent_delete
before delete on public.sales_orders
for each row execute function public.prevent_sales_order_delete();

alter table public.loads
  add column client_id uuid references public.clients(id) on delete restrict,
  add column importer_id uuid references public.importers(id) on delete restrict,
  add constraint loads_sales_client_importer_presence_check
    check (importer_id is null or client_id is not null),
  add constraint loads_sales_client_importer_fkey
    foreign key (client_id, importer_id)
    references public.client_importers(client_id, importer_id)
    on delete restrict;

create index loads_client_id_idx on public.loads(client_id) where client_id is not null;
create index loads_importer_id_idx on public.loads(importer_id) where importer_id is not null;

create table public.sales_order_items (
  id uuid primary key default gen_random_uuid(),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  ordered_quantity numeric not null,
  ordered_pallets numeric not null default 0,
  unit text not null,
  units_per_pallet numeric,
  unit_price numeric not null default 0,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_order_items_quantity_check check (ordered_quantity > 0),
  constraint sales_order_items_pallets_check check (ordered_pallets >= 0),
  constraint sales_order_items_unit_not_blank_check check (btrim(unit) <> ''),
  constraint sales_order_items_unit_semantic_check check (btrim(unit) !~ '^[0-9]+([.,][0-9]+)?$'),
  constraint sales_order_items_units_per_pallet_check check (units_per_pallet is null or units_per_pallet > 0),
  constraint sales_order_items_unit_price_check check (unit_price >= 0)
);

alter table public.sales_order_items enable row level security;

create index sales_order_items_sales_order_id_idx on public.sales_order_items(sales_order_id);
create index sales_order_items_product_id_idx on public.sales_order_items(product_id);

create trigger sales_order_items_set_updated_at
before update on public.sales_order_items
for each row execute function public.set_erp_updated_at();

create table public.sales_fulfillment_allocations (
  id uuid primary key default gen_random_uuid(),
  sales_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
  load_item_id uuid not null references public.load_items(id) on delete restrict,
  allocated_quantity numeric not null,
  allocated_pallets numeric not null default 0,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sales_fulfillment_allocations_quantity_check check (allocated_quantity > 0),
  constraint sales_fulfillment_allocations_pallets_check check (allocated_pallets >= 0),
  constraint sales_fulfillment_allocations_source_unique unique (sales_order_item_id, load_item_id)
);

alter table public.sales_fulfillment_allocations enable row level security;

create index sales_fulfillment_allocations_so_item_idx on public.sales_fulfillment_allocations(sales_order_item_id);
create index sales_fulfillment_allocations_load_item_idx on public.sales_fulfillment_allocations(load_item_id);
create index sales_fulfillment_allocations_created_by_idx on public.sales_fulfillment_allocations(created_by) where created_by is not null;

create trigger sales_fulfillment_allocations_set_updated_at
before update on public.sales_fulfillment_allocations
for each row execute function public.set_erp_updated_at();

create or replace function public.guard_load_sales_context()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_shipment_client_id uuid;
  v_shipment_importer_id uuid;
begin
  if new.client_id is not distinct from old.client_id
     and new.importer_id is not distinct from old.importer_id then
    return new;
  end if;

  if exists (
    select 1
    from public.load_items li
    join public.sales_fulfillment_allocations sfa on sfa.load_item_id = li.id
    where li.load_id = old.id
  ) then
    raise exception 'LOAD_HAS_SALES_ALLOCATIONS';
  end if;

  if new.shipment_id is not null then
    select client_id, importer_id
      into v_shipment_client_id, v_shipment_importer_id
    from public.shipments
    where id = new.shipment_id;

    if new.client_id is distinct from v_shipment_client_id
       or new.importer_id is distinct from v_shipment_importer_id then
      raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH';
    end if;
  end if;

  return new;
end;
$function$;

create trigger loads_guard_sales_context
before update of client_id, importer_id on public.loads
for each row execute function public.guard_load_sales_context();

create or replace function public.validate_load_shipment_sales_context()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_shipment_client_id uuid;
  v_shipment_importer_id uuid;
begin
  if new.shipment_id is null
     or (new.client_id is null and new.importer_id is null) then
    return new;
  end if;

  select client_id, importer_id
    into v_shipment_client_id, v_shipment_importer_id
  from public.shipments
  where id = new.shipment_id;

  if not found then
    raise exception 'SHIPMENT_NOT_FOUND';
  end if;

  if new.client_id is distinct from v_shipment_client_id
     or new.importer_id is distinct from v_shipment_importer_id then
    raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH';
  end if;

  return new;
end;
$function$;

create trigger loads_validate_shipment_sales_context
before update of shipment_id on public.loads
for each row execute function public.validate_load_shipment_sales_context();

create or replace function public.validate_sales_order_item()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_product_unit text;
  v_so_status text;
begin
  select unit into v_product_unit
  from public.products
  where id = new.product_id;

  if not found then
    raise exception 'SO_PRODUCT_NOT_FOUND';
  end if;

  if btrim(new.unit) is distinct from btrim(v_product_unit) then
    raise exception 'SO_UNIT_MUST_MATCH_PRODUCT';
  end if;

  select status into v_so_status
  from public.sales_orders
  where id = new.sales_order_id
  for update;

  if not found then
    raise exception 'SO_NOT_FOUND';
  end if;

  if v_so_status <> 'draft' then
    raise exception 'SO_ITEMS_LOCKED';
  end if;

  return new;
end;
$function$;

create trigger sales_order_items_validate
before insert or update of sales_order_id, product_id, unit, ordered_quantity, ordered_pallets, units_per_pallet, unit_price
on public.sales_order_items
for each row execute function public.validate_sales_order_item();

create or replace function public.guard_sales_order_item_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_so_status text;
begin
  select status into v_so_status
  from public.sales_orders
  where id = old.sales_order_id
  for update;

  if v_so_status is distinct from 'draft' then
    raise exception 'SO_ITEMS_LOCKED';
  end if;

  return old;
end;
$function$;

create trigger sales_order_items_guard_delete
before delete on public.sales_order_items
for each row execute function public.guard_sales_order_item_delete();

create or replace function public.guard_sales_order_structure()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if old.status <> 'draft'
     and (
       new.client_id is distinct from old.client_id
       or new.importer_id is distinct from old.importer_id
       or new.currency is distinct from old.currency
       or new.order_date is distinct from old.order_date
       or new.requested_at is distinct from old.requested_at
       or new.customer_reference is distinct from old.customer_reference
     ) then
    raise exception 'SO_STRUCTURE_LOCKED';
  end if;

  if new.currency is distinct from old.currency
     and exists (
       select 1 from public.sales_order_items
       where sales_order_id = old.id
     ) then
    raise exception 'SO_CURRENCY_HAS_ITEMS';
  end if;

  if (
       new.client_id is distinct from old.client_id
       or new.importer_id is distinct from old.importer_id
     )
     and exists (
       select 1
       from public.sales_order_items soi
       join public.sales_fulfillment_allocations sfa on sfa.sales_order_item_id = soi.id
       where soi.sales_order_id = old.id
     ) then
    raise exception 'SO_HAS_LOAD_ALLOCATIONS';
  end if;

  return new;
end;
$function$;

create trigger sales_orders_guard_structure
before update of client_id, importer_id, currency, order_date, requested_at, customer_reference
on public.sales_orders
for each row execute function public.guard_sales_order_structure();

create or replace function public.validate_sales_fulfillment_allocation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_client_id uuid;
  v_importer_id uuid;
  v_so_status text;
  v_so_product_id uuid;
  v_so_unit text;
  v_ordered_quantity numeric;
  v_ordered_pallets numeric;

  v_load_id uuid;
  v_load_status text;
  v_load_client_id uuid;
  v_load_importer_id uuid;
  v_load_shipment_id uuid;
  v_load_product_id uuid;
  v_load_unit text;
  v_load_quantity numeric;
  v_load_pallets numeric;

  v_shipment_client_id uuid;
  v_shipment_importer_id uuid;
  v_existing_so_quantity numeric;
  v_existing_so_pallets numeric;
  v_existing_load_quantity numeric;
  v_existing_load_pallets numeric;
begin
  select
    so.client_id,
    so.importer_id,
    so.status,
    soi.product_id,
    soi.unit,
    soi.ordered_quantity,
    soi.ordered_pallets
  into
    v_client_id,
    v_importer_id,
    v_so_status,
    v_so_product_id,
    v_so_unit,
    v_ordered_quantity,
    v_ordered_pallets
  from public.sales_order_items soi
  join public.sales_orders so on so.id = soi.sales_order_id
  where soi.id = new.sales_order_item_id
  for update of soi, so;

  if not found then
    raise exception 'SO_ITEM_NOT_FOUND';
  end if;

  if v_so_status <> 'confirmed' then
    raise exception 'SO_NOT_CONFIRMED';
  end if;

  select
    li.load_id,
    l.status,
    l.client_id,
    l.importer_id,
    l.shipment_id,
    li.product_id,
    li.unit,
    li.planned_quantity,
    li.planned_pallets
  into
    v_load_id,
    v_load_status,
    v_load_client_id,
    v_load_importer_id,
    v_load_shipment_id,
    v_load_product_id,
    v_load_unit,
    v_load_quantity,
    v_load_pallets
  from public.load_items li
  join public.loads l on l.id = li.load_id
  where li.id = new.load_item_id
  for update of li, l;

  if not found then
    raise exception 'LOAD_ITEM_NOT_FOUND';
  end if;

  if v_load_status <> 'draft' then
    raise exception 'SO_LOAD_NOT_DRAFT';
  end if;

  if v_load_product_id <> v_so_product_id then
    raise exception 'SO_LOAD_PRODUCT_MISMATCH';
  end if;

  if btrim(v_load_unit) is distinct from btrim(v_so_unit) then
    raise exception 'SO_LOAD_UNIT_MISMATCH';
  end if;

  if v_ordered_pallets = 0 and new.allocated_pallets <> 0 then
    raise exception 'SO_PALLET_ALLOCATION_NOT_ALLOWED';
  end if;

  if v_load_pallets = 0 and new.allocated_pallets <> 0 then
    raise exception 'LOAD_PALLET_ALLOCATION_NOT_ALLOWED';
  end if;

  select
    coalesce(sum(sfa.allocated_quantity),0),
    coalesce(sum(sfa.allocated_pallets),0)
  into
    v_existing_so_quantity,
    v_existing_so_pallets
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id = sfa.load_item_id
  join public.loads l on l.id = li.load_id
  where sfa.sales_order_item_id = new.sales_order_item_id
    and sfa.id <> new.id
    and l.status <> 'cancelled';

  if v_existing_so_quantity + new.allocated_quantity > v_ordered_quantity
     or v_existing_so_pallets + new.allocated_pallets > v_ordered_pallets then
    raise exception 'SO_ALLOCATION_EXCEEDS_ORDER';
  end if;

  select
    coalesce(sum(allocated_quantity),0),
    coalesce(sum(allocated_pallets),0)
  into
    v_existing_load_quantity,
    v_existing_load_pallets
  from public.sales_fulfillment_allocations
  where load_item_id = new.load_item_id
    and id <> new.id;

  if v_existing_load_quantity + new.allocated_quantity > v_load_quantity
     or v_existing_load_pallets + new.allocated_pallets > v_load_pallets then
    raise exception 'SO_ALLOCATION_EXCEEDS_LOAD_ITEM';
  end if;

  if v_load_client_id is null and v_load_importer_id is null then
    if v_load_shipment_id is not null then
      select client_id, importer_id
        into v_shipment_client_id, v_shipment_importer_id
      from public.shipments
      where id = v_load_shipment_id;

      if v_shipment_client_id is distinct from v_client_id
         or v_shipment_importer_id is distinct from v_importer_id then
        raise exception 'LOAD_SALES_CONTEXT_SHIPMENT_MISMATCH';
      end if;
    end if;

    update public.loads
    set client_id = v_client_id,
        importer_id = v_importer_id
    where id = v_load_id;
  elsif v_load_client_id is distinct from v_client_id
        or v_load_importer_id is distinct from v_importer_id then
    raise exception 'LOAD_SALES_CONTEXT_MISMATCH';
  end if;

  return new;
end;
$function$;

create trigger sales_fulfillment_allocations_validate
before insert or update on public.sales_fulfillment_allocations
for each row execute function public.validate_sales_fulfillment_allocation();

create or replace function public.guard_sales_fulfillment_allocation_mutation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_load_status text;
begin
  select l.status into v_load_status
  from public.load_items li
  join public.loads l on l.id = li.load_id
  where li.id = old.load_item_id;

  if not found then
    raise exception 'LOAD_ITEM_NOT_FOUND';
  end if;

  if v_load_status <> 'draft' then
    raise exception 'SO_LOAD_ALLOCATION_LOCKED';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create trigger sales_fulfillment_allocations_guard_mutation
before update or delete on public.sales_fulfillment_allocations
for each row execute function public.guard_sales_fulfillment_allocation_mutation();

create or replace function public.clear_load_sales_context_after_allocation_change()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_old_load_id uuid;
begin
  select load_id into v_old_load_id
  from public.load_items
  where id = old.load_item_id;

  if v_old_load_id is null then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.load_item_id = old.load_item_id then
    return new;
  end if;

  if not exists (
       select 1
       from public.load_items li
       join public.sales_fulfillment_allocations sfa on sfa.load_item_id = li.id
       where li.load_id = v_old_load_id
     )
     and exists (
       select 1
       from public.loads l
       where l.id = v_old_load_id
         and l.status = 'draft'
         and l.shipment_id is null
     ) then
    update public.loads
    set client_id = null,
        importer_id = null
    where id = v_old_load_id;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create trigger sales_fulfillment_allocations_clear_old_load_context
after update or delete on public.sales_fulfillment_allocations
for each row execute function public.clear_load_sales_context_after_allocation_change();

create or replace view public.sales_order_item_progress
with (security_invoker = true)
as
with allocation_totals as (
  select
    sfa.sales_order_item_id,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status = 'draft'),0)::numeric as planned_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status = 'draft'),0)::numeric as planned_pallets,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status in ('reserved','loading','loaded')),0)::numeric as prepared_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status in ('reserved','loading','loaded')),0)::numeric as prepared_pallets,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status = 'dispatched'),0)::numeric as dispatched_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status = 'dispatched'),0)::numeric as dispatched_pallets
  from public.sales_fulfillment_allocations sfa
  join public.load_items li on li.id = sfa.load_item_id
  join public.loads l on l.id = li.load_id
  group by sfa.sales_order_item_id
)
select
  soi.id as sales_order_item_id,
  soi.sales_order_id,
  soi.product_id,
  soi.ordered_quantity,
  soi.ordered_pallets,
  soi.unit,
  soi.units_per_pallet,
  soi.unit_price,
  (soi.ordered_quantity * soi.unit_price)::numeric as line_total,
  coalesce(a.planned_quantity,0)::numeric as planned_quantity,
  coalesce(a.planned_pallets,0)::numeric as planned_pallets,
  coalesce(a.prepared_quantity,0)::numeric as prepared_quantity,
  coalesce(a.prepared_pallets,0)::numeric as prepared_pallets,
  coalesce(a.dispatched_quantity,0)::numeric as dispatched_quantity,
  coalesce(a.dispatched_pallets,0)::numeric as dispatched_pallets,
  greatest(
    soi.ordered_quantity
      - coalesce(a.planned_quantity,0)
      - coalesce(a.prepared_quantity,0)
      - coalesce(a.dispatched_quantity,0),
    0
  )::numeric as unallocated_quantity,
  greatest(
    soi.ordered_pallets
      - coalesce(a.planned_pallets,0)
      - coalesce(a.prepared_pallets,0)
      - coalesce(a.dispatched_pallets,0),
    0
  )::numeric as unallocated_pallets,
  greatest(soi.ordered_quantity - coalesce(a.dispatched_quantity,0),0)::numeric as remaining_to_dispatch_quantity,
  greatest(soi.ordered_pallets - coalesce(a.dispatched_pallets,0),0)::numeric as remaining_to_dispatch_pallets,
  (
    coalesce(a.dispatched_quantity,0) >= soi.ordered_quantity
    and (soi.ordered_pallets = 0 or coalesce(a.dispatched_pallets,0) >= soi.ordered_pallets)
  ) as is_fully_dispatched,
  (
    coalesce(a.dispatched_quantity,0) > 0
    and not (
      coalesce(a.dispatched_quantity,0) >= soi.ordered_quantity
      and (soi.ordered_pallets = 0 or coalesce(a.dispatched_pallets,0) >= soi.ordered_pallets)
    )
  ) as has_partial_dispatch,
  case
    when coalesce(a.dispatched_quantity,0) >= soi.ordered_quantity
         and (soi.ordered_pallets = 0 or coalesce(a.dispatched_pallets,0) >= soi.ordered_pallets) then 'dispatched'
    when coalesce(a.prepared_quantity,0) > 0 or coalesce(a.prepared_pallets,0) > 0 then 'prepared'
    when coalesce(a.planned_quantity,0) > 0 or coalesce(a.planned_pallets,0) > 0 then 'planned'
    when coalesce(a.dispatched_quantity,0) > 0 or coalesce(a.dispatched_pallets,0) > 0 then 'dispatched'
    else 'pending'
  end as fulfillment_stage
from public.sales_order_items soi
left join allocation_totals a on a.sales_order_item_id = soi.id;

create or replace view public.sales_order_progress
with (security_invoker = true)
as
select
  so.id as sales_order_id,
  so.so_number,
  so.client_id,
  so.importer_id,
  so.status as commercial_status,
  so.currency,
  count(p.sales_order_item_id)::integer as item_count,
  coalesce(sum(p.line_total),0)::numeric as order_total,
  count(*) filter (where p.fulfillment_stage = 'pending')::integer as pending_items,
  count(*) filter (where p.fulfillment_stage = 'planned')::integer as planned_items,
  count(*) filter (where p.fulfillment_stage = 'prepared')::integer as prepared_items,
  count(*) filter (where p.is_fully_dispatched)::integer as fully_dispatched_items,
  coalesce(bool_or(p.has_partial_dispatch),false) as has_partial_dispatch,
  case
    when count(p.sales_order_item_id) = 0 then 'pending'
    when count(*) filter (where p.is_fully_dispatched) = count(p.sales_order_item_id) then 'dispatched'
    when count(*) filter (
      where p.fulfillment_stage <> 'pending'
         or p.has_partial_dispatch
    ) = 0 then 'pending'
    else 'partial'
  end as fulfillment_status
from public.sales_orders so
left join public.sales_order_item_progress p on p.sales_order_id = so.id
group by so.id;

create or replace function public.guard_sales_order_status()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_item_count integer;
  v_incomplete_count integer;
  v_client_active boolean;
  v_importer_active boolean;
begin
  if new.status = old.status then
    return new;
  end if;

  if old.status in ('closed','cancelled') then
    raise exception 'SO_STATUS_FINAL';
  end if;

  if old.status = 'draft' and new.status not in ('confirmed','cancelled') then
    raise exception 'SO_STATUS_TRANSITION_INVALID';
  end if;

  if old.status = 'confirmed' and new.status not in ('closed','cancelled') then
    raise exception 'SO_STATUS_TRANSITION_INVALID';
  end if;

  select count(*) into v_item_count
  from public.sales_order_items
  where sales_order_id = old.id;

  if new.status = 'confirmed' and v_item_count = 0 then
    raise exception 'SO_HAS_NO_ITEMS';
  end if;

  if new.status = 'confirmed' then
    select active into v_client_active
    from public.clients
    where id = old.client_id;

    if v_client_active is not true then
      raise exception 'SO_CLIENT_INACTIVE';
    end if;

    if old.importer_id is not null then
      select active into v_importer_active
      from public.importers
      where id = old.importer_id;

      if v_importer_active is not true then
        raise exception 'SO_IMPORTER_INACTIVE';
      end if;

      if not exists (
        select 1
        from public.client_importers
        where client_id = old.client_id
          and importer_id = old.importer_id
      ) then
        raise exception 'SO_CLIENT_IMPORTER_MISMATCH';
      end if;
    end if;
  end if;

  if new.status = 'closed' then
    select count(*) into v_incomplete_count
    from public.sales_order_item_progress
    where sales_order_id = old.id
      and not is_fully_dispatched;

    if v_item_count = 0 or v_incomplete_count > 0 then
      raise exception 'SO_NOT_FULLY_DISPATCHED';
    end if;
  end if;

  if new.status = 'cancelled'
     and exists (
       select 1
       from public.sales_order_items soi
       join public.sales_fulfillment_allocations sfa on sfa.sales_order_item_id = soi.id
       join public.load_items li on li.id = sfa.load_item_id
       join public.loads l on l.id = li.load_id
       where soi.sales_order_id = old.id
         and l.status <> 'cancelled'
     ) then
    raise exception 'SO_HAS_ACTIVE_LOAD_ALLOCATIONS';
  end if;

  return new;
end;
$function$;

create trigger sales_orders_guard_status
before update of status on public.sales_orders
for each row execute function public.guard_sales_order_status();

revoke all on table public.sales_orders from anon, authenticated;
revoke all on table public.sales_order_items from anon, authenticated;
revoke all on table public.sales_fulfillment_allocations from anon, authenticated;
revoke all on table public.sales_order_item_progress from anon, authenticated;
revoke all on table public.sales_order_progress from anon, authenticated;

grant all on table public.sales_orders to service_role;
grant all on table public.sales_order_items to service_role;
grant all on table public.sales_fulfillment_allocations to service_role;
grant select on table public.sales_order_item_progress to service_role;
grant select on table public.sales_order_progress to service_role;

revoke all on function public.validate_sales_order_parties() from public, anon, authenticated;
revoke all on function public.prevent_sales_order_delete() from public, anon, authenticated;
revoke all on function public.guard_load_sales_context() from public, anon, authenticated;
revoke all on function public.validate_load_shipment_sales_context() from public, anon, authenticated;
revoke all on function public.validate_sales_order_item() from public, anon, authenticated;
revoke all on function public.guard_sales_order_item_delete() from public, anon, authenticated;
revoke all on function public.guard_sales_order_structure() from public, anon, authenticated;
revoke all on function public.validate_sales_fulfillment_allocation() from public, anon, authenticated;
revoke all on function public.guard_sales_fulfillment_allocation_mutation() from public, anon, authenticated;
revoke all on function public.clear_load_sales_context_after_allocation_change() from public, anon, authenticated;
revoke all on function public.guard_sales_order_status() from public, anon, authenticated;

comment on column public.loads.client_id is 'Contexto comercial del Cargue. Debe coincidir con todas las Sales Orders vinculadas y con el contenedor si existe.';
comment on column public.loads.importer_id is 'Importador del contexto comercial del Cargue. Nullable; si existe debe pertenecer al cliente mediante client_importers.';
comment on table public.sales_orders is 'Orden comercial de venta. Representa demanda del cliente y no modifica inventario.';
comment on table public.sales_order_items is 'Líneas comerciales de Sales Order. ordered_quantity está expresada en unit y unit_price usa la moneda de la cabecera.';
comment on table public.sales_fulfillment_allocations is 'Trazabilidad comercial entre líneas vendidas y líneas de Cargue. El estado físico se deriva del estado del Cargue.';
comment on view public.sales_order_item_progress is 'Progreso derivado por línea: planned/prepared/dispatched. Cargues cancelados no cuentan.';
comment on view public.sales_order_progress is 'Progreso agregado de Sales Order, separado de sales_orders.status.';
