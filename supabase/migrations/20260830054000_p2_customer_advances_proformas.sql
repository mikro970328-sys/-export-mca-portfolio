-- P2 · Preventas, anticipos de clientes y proformas
-- Anticipos son movimientos de caja independientes de invoices/payments.

create sequence if not exists public.customer_advance_number_seq;
create sequence if not exists public.customer_advance_refund_number_seq;
create sequence if not exists public.proforma_number_seq;

create table if not exists public.customer_advances (
  id uuid primary key default gen_random_uuid(),
  advance_number text not null unique default ('ADV-' || lpad(nextval('public.customer_advance_number_seq')::text, 5, '0')),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  amount numeric not null check (amount > 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  received_date date not null default current_date,
  method text,
  reference text,
  status text not null default 'posted' check (status in ('posted','reversed')),
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.admin_users(id) on delete set null,
  reversal_reason text,
  constraint customer_advances_method_not_blank check (method is null or btrim(method) <> ''),
  constraint customer_advances_reference_not_blank check (reference is null or btrim(reference) <> ''),
  constraint customer_advances_reversal_reason_not_blank check (reversal_reason is null or btrim(reversal_reason) <> '')
);

create index if not exists customer_advances_sales_order_idx on public.customer_advances(sales_order_id, received_date desc, created_at desc);
create index if not exists customer_advances_client_idx on public.customer_advances(client_id, received_date desc, created_at desc);

create table if not exists public.customer_advance_applications (
  id uuid primary key default gen_random_uuid(),
  customer_advance_id uuid not null references public.customer_advances(id) on delete restrict,
  invoice_id uuid not null references public.invoices(id) on delete restrict,
  amount numeric not null check (amount > 0),
  status text not null default 'posted' check (status in ('posted','reversed')),
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.admin_users(id) on delete set null,
  reversal_reason text,
  constraint customer_advance_app_reversal_reason_not_blank check (reversal_reason is null or btrim(reversal_reason) <> '')
);

create index if not exists customer_advance_applications_advance_idx on public.customer_advance_applications(customer_advance_id, created_at desc);
create index if not exists customer_advance_applications_invoice_idx on public.customer_advance_applications(invoice_id, created_at desc);

create table if not exists public.customer_advance_refunds (
  id uuid primary key default gen_random_uuid(),
  refund_number text not null unique default ('ARF-' || lpad(nextval('public.customer_advance_refund_number_seq')::text, 5, '0')),
  customer_advance_id uuid not null references public.customer_advances(id) on delete restrict,
  amount numeric not null check (amount > 0),
  refund_date date not null default current_date,
  method text,
  reference text,
  status text not null default 'posted' check (status in ('posted','reversed')),
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversed_by uuid references public.admin_users(id) on delete set null,
  reversal_reason text,
  constraint customer_advance_refunds_method_not_blank check (method is null or btrim(method) <> ''),
  constraint customer_advance_refunds_reference_not_blank check (reference is null or btrim(reference) <> ''),
  constraint customer_advance_refunds_reversal_reason_not_blank check (reversal_reason is null or btrim(reversal_reason) <> '')
);

create index if not exists customer_advance_refunds_advance_idx on public.customer_advance_refunds(customer_advance_id, refund_date desc, created_at desc);

create table if not exists public.proformas (
  id uuid primary key default gen_random_uuid(),
  proforma_number text not null unique default ('PRO-' || lpad(nextval('public.proforma_number_seq')::text, 5, '0')),
  sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
  client_id uuid not null references public.clients(id) on delete restrict,
  importer_id uuid references public.importers(id) on delete restrict,
  issue_date date not null default current_date,
  valid_until date,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  customer_reference text,
  status text not null default 'draft' check (status in ('draft','issued','void')),
  notes text,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  issued_at timestamptz,
  issued_by uuid references public.admin_users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references public.admin_users(id) on delete set null,
  void_reason text,
  constraint proformas_valid_until_check check (valid_until is null or valid_until >= issue_date),
  constraint proformas_void_reason_not_blank check (void_reason is null or btrim(void_reason) <> '')
);

create index if not exists proformas_sales_order_idx on public.proformas(sales_order_id, created_at desc);
create index if not exists proformas_client_idx on public.proformas(client_id, created_at desc);

create table if not exists public.proforma_items (
  id uuid primary key default gen_random_uuid(),
  proforma_id uuid not null references public.proformas(id) on delete restrict,
  sales_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  sku text,
  description text not null,
  quantity numeric not null check (quantity > 0),
  unit text not null,
  unit_price numeric not null check (unit_price >= 0),
  line_total numeric not null check (line_total >= 0),
  notes text,
  created_at timestamptz not null default now(),
  unique(proforma_id, sales_order_item_id)
);

create index if not exists proforma_items_proforma_idx on public.proforma_items(proforma_id, created_at);

create or replace function public.validate_customer_advance_header()
returns trigger language plpgsql set search_path='public' as $$
declare v_so record;
begin
  select client_id,currency,status into v_so from public.sales_orders where id=new.sales_order_id;
  if not found then raise exception 'CUSTOMER_ADVANCE_SO_NOT_FOUND'; end if;
  if v_so.status not in ('confirmed','closed') then raise exception 'CUSTOMER_ADVANCE_SO_NOT_CONFIRMED'; end if;
  new.client_id:=v_so.client_id;
  new.currency:=v_so.currency;
  if tg_op='INSERT' and new.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_MUST_START_POSTED'; end if;
  return new;
end; $$;

create or replace function public.guard_customer_advance_mutation()
returns trigger language plpgsql set search_path='public' as $$
declare v_transition text;
begin
  if tg_op='DELETE' then raise exception 'CUSTOMER_ADVANCE_DELETE_FORBIDDEN'; end if;
  if new.sales_order_id is distinct from old.sales_order_id or new.client_id is distinct from old.client_id or
     new.amount is distinct from old.amount or new.currency is distinct from old.currency or new.received_date is distinct from old.received_date or
     new.method is distinct from old.method or new.reference is distinct from old.reference or new.notes is distinct from old.notes or new.created_by is distinct from old.created_by then
    raise exception 'CUSTOMER_ADVANCE_IMMUTABLE';
  end if;
  if new.status is not distinct from old.status then
    if new.reversed_at is distinct from old.reversed_at or new.reversed_by is distinct from old.reversed_by or new.reversal_reason is distinct from old.reversal_reason then
      raise exception 'CUSTOMER_ADVANCE_IMMUTABLE';
    end if;
    return new;
  end if;
  v_transition:=current_setting('export_mca.customer_advance_transition',true);
  if old.status='posted' and new.status='reversed' and v_transition='reverse' and nullif(btrim(new.reversal_reason),'') is not null then return new; end if;
  raise exception 'CUSTOMER_ADVANCE_STATUS_TRANSITION_INVALID';
end; $$;

drop trigger if exists customer_advances_validate on public.customer_advances;
create trigger customer_advances_validate before insert or update on public.customer_advances for each row execute function public.validate_customer_advance_header();
drop trigger if exists customer_advances_guard on public.customer_advances;
create trigger customer_advances_guard before update or delete on public.customer_advances for each row execute function public.guard_customer_advance_mutation();

create or replace function public.guard_customer_advance_application_mutation()
returns trigger language plpgsql set search_path='public' as $$
declare v_transition text;
begin
  if tg_op='INSERT' then if new.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_APPLICATION_MUST_START_POSTED'; end if; return new; end if;
  if tg_op='DELETE' then raise exception 'CUSTOMER_ADVANCE_APPLICATION_DELETE_FORBIDDEN'; end if;
  if new.customer_advance_id is distinct from old.customer_advance_id or new.invoice_id is distinct from old.invoice_id or
     new.amount is distinct from old.amount or new.notes is distinct from old.notes or new.created_by is distinct from old.created_by then
    raise exception 'CUSTOMER_ADVANCE_APPLICATION_IMMUTABLE';
  end if;
  if new.status is not distinct from old.status then return new; end if;
  v_transition:=current_setting('export_mca.customer_advance_application_transition',true);
  if old.status='posted' and new.status='reversed' and v_transition='reverse' and nullif(btrim(new.reversal_reason),'') is not null then return new; end if;
  raise exception 'CUSTOMER_ADVANCE_APPLICATION_STATUS_TRANSITION_INVALID';
end; $$;

create or replace function public.validate_customer_advance_application()
returns trigger language plpgsql set search_path='public' as $$
declare
  v_advance record; v_invoice record; v_advance_applied numeric; v_advance_refunded numeric;
  v_invoice_total numeric; v_invoice_cash numeric; v_invoice_advance numeric;
begin
  if new.status<>'posted' then return new; end if;
  select id,sales_order_id,client_id,currency,amount,status into v_advance from public.customer_advances where id=new.customer_advance_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_NOT_FOUND'; end if;
  if v_advance.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_NOT_POSTED'; end if;
  select id,sales_order_id,client_id,currency,status into v_invoice from public.invoices where id=new.invoice_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_INVOICE_NOT_FOUND'; end if;
  if v_invoice.status<>'issued' then raise exception 'CUSTOMER_ADVANCE_INVOICE_NOT_ISSUED'; end if;
  if v_invoice.sales_order_id<>v_advance.sales_order_id or v_invoice.client_id<>v_advance.client_id or v_invoice.currency<>v_advance.currency then
    raise exception 'CUSTOMER_ADVANCE_APPLICATION_CONTEXT_MISMATCH';
  end if;
  select coalesce(sum(amount),0) into v_advance_applied from public.customer_advance_applications where customer_advance_id=new.customer_advance_id and status='posted' and id<>new.id;
  select coalesce(sum(amount),0) into v_advance_refunded from public.customer_advance_refunds where customer_advance_id=new.customer_advance_id and status='posted';
  if v_advance_applied+v_advance_refunded+new.amount>v_advance.amount then raise exception 'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_AVAILABLE'; end if;
  select coalesce(sum(line_total),0) into v_invoice_total from public.invoice_items where invoice_id=new.invoice_id;
  select coalesce(sum(amount),0) into v_invoice_cash from public.payments where invoice_id=new.invoice_id and status='posted';
  select coalesce(sum(amount),0) into v_invoice_advance from public.customer_advance_applications where invoice_id=new.invoice_id and status='posted' and id<>new.id;
  if v_invoice_total<=0 then raise exception 'CUSTOMER_ADVANCE_INVOICE_HAS_NO_TOTAL'; end if;
  if v_invoice_cash+v_invoice_advance+new.amount>v_invoice_total then raise exception 'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE'; end if;
  return new;
end; $$;

drop trigger if exists customer_advance_applications_guard on public.customer_advance_applications;
create trigger customer_advance_applications_guard before insert or update or delete on public.customer_advance_applications for each row execute function public.guard_customer_advance_application_mutation();
drop trigger if exists customer_advance_applications_validate on public.customer_advance_applications;
create trigger customer_advance_applications_validate before insert or update on public.customer_advance_applications for each row execute function public.validate_customer_advance_application();

create or replace function public.guard_customer_advance_refund_mutation()
returns trigger language plpgsql set search_path='public' as $$
declare v_transition text;
begin
  if tg_op='INSERT' then if new.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_REFUND_MUST_START_POSTED'; end if; return new; end if;
  if tg_op='DELETE' then raise exception 'CUSTOMER_ADVANCE_REFUND_DELETE_FORBIDDEN'; end if;
  if new.customer_advance_id is distinct from old.customer_advance_id or new.amount is distinct from old.amount or new.refund_date is distinct from old.refund_date or
     new.method is distinct from old.method or new.reference is distinct from old.reference or new.notes is distinct from old.notes or new.created_by is distinct from old.created_by then
    raise exception 'CUSTOMER_ADVANCE_REFUND_IMMUTABLE';
  end if;
  if new.status is not distinct from old.status then return new; end if;
  v_transition:=current_setting('export_mca.customer_advance_refund_transition',true);
  if old.status='posted' and new.status='reversed' and v_transition='reverse' and nullif(btrim(new.reversal_reason),'') is not null then return new; end if;
  raise exception 'CUSTOMER_ADVANCE_REFUND_STATUS_TRANSITION_INVALID';
end; $$;

create or replace function public.validate_customer_advance_refund()
returns trigger language plpgsql set search_path='public' as $$
declare v_advance record; v_applied numeric; v_refunded numeric;
begin
  if new.status<>'posted' then return new; end if;
  select id,amount,status into v_advance from public.customer_advances where id=new.customer_advance_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_NOT_FOUND'; end if;
  if v_advance.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_NOT_POSTED'; end if;
  select coalesce(sum(amount),0) into v_applied from public.customer_advance_applications where customer_advance_id=new.customer_advance_id and status='posted';
  select coalesce(sum(amount),0) into v_refunded from public.customer_advance_refunds where customer_advance_id=new.customer_advance_id and status='posted' and id<>new.id;
  if v_applied+v_refunded+new.amount>v_advance.amount then raise exception 'CUSTOMER_ADVANCE_REFUND_EXCEEDS_AVAILABLE'; end if;
  return new;
end; $$;

drop trigger if exists customer_advance_refunds_guard on public.customer_advance_refunds;
create trigger customer_advance_refunds_guard before insert or update or delete on public.customer_advance_refunds for each row execute function public.guard_customer_advance_refund_mutation();
drop trigger if exists customer_advance_refunds_validate on public.customer_advance_refunds;
create trigger customer_advance_refunds_validate before insert or update on public.customer_advance_refunds for each row execute function public.validate_customer_advance_refund();

create or replace function public.register_customer_advance(
  p_sales_order_id uuid, p_amount numeric, p_received_date date default current_date,
  p_method text default null, p_reference text default null, p_notes text default null, p_actor uuid default null
) returns public.customer_advances language plpgsql security definer set search_path='public' as $$
declare v_row public.customer_advances;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'CUSTOMER_ADVANCE_AMOUNT_INVALID'; end if;
  insert into public.customer_advances(sales_order_id,client_id,amount,currency,received_date,method,reference,status,notes,created_by)
  values(p_sales_order_id,'00000000-0000-0000-0000-000000000000',p_amount,'USD',coalesce(p_received_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference),''),'posted',nullif(btrim(p_notes),''),p_actor)
  returning * into v_row;
  return v_row;
