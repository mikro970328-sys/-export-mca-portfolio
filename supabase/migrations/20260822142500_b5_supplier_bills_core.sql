-- B5.1 · Accounts Payable core
-- Supplier Bills represent financial obligations. They do not create inventory.
-- Supplier Payments represent cash outflows and may exist as PO prepayments before a bill.

create table public.supplier_bills (
  id uuid primary key default gen_random_uuid(),
  bill_serial bigint generated always as identity,
  bill_number text generated always as (
    'SB-' || lpad(bill_serial::text, greatest(4, length(bill_serial::text)), '0')
  ) stored unique,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  supplier_invoice_number text,
  bill_date date not null default current_date,
  due_date date,
  currency text not null,
  status text not null default 'draft',
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  posted_at timestamptz,
  voided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_bills_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint supplier_bills_status_check check (status in ('draft','posted','void')),
  constraint supplier_bills_due_date_check check (due_date is null or due_date >= bill_date),
  constraint supplier_bills_supplier_invoice_not_blank check (
    supplier_invoice_number is null or btrim(supplier_invoice_number) <> ''
  )
);

alter table public.supplier_bills enable row level security;
create index supplier_bills_po_idx on public.supplier_bills(purchase_order_id);
create index supplier_bills_supplier_idx on public.supplier_bills(supplier_id);
create index supplier_bills_status_idx on public.supplier_bills(status);
create index supplier_bills_due_date_idx on public.supplier_bills(due_date) where due_date is not null;
create index supplier_bills_created_by_idx on public.supplier_bills(created_by) where created_by is not null;
create unique index supplier_bills_supplier_invoice_unique_idx
  on public.supplier_bills(supplier_id, lower(btrim(supplier_invoice_number)))
  where supplier_invoice_number is not null;

create trigger supplier_bills_set_updated_at
before update on public.supplier_bills
for each row execute function public.set_erp_updated_at();

create table public.supplier_bill_items (
  id uuid primary key default gen_random_uuid(),
  supplier_bill_id uuid not null references public.supplier_bills(id) on delete restrict,
  purchase_order_item_id uuid not null references public.purchase_order_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  unit text not null,
  billed_quantity numeric not null,
  po_unit_cost_snapshot numeric,
  unit_cost numeric not null,
  currency text not null,
  line_total numeric generated always as (billed_quantity * unit_cost) stored,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_bill_items_quantity_check check (billed_quantity > 0),
  constraint supplier_bill_items_po_cost_check check (po_unit_cost_snapshot is null or po_unit_cost_snapshot >= 0),
  constraint supplier_bill_items_unit_cost_check check (unit_cost >= 0),
  constraint supplier_bill_items_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint supplier_bill_items_unit_not_blank check (btrim(unit) <> ''),
  constraint supplier_bill_items_po_line_unique unique (supplier_bill_id, purchase_order_item_id)
);

alter table public.supplier_bill_items enable row level security;
create index supplier_bill_items_bill_idx on public.supplier_bill_items(supplier_bill_id);
create index supplier_bill_items_po_item_idx on public.supplier_bill_items(purchase_order_item_id);
create index supplier_bill_items_product_idx on public.supplier_bill_items(product_id);

create trigger supplier_bill_items_set_updated_at
before update on public.supplier_bill_items
for each row execute function public.set_erp_updated_at();

create table public.supplier_payments (
  id uuid primary key default gen_random_uuid(),
  payment_serial bigint generated always as identity,
  payment_number text generated always as (
    'SP-' || lpad(payment_serial::text, greatest(4, length(payment_serial::text)), '0')
  ) stored unique,
  purchase_order_id uuid not null references public.purchase_orders(id) on delete restrict,
  supplier_id uuid not null references public.suppliers(id) on delete restrict,
  amount numeric not null,
  currency text not null,
  payment_date date not null default current_date,
  method text,
  reference text,
  status text not null default 'posted',
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  reversed_at timestamptz,
  reversed_by uuid references public.admin_users(id) on delete set null,
  reversal_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint supplier_payments_amount_check check (amount > 0),
  constraint supplier_payments_currency_check check (currency ~ '^[A-Z]{3}$'),
  constraint supplier_payments_status_check check (status in ('posted','reversed')),
  constraint supplier_payments_method_not_blank check (method is null or btrim(method) <> ''),
  constraint supplier_payments_reference_not_blank check (reference is null or btrim(reference) <> '')
);

