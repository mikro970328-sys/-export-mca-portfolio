-- B4.1 · Núcleo de Facturas desde Sales Orders
-- Reutiliza `invoices` (vacía) y separa Facturación del Expediente legacy.

do $$
begin
  if exists (select 1 from public.invoices limit 1) then
    raise exception 'B4_INVOICES_MUST_BE_EMPTY_BEFORE_RESHAPE';
  end if;
end $$;

-- La factura comercial nace de Sales Order. Expediente queda opcional/legacy.
alter table public.invoices drop constraint if exists invoices_operation_id_fkey;
alter table public.invoices alter column operation_id drop not null;
alter table public.invoices
  add constraint invoices_operation_id_fkey
  foreign key (operation_id) references public.operations(id) on delete set null;

alter table public.invoices
  add column sales_order_id uuid not null references public.sales_orders(id) on delete restrict;

-- Reemplaza numeración manual por numeración PostgreSQL robusta.
alter table public.invoices drop constraint if exists invoices_invoice_number_key;
alter table public.invoices drop column invoice_number;
alter table public.invoices
  add column invoice_serial bigint generated always as identity;
alter table public.invoices
  add column invoice_number text generated always as (
    'INV-' || lpad(invoice_serial::text, greatest(4, length(invoice_serial::text)), '0')
  ) stored;
alter table public.invoices add constraint invoices_invoice_number_key unique (invoice_number);

-- Totales/cobro legacy dejan de ser fuentes mutables; se derivan en views.
alter table public.invoices
  drop column subtotal,
  drop column tax_total,
  drop column total,
  drop column paid_amount;

alter table public.invoices drop constraint if exists invoices_status_check;
alter table public.invoices
  add constraint invoices_status_check check (status in ('draft','issued','void'));

create index if not exists idx_invoices_sales_order_id on public.invoices(sales_order_id);
create index if not exists idx_invoices_client_id on public.invoices(client_id);
create index if not exists idx_invoices_operation_id on public.invoices(operation_id);
create index if not exists idx_invoices_status_issue_date on public.invoices(status, issue_date desc);

create table public.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices(id) on delete cascade,
  sales_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  description text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric generated always as (quantity * unit_price) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint invoice_items_invoice_so_item_key unique(invoice_id, sales_order_item_id)
);

create index idx_invoice_items_invoice_id on public.invoice_items(invoice_id);
create index idx_invoice_items_sales_order_item_id on public.invoice_items(sales_order_item_id);
create index idx_invoice_items_product_id on public.invoice_items(product_id);

alter table public.invoice_items enable row level security;

create trigger invoice_items_set_updated_at
before update on public.invoice_items
for each row execute function public.set_erp_updated_at();

create or replace function public.validate_invoice_header()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_client_id uuid;
  v_currency text;
  v_so_status text;
  v_operation_client_id uuid;
begin
  select client_id, currency, status
    into v_client_id, v_currency, v_so_status
  from public.sales_orders
  where id = new.sales_order_id;

  if not found then raise exception 'INVOICE_SO_NOT_FOUND'; end if;
  if v_so_status not in ('confirmed','closed') then raise exception 'INVOICE_SO_NOT_BILLABLE'; end if;

  -- Cliente y moneda son propiedad de la Sales Order.
  new.client_id := v_client_id;
  new.currency := v_currency;

  if new.operation_id is not null then
    select client_id into v_operation_client_id
    from public.operations where id = new.operation_id;
    if not found then raise exception 'INVOICE_OPERATION_NOT_FOUND'; end if;
    if v_operation_client_id is distinct from v_client_id then
      raise exception 'INVOICE_OPERATION_CLIENT_MISMATCH';
    end if;
  end if;

  return new;
end;
$function$;

create trigger invoices_validate_header
before insert or update of sales_order_id, client_id, currency, operation_id
on public.invoices
for each row execute function public.validate_invoice_header();