end; $$;

create or replace function public.reverse_customer_advance(p_customer_advance_id uuid,p_reason text,p_actor uuid default null)
returns public.customer_advances language plpgsql security definer set search_path='public' as $$
declare v_row public.customer_advances; v_reason text:=nullif(btrim(p_reason),'');
begin
  if v_reason is null then raise exception 'CUSTOMER_ADVANCE_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_row from public.customer_advances where id=p_customer_advance_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_NOT_FOUND'; end if;
  if v_row.status='reversed' then raise exception 'CUSTOMER_ADVANCE_ALREADY_REVERSED'; end if;
  if exists(select 1 from public.customer_advance_applications where customer_advance_id=v_row.id and status='posted') then raise exception 'CUSTOMER_ADVANCE_HAS_ACTIVE_APPLICATIONS'; end if;
  if exists(select 1 from public.customer_advance_refunds where customer_advance_id=v_row.id and status='posted') then raise exception 'CUSTOMER_ADVANCE_HAS_ACTIVE_REFUNDS'; end if;
  perform set_config('export_mca.customer_advance_transition','reverse',true);
  update public.customer_advances set status='reversed',reversed_at=now(),reversed_by=p_actor,reversal_reason=v_reason where id=v_row.id returning * into v_row;
  return v_row;