alter table public.supplier_payments enable row level security;
create index supplier_payments_po_idx on public.supplier_payments(purchase_order_id);
create index supplier_payments_supplier_idx on public.supplier_payments(supplier_id);
create index supplier_payments_status_idx on public.supplier_payments(status);
create index supplier_payments_date_idx on public.supplier_payments(payment_date desc);
create index supplier_payments_created_by_idx on public.supplier_payments(created_by) where created_by is not null;

create trigger supplier_payments_set_updated_at
before update on public.supplier_payments
for each row execute function public.set_erp_updated_at();

create table public.supplier_payment_applications (
  id uuid primary key default gen_random_uuid(),
  supplier_payment_id uuid not null references public.supplier_payments(id) on delete restrict,
  supplier_bill_id uuid not null references public.supplier_bills(id) on delete restrict,
  amount numeric not null,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint supplier_payment_applications_amount_check check (amount > 0),
  constraint supplier_payment_applications_unique unique (supplier_payment_id, supplier_bill_id)
);

alter table public.supplier_payment_applications enable row level security;
create index supplier_payment_applications_payment_idx on public.supplier_payment_applications(supplier_payment_id);
create index supplier_payment_applications_bill_idx on public.supplier_payment_applications(supplier_bill_id);
create index supplier_payment_applications_created_by_idx on public.supplier_payment_applications(created_by) where created_by is not null;

-- Header source-of-truth: supplier and currency always come from the PO.
create or replace function public.validate_supplier_bill_header()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_po record;
begin
  select supplier_id, currency, status
    into v_po
  from public.purchase_orders
  where id = new.purchase_order_id;

  if not found then raise exception 'SUPPLIER_BILL_PO_NOT_FOUND'; end if;
  if v_po.status = 'cancelled' then raise exception 'SUPPLIER_BILL_PO_CANCELLED'; end if;

  new.supplier_id := v_po.supplier_id;
  new.currency := v_po.currency;

  return new;
end;
$function$;

create trigger supplier_bills_validate_header
before insert or update of purchase_order_id, supplier_id, currency on public.supplier_bills
for each row execute function public.validate_supplier_bill_header();

create or replace function public.guard_supplier_bill_status_transition()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_transition text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'SUPPLIER_BILL_MUST_START_DRAFT'; end if;
    return new;
  end if;

  if new.status is not distinct from old.status then return new; end if;
  v_transition := current_setting('export_mca.supplier_bill_transition', true);

  if old.status = 'draft' and new.status = 'posted' and v_transition = 'post' then return new; end if;
  if old.status = 'draft' and new.status = 'void' and v_transition = 'void' then return new; end if;
  if old.status = 'posted' and new.status = 'void' and v_transition = 'void' then return new; end if;

  raise exception 'INVALID_SUPPLIER_BILL_STATUS_TRANSITION: % -> %', old.status, new.status;
end;
$function$;

create trigger supplier_bills_guard_status_insert
before insert on public.supplier_bills
for each row execute function public.guard_supplier_bill_status_transition();

create trigger supplier_bills_guard_status_update
before update of status on public.supplier_bills
for each row execute function public.guard_supplier_bill_status_transition();

create or replace function public.validate_supplier_bill_item()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_bill record;
  v_po_item record;
  v_existing numeric;
begin
  select purchase_order_id, currency, status
    into v_bill
  from public.supplier_bills
  where id = new.supplier_bill_id
  for update;

  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'draft' then raise exception 'SUPPLIER_BILL_ITEMS_LOCKED'; end if;

  select purchase_order_id, product_id, unit, ordered_quantity, unit_cost, currency
    into v_po_item
  from public.purchase_order_items
  where id = new.purchase_order_item_id
  for update;

  if not found then raise exception 'SUPPLIER_BILL_PO_ITEM_NOT_FOUND'; end if;
  if v_po_item.purchase_order_id <> v_bill.purchase_order_id then
    raise exception 'SUPPLIER_BILL_PO_ITEM_MISMATCH';
  end if;

  new.product_id := v_po_item.product_id;
  new.unit := v_po_item.unit;
  new.po_unit_cost_snapshot := v_po_item.unit_cost;
  new.currency := v_bill.currency;

  select coalesce(sum(sbi.billed_quantity),0)
    into v_existing
  from public.supplier_bill_items sbi
  join public.supplier_bills sb on sb.id = sbi.supplier_bill_id
  where sbi.purchase_order_item_id = new.purchase_order_item_id
    and sb.status <> 'void'
    and sbi.id <> new.id;

  if v_existing + new.billed_quantity > v_po_item.ordered_quantity then
    raise exception 'SUPPLIER_BILL_EXCEEDS_PO_QUANTITY';
  end if;

  return new;