create or replace function public.guard_invoice_structure()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if old.status <> 'draft' and (
    new.sales_order_id is distinct from old.sales_order_id or
    new.client_id is distinct from old.client_id or
    new.operation_id is distinct from old.operation_id or
    new.issue_date is distinct from old.issue_date or
    new.due_date is distinct from old.due_date or
    new.currency is distinct from old.currency
  ) then
    raise exception 'INVOICE_STRUCTURE_LOCKED';
  end if;
  return new;
end;
$function$;

create trigger invoices_guard_structure
before update on public.invoices
for each row execute function public.guard_invoice_structure();

create or replace function public.guard_invoice_status()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'void' then raise exception 'INVOICE_STATUS_FINAL'; end if;

  if old.status = 'draft' and new.status = 'issued' then
    if not exists (select 1 from public.invoice_items where invoice_id = old.id) then
      raise exception 'INVOICE_HAS_NO_ITEMS';
    end if;
    return new;
  end if;

  if old.status in ('draft','issued') and new.status = 'void' then return new; end if;
  raise exception 'INVOICE_STATUS_TRANSITION_INVALID';
end;
$function$;

create trigger invoices_guard_status
before update of status on public.invoices
for each row execute function public.guard_invoice_status();

create or replace function public.prevent_invoice_delete()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'INVOICE_DELETE_NOT_ALLOWED';
end;
$function$;

create trigger invoices_prevent_delete
before delete on public.invoices
for each row execute function public.prevent_invoice_delete();

create or replace function public.prepare_invoice_item()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_invoice public.invoices;
  v_so_item public.sales_order_items;
  v_product record;
  v_existing numeric;
begin
  select * into v_invoice
  from public.invoices
  where id = new.invoice_id
  for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status <> 'draft' then raise exception 'INVOICE_ITEMS_LOCKED'; end if;

  select * into v_so_item
  from public.sales_order_items
  where id = new.sales_order_item_id
  for update;
  if not found then raise exception 'INVOICE_SO_ITEM_NOT_FOUND'; end if;
  if v_so_item.sales_order_id <> v_invoice.sales_order_id then
    raise exception 'INVOICE_SO_ITEM_MISMATCH';
  end if;

  select id, sku, name into v_product
  from public.products where id = v_so_item.product_id;
  if not found then raise exception 'INVOICE_PRODUCT_NOT_FOUND'; end if;

  new.product_id := v_so_item.product_id;
  new.description := concat_ws(' · ', nullif(v_product.sku,''), v_product.name);
  new.unit := v_so_item.unit;
  new.unit_price := v_so_item.unit_price;

  select coalesce(sum(ii.quantity),0)
    into v_existing
  from public.invoice_items ii
  join public.invoices i on i.id = ii.invoice_id
  where ii.sales_order_item_id = new.sales_order_item_id
    and i.status <> 'void'
    and ii.id <> new.id;

  if v_existing + new.quantity > v_so_item.ordered_quantity then
    raise exception 'INVOICE_QUANTITY_EXCEEDS_SALES_ORDER';
  end if;

  return new;
end;
$function$;

create trigger invoice_items_prepare
before insert or update of invoice_id, sales_order_item_id, quantity, product_id, description, unit, unit_price
on public.invoice_items
for each row execute function public.prepare_invoice_item();

create or replace function public.guard_invoice_item_delete()
returns trigger
language plpgsql
set search_path = public
as $function$
declare v_status text;
begin
  select status into v_status from public.invoices where id = old.invoice_id;
  if v_status is distinct from 'draft' then raise exception 'INVOICE_ITEMS_LOCKED'; end if;
  return old;
end;
$function$;

create trigger invoice_items_guard_delete
before delete on public.invoice_items
for each row execute function public.guard_invoice_item_delete();