end; $$;

create or replace function public.apply_customer_advance(p_customer_advance_id uuid,p_invoice_id uuid,p_amount numeric,p_notes text default null,p_actor uuid default null)
returns public.customer_advance_applications language plpgsql security definer set search_path='public' as $$
declare v_row public.customer_advance_applications;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'CUSTOMER_ADVANCE_APPLICATION_AMOUNT_INVALID'; end if;
  insert into public.customer_advance_applications(customer_advance_id,invoice_id,amount,status,notes,created_by)
  values(p_customer_advance_id,p_invoice_id,p_amount,'posted',nullif(btrim(p_notes),''),p_actor) returning * into v_row;
  return v_row;
end; $$;

create or replace function public.reverse_customer_advance_application(p_application_id uuid,p_reason text,p_actor uuid default null)
returns public.customer_advance_applications language plpgsql security definer set search_path='public' as $$
declare v_row public.customer_advance_applications; v_reason text:=nullif(btrim(p_reason),'');
begin
  if v_reason is null then raise exception 'CUSTOMER_ADVANCE_APPLICATION_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_row from public.customer_advance_applications where id=p_application_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_APPLICATION_NOT_FOUND'; end if;
  if v_row.status='reversed' then raise exception 'CUSTOMER_ADVANCE_APPLICATION_ALREADY_REVERSED'; end if;
  perform set_config('export_mca.customer_advance_application_transition','reverse',true);
  update public.customer_advance_applications set status='reversed',reversed_at=now(),reversed_by=p_actor,reversal_reason=v_reason where id=v_row.id returning * into v_row;
  return v_row;