end;
$function$;

create trigger supplier_bill_items_validate
before insert or update on public.supplier_bill_items
for each row execute function public.validate_supplier_bill_item();

create or replace function public.guard_supplier_bill_item_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_status text;
begin
  select status into v_status from public.supplier_bills where id = old.supplier_bill_id for update;
  if v_status is distinct from 'draft' then raise exception 'SUPPLIER_BILL_ITEMS_LOCKED'; end if;
  return old;
end;
$function$;

create trigger supplier_bill_items_guard_delete
before delete on public.supplier_bill_items
for each row execute function public.guard_supplier_bill_item_delete();

-- Payment header source-of-truth: supplier and currency come from the referenced PO.
create or replace function public.validate_supplier_payment_header()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_po record;
begin
  select supplier_id, currency, status
    into v_po
  from public.purchase_orders
  where id = new.purchase_order_id;

  if not found then raise exception 'SUPPLIER_PAYMENT_PO_NOT_FOUND'; end if;
  if v_po.status = 'cancelled' then raise exception 'SUPPLIER_PAYMENT_PO_CANCELLED'; end if;

  new.supplier_id := v_po.supplier_id;
  new.currency := v_po.currency;
  return new;
end;
$function$;

create trigger supplier_payments_validate_header
before insert or update of purchase_order_id, supplier_id, currency on public.supplier_payments
for each row execute function public.validate_supplier_payment_header();

create or replace function public.guard_supplier_payment_mutation()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_transition text;
begin
  if tg_op = 'INSERT' then
    if new.status <> 'posted' then raise exception 'SUPPLIER_PAYMENT_MUST_START_POSTED'; end if;
    return new;
  end if;

  if tg_op = 'DELETE' then raise exception 'SUPPLIER_PAYMENT_DELETE_FORBIDDEN'; end if;

  if new.status is distinct from old.status then
    v_transition := current_setting('export_mca.supplier_payment_transition', true);
    if old.status = 'posted' and new.status = 'reversed' and v_transition = 'reverse' then
      return new;
    end if;
    raise exception 'INVALID_SUPPLIER_PAYMENT_STATUS_TRANSITION: % -> %', old.status, new.status;
  end if;

  if old.status <> 'posted' then raise exception 'SUPPLIER_PAYMENT_REVERSED_IMMUTABLE'; end if;
  return new;
end;
$function$;

create trigger supplier_payments_guard_mutation
before insert or update or delete on public.supplier_payments
for each row execute function public.guard_supplier_payment_mutation();

create or replace function public.validate_supplier_payment_application()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
declare
  v_payment record;
  v_bill record;
  v_payment_applied numeric;
  v_bill_applied numeric;
  v_bill_total numeric;
begin
  select id, purchase_order_id, supplier_id, currency, amount, status
    into v_payment
  from public.supplier_payments
  where id = new.supplier_payment_id
  for update;

  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND'; end if;
  if v_payment.status <> 'posted' then raise exception 'SUPPLIER_PAYMENT_NOT_POSTED'; end if;

  select id, purchase_order_id, supplier_id, currency, status
    into v_bill
  from public.supplier_bills
  where id = new.supplier_bill_id
  for update;

  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'posted' then raise exception 'SUPPLIER_BILL_NOT_POSTED'; end if;

  if v_payment.purchase_order_id <> v_bill.purchase_order_id
     or v_payment.supplier_id <> v_bill.supplier_id
     or v_payment.currency <> v_bill.currency then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_CONTEXT_MISMATCH';
  end if;

  select coalesce(sum(amount),0)
    into v_payment_applied
  from public.supplier_payment_applications
  where supplier_payment_id = new.supplier_payment_id
    and id <> new.id;

  if v_payment_applied + new.amount > v_payment.amount then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_PAYMENT';
  end if;

  select coalesce(sum(line_total),0)
    into v_bill_total
  from public.supplier_bill_items
  where supplier_bill_id = new.supplier_bill_id;

  select coalesce(sum(spa.amount),0)
    into v_bill_applied
  from public.supplier_payment_applications spa
  join public.supplier_payments sp on sp.id = spa.supplier_payment_id
  where spa.supplier_bill_id = new.supplier_bill_id
    and spa.id <> new.id
    and sp.status = 'posted';

  if v_bill_applied + new.amount > v_bill_total then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL';
  end if;

  return new;
