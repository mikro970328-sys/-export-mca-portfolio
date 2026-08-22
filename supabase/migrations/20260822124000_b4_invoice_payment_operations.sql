-- B4.2 · Operaciones transaccionales de Facturación y Cobros
-- Toda mutación comercial/financiera pasa por RPCs backend-only.

-- Aísla payments del Expediente legacy sin perder columnas de compatibilidad.
do $$
begin
  if exists (select 1 from public.payments where invoice_id is null) then
    raise exception 'B4_UNAPPLIED_PAYMENTS_EXIST';
  end if;
end $$;

alter table public.payments drop constraint if exists payments_operation_id_fkey;
alter table public.payments
  add constraint payments_operation_id_fkey
  foreign key (operation_id) references public.operations(id) on delete set null;

alter table public.payments drop constraint if exists payments_invoice_id_fkey;
alter table public.payments alter column invoice_id set not null;
alter table public.payments
  add constraint payments_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete restrict;

create index if not exists idx_payments_client_id on public.payments(client_id);
create index if not exists idx_payments_created_by on public.payments(created_by);

-- El recálculo financiero de operations pertenece al modelo legacy y no a Accounts Receivable.
drop trigger if exists trg_payments_sync_totals on public.payments;
drop policy if exists authenticated_access_payments on public.payments;

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

  if old.status in ('draft','issued') and new.status = 'void' then
    if exists (
      select 1 from public.payments
      where invoice_id = old.id and status = 'posted'
    ) then
      raise exception 'INVOICE_HAS_POSTED_PAYMENTS';
    end if;
    return new;
  end if;

  raise exception 'INVOICE_STATUS_TRANSITION_INVALID';
end;
$function$;