end; $$;

create or replace function public.refund_customer_advance(
  p_customer_advance_id uuid,p_amount numeric,p_refund_date date default current_date,p_method text default null,
  p_reference text default null,p_notes text default null,p_actor uuid default null
) returns public.customer_advance_refunds language plpgsql security definer set search_path='public' as $$
declare v_row public.customer_advance_refunds;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'CUSTOMER_ADVANCE_REFUND_AMOUNT_INVALID'; end if;
  insert into public.customer_advance_refunds(customer_advance_id,amount,refund_date,method,reference,status,notes,created_by)
  values(p_customer_advance_id,p_amount,coalesce(p_refund_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference),''),'posted',nullif(btrim(p_notes),''),p_actor) returning * into v_row;
  return v_row;
end; $$;

create or replace function public.reverse_customer_advance_refund(p_refund_id uuid,p_reason text,p_actor uuid default null)
returns public.customer_advance_refunds language plpgsql security definer set search_path='public' as $$
declare v_row public.customer_advance_refunds; v_reason text:=nullif(btrim(p_reason),'');
begin
  if v_reason is null then raise exception 'CUSTOMER_ADVANCE_REFUND_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_row from public.customer_advance_refunds where id=p_refund_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_REFUND_NOT_FOUND'; end if;
  if v_row.status='reversed' then raise exception 'CUSTOMER_ADVANCE_REFUND_ALREADY_REVERSED'; end if;
  perform set_config('export_mca.customer_advance_refund_transition','reverse',true);
  update public.customer_advance_refunds set status='reversed',reversed_at=now(),reversed_by=p_actor,reversal_reason=v_reason where id=v_row.id returning * into v_row;
  return v_row;