end;
$function$;

create trigger supplier_payment_applications_validate
before insert or update on public.supplier_payment_applications
for each row execute function public.validate_supplier_payment_application();

create or replace function public.guard_supplier_payment_application_delete()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if current_setting('export_mca.supplier_payment_application_delete', true) <> 'allow' then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_DELETE_FORBIDDEN';
  end if;
  return old;
end;
$function$;

create trigger supplier_payment_applications_guard_delete
before delete on public.supplier_payment_applications
for each row execute function public.guard_supplier_payment_application_delete();

-- PO billing capacity. Draft bills reserve capacity; posted bills are actual obligations; void bills do not count.
create or replace view public.purchase_order_ap_item_progress
with (security_invoker = true)
as
select
  poi.id as purchase_order_item_id,
  poi.purchase_order_id,
  poi.product_id,
  poi.ordered_quantity,
  poi.unit,
  poi.unit_cost as po_unit_cost,
  poi.currency,
  coalesce(sum(sbi.billed_quantity) filter (where sb.status = 'draft'),0)::numeric as draft_billed_quantity,
  coalesce(sum(sbi.billed_quantity) filter (where sb.status = 'posted'),0)::numeric as posted_billed_quantity,
  greatest(
    poi.ordered_quantity - coalesce(sum(sbi.billed_quantity) filter (where sb.status in ('draft','posted')),0),
    0
  )::numeric as available_to_bill_quantity
from public.purchase_order_items poi
left join public.supplier_bill_items sbi on sbi.purchase_order_item_id = poi.id
left join public.supplier_bills sb on sb.id = sbi.supplier_bill_id
group by poi.id;

create or replace view public.supplier_bill_financial_progress
with (security_invoker = true)
as
select
  sb.id as supplier_bill_id,
  sb.bill_number,
  sb.purchase_order_id,
  sb.supplier_id,
  sb.supplier_invoice_number,
  sb.bill_date,
  sb.due_date,
  sb.currency,
  sb.status,
  coalesce(lines.bill_total,0)::numeric as bill_total,
  case when sb.status = 'posted' then coalesce(apps.paid_amount,0) else 0 end::numeric as paid_amount,
  case when sb.status = 'posted' then greatest(coalesce(lines.bill_total,0) - coalesce(apps.paid_amount,0),0) else 0 end::numeric as balance_due,
  case
    when sb.status <> 'posted' then sb.status
    when coalesce(lines.bill_total,0) <= coalesce(apps.paid_amount,0) then 'paid'
    when coalesce(apps.paid_amount,0) > 0 then 'partial'
    else 'unpaid'
  end as payment_status,
  (
    sb.status = 'posted'
    and sb.due_date is not null
    and sb.due_date < current_date
    and coalesce(lines.bill_total,0) > coalesce(apps.paid_amount,0)
  ) as overdue
from public.supplier_bills sb
left join lateral (
  select sum(sbi.line_total) as bill_total
  from public.supplier_bill_items sbi
  where sbi.supplier_bill_id = sb.id
) lines on true
left join lateral (
  select sum(spa.amount) as paid_amount
  from public.supplier_payment_applications spa
  join public.supplier_payments sp on sp.id = spa.supplier_payment_id
  where spa.supplier_bill_id = sb.id
    and sp.status = 'posted'
) apps on true;