-- Totales y estado de cobro derivados. B4.2/B4.4 endurecerán mutaciones de pagos.
create or replace view public.invoice_financial_progress
with (security_invoker = true)
as
with line_totals as (
  select invoice_id, coalesce(sum(line_total),0)::numeric as total
  from public.invoice_items
  group by invoice_id
), payment_totals as (
  select invoice_id, coalesce(sum(amount),0)::numeric as paid_amount
  from public.payments
  where status = 'posted' and invoice_id is not null
  group by invoice_id
)
select
  i.id as invoice_id,
  i.invoice_number,
  i.sales_order_id,
  i.client_id,
  i.status as invoice_status,
  i.issue_date,
  i.due_date,
  i.currency,
  coalesce(lt.total,0)::numeric as subtotal,
  0::numeric as tax_total,
  coalesce(lt.total,0)::numeric as total,
  coalesce(pt.paid_amount,0)::numeric as paid_amount,
  greatest(coalesce(lt.total,0) - coalesce(pt.paid_amount,0),0)::numeric as balance_due,
  case
    when i.status = 'draft' then 'draft'
    when i.status = 'void' then 'void'
    when coalesce(pt.paid_amount,0) >= coalesce(lt.total,0) and coalesce(lt.total,0) > 0 then 'paid'
    when coalesce(pt.paid_amount,0) > 0 then 'partial'
    when i.due_date is not null and i.due_date < current_date then 'overdue'
    else 'unpaid'
  end as payment_status
from public.invoices i
left join line_totals lt on lt.invoice_id = i.id
left join payment_totals pt on pt.invoice_id = i.id;

create or replace view public.sales_order_item_invoice_progress
with (security_invoker = true)
as
select
  soi.id as sales_order_item_id,
  soi.sales_order_id,
  soi.product_id,
  soi.ordered_quantity,
  soi.unit,
  soi.unit_price,
  coalesce(sum(ii.quantity) filter (where i.status <> 'void'),0)::numeric as invoiced_quantity,
  greatest(soi.ordered_quantity - coalesce(sum(ii.quantity) filter (where i.status <> 'void'),0),0)::numeric as uninvoiced_quantity
from public.sales_order_items soi
left join public.invoice_items ii on ii.sales_order_item_id = soi.id
left join public.invoices i on i.id = ii.invoice_id
group by soi.id, soi.sales_order_id, soi.product_id, soi.ordered_quantity, soi.unit, soi.unit_price;

create or replace view public.sales_order_invoice_progress
with (security_invoker = true)
as
select
  so.id as sales_order_id,
  so.so_number,
  so.client_id,
  so.currency,
  coalesce(sum(soi.ordered_quantity * soi.unit_price),0)::numeric as sales_order_total,
  coalesce(sum(sip.invoiced_quantity * soi.unit_price),0)::numeric as invoiced_total,
  greatest(
    coalesce(sum(soi.ordered_quantity * soi.unit_price),0) -
    coalesce(sum(sip.invoiced_quantity * soi.unit_price),0),
    0
  )::numeric as uninvoiced_total,
  bool_and(sip.uninvoiced_quantity = 0) as fully_invoiced
from public.sales_orders so
left join public.sales_order_items soi on soi.sales_order_id = so.id
left join public.sales_order_item_invoice_progress sip on sip.sales_order_item_id = soi.id
group by so.id, so.so_number, so.client_id, so.currency;

-- Backend-only. B4.2 añadirá RPCs transaccionales de mutación.
revoke all on table public.invoices from anon, authenticated;
revoke all on table public.invoice_items from anon, authenticated;
revoke insert, update, delete on table public.invoices from service_role;
revoke insert, update, delete on table public.invoice_items from service_role;
grant select on table public.invoices to service_role;
grant select on table public.invoice_items to service_role;
grant select on table public.invoice_financial_progress to service_role;
grant select on table public.sales_order_item_invoice_progress to service_role;
grant select on table public.sales_order_invoice_progress to service_role;

comment on table public.invoice_items is 'Snapshot de líneas facturadas desde Sales Orders. No modifica inventario.';
comment on view public.invoice_financial_progress is 'Totales y saldo de factura derivados de líneas y pagos posted.';
comment on view public.sales_order_item_invoice_progress is 'Cantidad facturada y pendiente de facturar por línea de Sales Order.';
comment on view public.sales_order_invoice_progress is 'Progreso de facturación agregado por Sales Order.';