end; $$;

create or replace function public.validate_proforma_header()
returns trigger language plpgsql set search_path='public' as $$
declare v_so record;
begin
  select client_id,importer_id,currency,status,customer_reference into v_so from public.sales_orders where id=new.sales_order_id;
  if not found then raise exception 'PROFORMA_SO_NOT_FOUND'; end if;
  if v_so.status not in ('confirmed','closed') then raise exception 'PROFORMA_SO_NOT_CONFIRMED'; end if;
  new.client_id:=v_so.client_id; new.importer_id:=v_so.importer_id; new.currency:=v_so.currency; new.customer_reference:=v_so.customer_reference;
  if tg_op='INSERT' and new.status<>'draft' then raise exception 'PROFORMA_MUST_START_DRAFT'; end if;
  return new;
end; $$;

create or replace function public.guard_proforma_mutation()
returns trigger language plpgsql set search_path='public' as $$
declare v_transition text;
begin
  if tg_op='DELETE' then raise exception 'PROFORMA_DELETE_FORBIDDEN'; end if;
  if old.status<>'draft' and (new.sales_order_id is distinct from old.sales_order_id or new.client_id is distinct from old.client_id or new.importer_id is distinct from old.importer_id or
     new.issue_date is distinct from old.issue_date or new.valid_until is distinct from old.valid_until or new.currency is distinct from old.currency or new.customer_reference is distinct from old.customer_reference or new.notes is distinct from old.notes) then
    raise exception 'PROFORMA_STRUCTURE_LOCKED';
  end if;
  if new.status is not distinct from old.status then return new; end if;
  v_transition:=current_setting('export_mca.proforma_transition',true);
  if old.status='draft' and new.status='issued' and v_transition='issue' then return new; end if;
  if old.status in ('draft','issued') and new.status='void' and v_transition='void' and nullif(btrim(new.void_reason),'') is not null then return new; end if;
  raise exception 'PROFORMA_STATUS_TRANSITION_INVALID';
end; $$;

drop trigger if exists proformas_validate on public.proformas;
create trigger proformas_validate before insert or update on public.proformas for each row execute function public.validate_proforma_header();
drop trigger if exists proformas_guard on public.proformas;
create trigger proformas_guard before update or delete on public.proformas for each row execute function public.guard_proforma_mutation();