create or replace view public.supplier_payment_progress
with (security_invoker = true)
as
select
  sp.id as supplier_payment_id,
  sp.payment_number,
  sp.purchase_order_id,
  sp.supplier_id,
  sp.amount,
  sp.currency,
  sp.payment_date,
  sp.status,
  case when sp.status = 'posted' then coalesce(a.applied_amount,0) else 0 end::numeric as applied_amount,
  case when sp.status = 'posted' then greatest(sp.amount - coalesce(a.applied_amount,0),0) else 0 end::numeric as unapplied_amount,
  case
    when sp.status = 'reversed' then 'reversed'
    when coalesce(a.applied_amount,0) = 0 then 'unapplied'
    when coalesce(a.applied_amount,0) >= sp.amount then 'applied'
    else 'partial'
  end as application_status
from public.supplier_payments sp
left join lateral (
  select sum(spa.amount) as applied_amount
  from public.supplier_payment_applications spa
  join public.supplier_bills sb on sb.id = spa.supplier_bill_id
  where spa.supplier_payment_id = sp.id
    and sb.status = 'posted'
) a on true;

create or replace view public.purchase_order_ap_progress
with (security_invoker = true)
as
select
  po.id as purchase_order_id,
  po.po_number,
  po.supplier_id,
  po.currency,
  po.status as po_status,
  coalesce(b.draft_bill_total,0)::numeric as draft_bill_total,
  coalesce(b.posted_bill_total,0)::numeric as posted_bill_total,
  coalesce(p.posted_payment_total,0)::numeric as posted_payment_total,
  coalesce(p.unapplied_payment_total,0)::numeric as unapplied_payment_total,
  coalesce(b.balance_due,0)::numeric as balance_due
from public.purchase_orders po
left join lateral (
  select
    sum(fp.bill_total) filter (where fp.status = 'draft') as draft_bill_total,
    sum(fp.bill_total) filter (where fp.status = 'posted') as posted_bill_total,
    sum(fp.balance_due) filter (where fp.status = 'posted') as balance_due
  from public.supplier_bill_financial_progress fp
  where fp.purchase_order_id = po.id
) b on true
left join lateral (
  select
    sum(pp.amount) filter (where pp.status = 'posted') as posted_payment_total,
    sum(pp.unapplied_amount) filter (where pp.status = 'posted') as unapplied_payment_total
  from public.supplier_payment_progress pp
  where pp.purchase_order_id = po.id
) p on true;

-- Backend-only data boundary. B5.2 will expose controlled RPC mutations.
revoke all on public.supplier_bills from anon, authenticated;
revoke all on public.supplier_bill_items from anon, authenticated;
revoke all on public.supplier_payments from anon, authenticated;
revoke all on public.supplier_payment_applications from anon, authenticated;
revoke all on public.purchase_order_ap_item_progress from anon, authenticated;
revoke all on public.supplier_bill_financial_progress from anon, authenticated;
revoke all on public.supplier_payment_progress from anon, authenticated;
revoke all on public.purchase_order_ap_progress from anon, authenticated;

grant select, insert, update, delete on public.supplier_bills to service_role;
grant select, insert, update, delete on public.supplier_bill_items to service_role;
grant select, insert, update, delete on public.supplier_payments to service_role;
grant select, insert, update, delete on public.supplier_payment_applications to service_role;
grant select on public.purchase_order_ap_item_progress to service_role;
grant select on public.supplier_bill_financial_progress to service_role;
grant select on public.supplier_payment_progress to service_role;
grant select on public.purchase_order_ap_progress to service_role;

comment on table public.supplier_bills is 'Accounts Payable obligation from a supplier against one Purchase Order; never creates inventory.';
comment on table public.supplier_bill_items is 'Supplier bill lines tied to immutable PO lines; actual vendor unit cost is preserved separately from PO cost snapshot.';
comment on table public.supplier_payments is 'Cash outflow to a supplier against a PO. May remain unapplied as a prepayment until supplier bills exist.';
comment on table public.supplier_payment_applications is 'Application of supplier cash payments/prepayments to posted supplier bills.';
comment on view public.purchase_order_ap_item_progress is 'PO line billing capacity. Draft bills reserve capacity; posted bills are obligations; void bills release capacity.';
comment on view public.supplier_bill_financial_progress is 'Derived AP balance and overdue state from posted bills and active posted payment applications.';
comment on view public.supplier_payment_progress is 'Derived applied/unapplied supplier payment state.';
comment on view public.purchase_order_ap_progress is 'PO-level AP summary combining supplier bills, payments and remaining balances.';