create or replace function public.populate_invoice_items(
  p_invoice_id uuid,
  p_lines jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_line jsonb;
  v_so_item_id uuid;
  v_quantity numeric;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVOICE_HAS_NO_ITEMS';
  end if;
  if jsonb_array_length(p_lines) > 500 then raise exception 'INVOICE_TOO_MANY_ITEMS'; end if;

  for v_line in select value from jsonb_array_elements(p_lines)
  loop
    if jsonb_typeof(v_line) <> 'object' then raise exception 'INVOICE_ITEM_INVALID'; end if;
    v_so_item_id := nullif(btrim(v_line->>'sales_order_item_id'),'')::uuid;
    v_quantity := coalesce(nullif(btrim(v_line->>'quantity'),'')::numeric,0);
    if v_so_item_id is null then raise exception 'INVOICE_SO_ITEM_REQUIRED'; end if;
    if v_quantity <= 0 then raise exception 'INVOICE_QUANTITY_INVALID'; end if;

    insert into public.invoice_items(invoice_id, sales_order_item_id, product_id, description, quantity, unit, unit_price, notes)
    values (
      p_invoice_id,
      v_so_item_id,
      '00000000-0000-0000-0000-000000000000'::uuid,
      'snapshot',
      v_quantity,
      'unit',
      0,
      nullif(btrim(v_line->>'notes'),'')
    );
  end loop;
end;
$function$;

create or replace function public.create_invoice_plan(
  p_sales_order_id uuid,
  p_lines jsonb,
  p_issue_date date default current_date,
  p_due_date date default null,
  p_operation_id uuid default null,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_invoice public.invoices;
  v_so_status text;
begin
  select status into v_so_status
  from public.sales_orders
  where id = p_sales_order_id
  for update;
  if not found then raise exception 'INVOICE_SO_NOT_FOUND'; end if;
  if v_so_status not in ('confirmed','closed') then raise exception 'INVOICE_SO_NOT_BILLABLE'; end if;

  insert into public.invoices(sales_order_id, operation_id, issue_date, due_date, status, notes)
  values (p_sales_order_id, p_operation_id, coalesce(p_issue_date,current_date), p_due_date, 'draft', nullif(btrim(p_notes),''))
  returning * into v_invoice;

  perform public.populate_invoice_items(v_invoice.id, p_lines);
  select * into v_invoice from public.invoices where id = v_invoice.id;
  return v_invoice;
end;
$function$;

create or replace function public.replace_invoice_plan(
  p_invoice_id uuid,
  p_sales_order_id uuid,
  p_lines jsonb,
  p_issue_date date default current_date,
  p_due_date date default null,
  p_operation_id uuid default null,
  p_notes text default null
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_invoice public.invoices;
  v_so_status text;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status <> 'draft' then raise exception 'INVOICE_NOT_DRAFT'; end if;

  select status into v_so_status from public.sales_orders where id = p_sales_order_id for update;
  if not found then raise exception 'INVOICE_SO_NOT_FOUND'; end if;
  if v_so_status not in ('confirmed','closed') then raise exception 'INVOICE_SO_NOT_BILLABLE'; end if;

  delete from public.invoice_items where invoice_id = p_invoice_id;
  update public.invoices
  set sales_order_id = p_sales_order_id,
      operation_id = p_operation_id,
      issue_date = coalesce(p_issue_date,current_date),
      due_date = p_due_date,
      notes = nullif(btrim(p_notes),''),
      updated_at = now()
  where id = p_invoice_id;

  perform public.populate_invoice_items(p_invoice_id, p_lines);
  select * into v_invoice from public.invoices where id = p_invoice_id;
  return v_invoice;
end;
$function$;

create or replace function public.transition_invoice(
  p_invoice_id uuid,
  p_action text
)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_invoice public.invoices;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_target text;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  if v_action = 'issue' then
    if v_invoice.status <> 'draft' then raise exception 'INVOICE_NOT_DRAFT'; end if;
    v_target := 'issued';
  elsif v_action = 'void' then
    if v_invoice.status not in ('draft','issued') then raise exception 'INVOICE_CANNOT_VOID'; end if;
    v_target := 'void';
  else
    raise exception 'INVOICE_ACTION_INVALID';
  end if;

  update public.invoices set status = v_target, updated_at = now() where id = p_invoice_id;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  return v_invoice;
end;
$function$;

create or replace function public.guard_payment_structure()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'UPDATE' and (
    new.invoice_id is distinct from old.invoice_id or
    new.operation_id is distinct from old.operation_id or
    new.client_id is distinct from old.client_id or
    new.amount is distinct from old.amount or
    new.currency is distinct from old.currency or
    new.payment_date is distinct from old.payment_date or
    new.method is distinct from old.method or
    new.reference_number is distinct from old.reference_number
  ) then
    raise exception 'PAYMENT_STRUCTURE_LOCKED';
  end if;
  return new;
end;
$function$;

create trigger payments_guard_structure
before update on public.payments
for each row execute function public.guard_payment_structure();

create or replace function public.guard_payment_status()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status = 'reversed' then raise exception 'PAYMENT_STATUS_FINAL'; end if;
  if old.status = 'pending' and new.status in ('posted','reversed') then return new; end if;
  if old.status = 'posted' and new.status = 'reversed' then return new; end if;
  raise exception 'PAYMENT_STATUS_TRANSITION_INVALID';
end;
$function$;

create trigger payments_guard_status
before update of status on public.payments
for each row execute function public.guard_payment_status();

create or replace function public.validate_invoice_payment()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_invoice public.invoices;
  v_total numeric;
  v_existing numeric;
begin
  if tg_op = 'INSERT' and new.status = 'reversed' then raise exception 'PAYMENT_INVALID_INITIAL_STATUS'; end if;

  select * into v_invoice from public.invoices where id = new.invoice_id for update;
  if not found then raise exception 'PAYMENT_INVOICE_NOT_FOUND'; end if;
  if new.status <> 'reversed' and v_invoice.status <> 'issued' then raise exception 'PAYMENT_INVOICE_NOT_ISSUED'; end if;

  new.client_id := v_invoice.client_id;
  new.currency := v_invoice.currency;
  new.operation_id := null;

  if new.status = 'posted' then
    select coalesce(sum(line_total),0) into v_total from public.invoice_items where invoice_id = new.invoice_id;
    select coalesce(sum(amount),0) into v_existing
    from public.payments
    where invoice_id = new.invoice_id and status = 'posted' and id <> new.id;

    if v_total <= 0 then raise exception 'PAYMENT_INVOICE_HAS_NO_TOTAL'; end if;
    if v_existing + new.amount > v_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  end if;

  return new;
end;
$function$;

create trigger payments_validate_invoice
before insert or update of invoice_id, client_id, amount, currency, status, operation_id
on public.payments
for each row execute function public.validate_invoice_payment();

create or replace function public.prevent_payment_delete()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  raise exception 'PAYMENT_DELETE_NOT_ALLOWED';
end;
$function$;

create trigger payments_prevent_delete
before delete on public.payments
for each row execute function public.prevent_payment_delete();

create or replace function public.register_invoice_payment(
  p_invoice_id uuid,
  p_amount numeric,
  p_payment_date date default current_date,
  p_method text default null,
  p_reference_number text default null,
  p_notes text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments;
begin
  if coalesce(p_amount,0) <= 0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;

  insert into public.payments(
    invoice_id, operation_id, client_id, amount, currency,
    payment_date, method, reference_number, status, notes, created_by
  ) values (
    p_invoice_id, null, '00000000-0000-0000-0000-000000000000'::uuid,
    p_amount, 'USD', coalesce(p_payment_date,current_date),
    nullif(btrim(p_method),''), nullif(btrim(p_reference_number),''), 'posted',
    nullif(btrim(p_notes),''), null
  ) returning * into v_payment;

  return v_payment;
end;
$function$;

create or replace function public.reverse_invoice_payment(
  p_payment_id uuid,
  p_reason text default null
)
returns public.payments
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where id = p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  if v_payment.status = 'reversed' then raise exception 'PAYMENT_ALREADY_REVERSED'; end if;

  update public.payments
  set status = 'reversed',
      notes = case
        when nullif(btrim(p_reason),'') is null then notes
        when nullif(btrim(notes),'') is null then btrim(p_reason)
        else notes || E'\nReverso: ' || btrim(p_reason)
      end
  where id = p_payment_id
  returning * into v_payment;

  return v_payment;
end;
$function$;

-- Backend-only: lectura directa, mutaciones únicamente por RPC.
revoke all on table public.payments from anon, authenticated;
revoke insert, update, delete on table public.payments from service_role;
grant select on table public.payments to service_role;

revoke all on function public.populate_invoice_items(uuid,jsonb) from public, anon, authenticated, service_role;
revoke all on function public.create_invoice_plan(uuid,jsonb,date,date,uuid,text) from public, anon, authenticated;
revoke all on function public.replace_invoice_plan(uuid,uuid,jsonb,date,date,uuid,text) from public, anon, authenticated;
revoke all on function public.transition_invoice(uuid,text) from public, anon, authenticated;
revoke all on function public.register_invoice_payment(uuid,numeric,date,text,text,text) from public, anon, authenticated;
revoke all on function public.reverse_invoice_payment(uuid,text) from public, anon, authenticated;

grant execute on function public.create_invoice_plan(uuid,jsonb,date,date,uuid,text) to service_role;
grant execute on function public.replace_invoice_plan(uuid,uuid,jsonb,date,date,uuid,text) to service_role;
grant execute on function public.transition_invoice(uuid,text) to service_role;
grant execute on function public.register_invoice_payment(uuid,numeric,date,text,text,text) to service_role;
grant execute on function public.reverse_invoice_payment(uuid,text) to service_role;

comment on function public.create_invoice_plan(uuid,jsonb,date,date,uuid,text) is 'Crea atómicamente una factura draft y sus líneas desde una Sales Order.';
comment on function public.replace_invoice_plan(uuid,uuid,jsonb,date,date,uuid,text) is 'Reemplaza atómicamente una factura mientras está draft.';
comment on function public.transition_invoice(uuid,text) is 'Lifecycle controlado de factura: issue / void.';
comment on function public.register_invoice_payment(uuid,numeric,date,text,text,text) is 'Registra un cobro posted contra una factura issued sin permitir sobrepago.';
comment on function public.reverse_invoice_payment(uuid,text) is 'Revierte un cobro sin borrarlo físicamente.';