create or replace function public.prevent_proforma_item_mutation()
returns trigger language plpgsql set search_path='public' as $$
begin
  raise exception 'PROFORMA_ITEMS_IMMUTABLE';
end; $$;
drop trigger if exists proforma_items_immutable on public.proforma_items;
create trigger proforma_items_immutable before update or delete on public.proforma_items for each row execute function public.prevent_proforma_item_mutation();

create or replace function public.create_proforma(p_sales_order_id uuid,p_issue_date date default current_date,p_valid_until date default null,p_notes text default null,p_actor uuid default null)
returns public.proformas language plpgsql security definer set search_path='public' as $$
declare v_row public.proformas; v_so record;
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'PROFORMA_SO_NOT_FOUND'; end if;
  if v_so.status not in ('confirmed','closed') then raise exception 'PROFORMA_SO_NOT_CONFIRMED'; end if;
  if not exists(select 1 from public.sales_order_items where sales_order_id=v_so.id) then raise exception 'PROFORMA_SO_HAS_NO_ITEMS'; end if;
  insert into public.proformas(sales_order_id,client_id,importer_id,issue_date,valid_until,currency,customer_reference,status,notes,created_by)
  values(v_so.id,v_so.client_id,v_so.importer_id,coalesce(p_issue_date,current_date),p_valid_until,v_so.currency,v_so.customer_reference,'draft',nullif(btrim(p_notes),''),p_actor)
  returning * into v_row;
  insert into public.proforma_items(proforma_id,sales_order_item_id,product_id,sku,description,quantity,unit,unit_price,line_total,notes)
  select v_row.id,soi.id,soi.product_id,p.sku,concat_ws(' · ',nullif(p.sku,''),p.name),soi.ordered_quantity,soi.unit,
         coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price),coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price),soi.notes
  from public.sales_order_items soi join public.products p on p.id=soi.product_id where soi.sales_order_id=v_so.id order by soi.created_at;
  return v_row;
end; $$;

create or replace function public.transition_proforma(p_proforma_id uuid,p_action text,p_reason text default null,p_actor uuid default null)
returns public.proformas language plpgsql security definer set search_path='public' as $$
declare v_row public.proformas; v_action text:=lower(btrim(coalesce(p_action,''))); v_reason text:=nullif(btrim(p_reason),'');
begin
  select * into v_row from public.proformas where id=p_proforma_id for update;
  if not found then raise exception 'PROFORMA_NOT_FOUND'; end if;
  if v_action='issue' then
    if v_row.status<>'draft' then raise exception 'PROFORMA_NOT_DRAFT'; end if;
    if not exists(select 1 from public.proforma_items where proforma_id=v_row.id) then raise exception 'PROFORMA_HAS_NO_ITEMS'; end if;
    perform set_config('export_mca.proforma_transition','issue',true);
    update public.proformas set status='issued',issued_at=now(),issued_by=p_actor where id=v_row.id returning * into v_row;
  elsif v_action='void' then
    if v_row.status not in ('draft','issued') then raise exception 'PROFORMA_CANNOT_VOID'; end if;
    if v_reason is null then raise exception 'PROFORMA_VOID_REASON_REQUIRED'; end if;
    perform set_config('export_mca.proforma_transition','void',true);
    update public.proformas set status='void',voided_at=now(),voided_by=p_actor,void_reason=v_reason where id=v_row.id returning * into v_row;
  else raise exception 'PROFORMA_ACTION_INVALID'; end if;
  return v_row;
end; $$;

create or replace view public.customer_advance_progress with (security_invoker=true) as
with apps as (
  select customer_advance_id,coalesce(sum(amount),0) applied_amount,count(*)::integer application_count
  from public.customer_advance_applications where status='posted' group by customer_advance_id
), refunds as (
  select customer_advance_id,coalesce(sum(amount),0) refunded_amount,count(*)::integer refund_count
  from public.customer_advance_refunds where status='posted' group by customer_advance_id
)
select a.id as customer_advance_id,a.advance_number,a.sales_order_id,a.client_id,a.amount,a.currency,a.received_date,a.method,a.reference,a.status,a.notes,a.created_at,
       coalesce(apps.applied_amount,0) as applied_amount,coalesce(refunds.refunded_amount,0) as refunded_amount,
       case when a.status='posted' then greatest(a.amount-coalesce(apps.applied_amount,0)-coalesce(refunds.refunded_amount,0),0) else 0 end as available_amount,
       coalesce(apps.application_count,0) as application_count,coalesce(refunds.refund_count,0) as refund_count
from public.customer_advances a left join apps on apps.customer_advance_id=a.id left join refunds on refunds.customer_advance_id=a.id;

create or replace view public.proforma_financial_totals with (security_invoker=true) as
select p.id as proforma_id,p.proforma_number,p.sales_order_id,p.client_id,p.currency,p.status,p.issue_date,p.valid_until,
       coalesce(sum(pi.line_total),0) as total,count(pi.id)::integer as item_count
from public.proformas p left join public.proforma_items pi on pi.proforma_id=p.id
group by p.id;

-- Invoice settlement now includes cash payments + applied customer advances.
create or replace view public.invoice_financial_progress with (security_invoker=true) as
with line_totals as (
  select invoice_id,coalesce(sum(line_total),0) total from public.invoice_items group by invoice_id
), cash_payment_totals as (
  select invoice_id,coalesce(sum(amount),0) cash_payment_amount from public.payments where status='posted' and invoice_id is not null group by invoice_id
), advance_totals as (
  select caa.invoice_id,coalesce(sum(caa.amount),0) advance_applied_amount
  from public.customer_advance_applications caa join public.customer_advances ca on ca.id=caa.customer_advance_id
  where caa.status='posted' and ca.status='posted' group by caa.invoice_id
)
select i.id as invoice_id,i.invoice_number,i.sales_order_id,i.client_id,i.status as invoice_status,i.issue_date,i.due_date,i.currency,
       coalesce(lt.total,0) as subtotal,0::numeric as tax_total,coalesce(lt.total,0) as total,
       coalesce(cpt.cash_payment_amount,0)+coalesce(at.advance_applied_amount,0) as paid_amount,
       greatest(coalesce(lt.total,0)-coalesce(cpt.cash_payment_amount,0)-coalesce(at.advance_applied_amount,0),0) as balance_due,
       case when i.status='draft' then 'draft' when i.status='void' then 'void'
            when coalesce(cpt.cash_payment_amount,0)+coalesce(at.advance_applied_amount,0)>=coalesce(lt.total,0) and coalesce(lt.total,0)>0 then 'paid'
            when coalesce(cpt.cash_payment_amount,0)+coalesce(at.advance_applied_amount,0)>0 then 'partial'
            when i.due_date is not null and i.due_date<current_date then 'overdue' else 'unpaid' end as payment_status,
       coalesce(cpt.cash_payment_amount,0) as cash_payment_amount,
       coalesce(at.advance_applied_amount,0) as advance_applied_amount,
       coalesce(cpt.cash_payment_amount,0)+coalesce(at.advance_applied_amount,0) as settlement_amount
from public.invoices i left join line_totals lt on lt.invoice_id=i.id left join cash_payment_totals cpt on cpt.invoice_id=i.id left join advance_totals at on at.invoice_id=i.id;

create or replace view public.sales_order_customer_financial_progress with (security_invoker=true) as
with advance_totals as (
  select a.sales_order_id,
         coalesce(sum(a.amount) filter(where a.status='posted'),0) advance_cash_received,
         coalesce(sum(cap.refunded_amount) filter(where a.status='posted'),0) advance_cash_refunded,
         coalesce(sum(cap.applied_amount) filter(where a.status='posted'),0) advance_applied_amount,
         coalesce(sum(cap.available_amount) filter(where a.status='posted'),0) advance_available_amount
  from public.customer_advances a left join public.customer_advance_progress cap on cap.customer_advance_id=a.id group by a.sales_order_id
), invoice_totals as (
  select sales_order_id,
         coalesce(sum(total) filter(where invoice_status='issued'),0) issued_invoice_total,
         coalesce(sum(cash_payment_amount) filter(where invoice_status='issued'),0) invoice_cash_received,
         coalesce(sum(advance_applied_amount) filter(where invoice_status='issued'),0) invoice_advance_applied,
         coalesce(sum(settlement_amount) filter(where invoice_status='issued'),0) invoice_settlement_total,
         coalesce(sum(balance_due) filter(where invoice_status='issued'),0) invoice_balance_due
  from public.invoice_financial_progress group by sales_order_id
)
select so.id as sales_order_id,so.so_number,so.client_id,so.currency,
       coalesce(sip.sales_order_total,0) sales_order_total,
       coalesce(a.advance_cash_received,0) advance_cash_received,
       coalesce(a.advance_cash_refunded,0) advance_cash_refunded,
       coalesce(a.advance_applied_amount,0) advance_applied_amount,
       coalesce(a.advance_available_amount,0) advance_available_amount,
       coalesce(i.issued_invoice_total,0) issued_invoice_total,
       coalesce(i.invoice_cash_received,0) invoice_cash_received,
       coalesce(i.invoice_advance_applied,0) invoice_advance_applied,
       coalesce(i.invoice_settlement_total,0) invoice_settlement_total,
       coalesce(i.invoice_balance_due,0) invoice_balance_due,
       coalesce(a.advance_cash_received,0)+coalesce(i.invoice_cash_received,0) as cash_received_gross,
       coalesce(a.advance_cash_received,0)-coalesce(a.advance_cash_refunded,0)+coalesce(i.invoice_cash_received,0) as cash_received_net,
       greatest(coalesce(sip.sales_order_total,0)-(coalesce(a.advance_cash_received,0)-coalesce(a.advance_cash_refunded,0)+coalesce(i.invoice_cash_received,0)),0) as commercial_cash_gap
from public.sales_orders so left join public.sales_order_invoice_progress sip on sip.sales_order_id=so.id left join advance_totals a on a.sales_order_id=so.id left join invoice_totals i on i.sales_order_id=so.id;

-- Generated Proforma PDFs use the existing versioned document storage, but remain a distinct source.
alter table public.documents drop constraint if exists documents_generated_source_check;
alter table public.documents add constraint documents_generated_source_check check (
  (generated=false and source_type is null and source_id is null and content_sha256 is null and generated_at is null)
  or
  (generated=true and source_type in ('invoice','load','proforma') and source_id is not null and content_sha256 ~ '^[0-9a-f]{64}$' and generated_at is not null)
);

alter table public.customer_advances enable row level security;
alter table public.customer_advance_applications enable row level security;
alter table public.customer_advance_refunds enable row level security;
alter table public.proformas enable row level security;
alter table public.proforma_items enable row level security;

revoke all on public.customer_advances,public.customer_advance_applications,public.customer_advance_refunds,public.proformas,public.proforma_items from anon,authenticated;
grant select,insert,update,delete on public.customer_advances,public.customer_advance_applications,public.customer_advance_refunds,public.proformas,public.proforma_items to service_role;
revoke all on public.customer_advance_progress,public.proforma_financial_totals,public.sales_order_customer_financial_progress from anon,authenticated;
grant select on public.customer_advance_progress,public.proforma_financial_totals,public.sales_order_customer_financial_progress to service_role;
revoke all on public.invoice_financial_progress from anon,authenticated;
grant select on public.invoice_financial_progress to service_role;

grant usage,select on sequence public.customer_advance_number_seq,public.customer_advance_refund_number_seq,public.proforma_number_seq to service_role;

revoke execute on function public.register_customer_advance(uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.reverse_customer_advance(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.apply_customer_advance(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
revoke execute on function public.reverse_customer_advance_application(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.refund_customer_advance(uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated;
revoke execute on function public.reverse_customer_advance_refund(uuid,text,uuid) from public,anon,authenticated;
revoke execute on function public.create_proforma(uuid,date,date,text,uuid) from public,anon,authenticated;
revoke execute on function public.transition_proforma(uuid,text,text,uuid) from public,anon,authenticated;

grant execute on function public.register_customer_advance(uuid,numeric,date,text,text,text,uuid) to service_role;
grant execute on function public.reverse_customer_advance(uuid,text,uuid) to service_role;
grant execute on function public.apply_customer_advance(uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function public.reverse_customer_advance_application(uuid,text,uuid) to service_role;
grant execute on function public.refund_customer_advance(uuid,numeric,date,text,text,text,uuid) to service_role;
grant execute on function public.reverse_customer_advance_refund(uuid,text,uuid) to service_role;
grant execute on function public.create_proforma(uuid,date,date,text,uuid) to service_role;
grant execute on function public.transition_proforma(uuid,text,text,uuid) to service_role;
