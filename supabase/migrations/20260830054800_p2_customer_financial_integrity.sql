-- P2 · Integridad cruzada anticipos ↔ invoices ↔ Sales Orders

create or replace function public.validate_customer_advance_header()
returns trigger language plpgsql set search_path='public' as $$
declare v_so record;
begin
  select client_id,currency,status into v_so from public.sales_orders where id=new.sales_order_id;
  if not found then raise exception 'CUSTOMER_ADVANCE_SO_NOT_FOUND'; end if;
  if tg_op='INSERT' and v_so.status not in ('confirmed','closed') then raise exception 'CUSTOMER_ADVANCE_SO_NOT_CONFIRMED'; end if;
  new.client_id:=v_so.client_id;
  new.currency:=v_so.currency;
  if tg_op='INSERT' and new.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_MUST_START_POSTED'; end if;
  return new;
end; $$;

create or replace function public.validate_invoice_payment()
returns trigger language plpgsql set search_path='public' as $$
declare
  v_invoice public.invoices;
  v_total numeric;
  v_existing numeric;
  v_advance_applied numeric;
begin
  if tg_op='INSERT' and new.status='reversed' then raise exception 'PAYMENT_INVALID_INITIAL_STATUS'; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id for update;
  if not found then raise exception 'PAYMENT_INVOICE_NOT_FOUND'; end if;
  if new.status<>'reversed' and v_invoice.status<>'issued' then raise exception 'PAYMENT_INVOICE_NOT_ISSUED'; end if;
  new.client_id:=v_invoice.client_id;
  new.currency:=v_invoice.currency;
  new.operation_id:=null;
  if new.status='posted' then
    select coalesce(sum(line_total),0) into v_total from public.invoice_items where invoice_id=new.invoice_id;
    select coalesce(sum(amount),0) into v_existing from public.payments where invoice_id=new.invoice_id and status='posted' and id<>new.id;
    select coalesce(sum(caa.amount),0) into v_advance_applied
      from public.customer_advance_applications caa
      join public.customer_advances ca on ca.id=caa.customer_advance_id
      where caa.invoice_id=new.invoice_id and caa.status='posted' and ca.status='posted';
    if v_total<=0 then raise exception 'PAYMENT_INVOICE_HAS_NO_TOTAL'; end if;
    if v_existing+v_advance_applied+new.amount>v_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  end if;
  return new;
end; $$;

create or replace function public.guard_invoice_status()
returns trigger language plpgsql set search_path='public' as $$
begin
  if new.status is not distinct from old.status then return new; end if;
  if old.status='void' then raise exception 'INVOICE_STATUS_FINAL'; end if;
  if old.status='draft' and new.status='issued' then
    if not exists(select 1 from public.invoice_items where invoice_id=old.id) then raise exception 'INVOICE_HAS_NO_ITEMS'; end if;
    return new;
  end if;
  if old.status in ('draft','issued') and new.status='void' then
    if exists(select 1 from public.payments where invoice_id=old.id and status='posted') then raise exception 'INVOICE_HAS_POSTED_PAYMENTS'; end if;
    if exists(select 1 from public.customer_advance_applications where invoice_id=old.id and status='posted') then raise exception 'INVOICE_HAS_POSTED_ADVANCE_APPLICATIONS'; end if;
    return new;
  end if;
  raise exception 'INVOICE_STATUS_TRANSITION_INVALID';
end; $$;

create or replace function public.transition_sales_order(p_sales_order_id uuid,p_action text)
returns public.sales_orders language plpgsql security definer set search_path='public' as $$
declare v_so public.sales_orders;v_action text:=lower(btrim(coalesce(p_action,'')));v_target text;
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'SO_NOT_FOUND'; end if;
  if v_action='confirm' then
    if v_so.status<>'draft' then raise exception 'SO_NOT_DRAFT'; end if;
    v_target:='confirmed';
  elsif v_action='cancel' then
    if v_so.status not in ('draft','confirmed') then raise exception 'SO_CANNOT_CANCEL'; end if;
    if exists(
      select 1 from public.customer_advance_progress cap
      where cap.sales_order_id=v_so.id and cap.status='posted' and (cap.applied_amount>0 or cap.available_amount>0)
    ) then raise exception 'SO_HAS_ACTIVE_CUSTOMER_ADVANCE'; end if;
    v_target:='cancelled';
  elsif v_action='close' then
    if v_so.status<>'confirmed' then raise exception 'SO_CANNOT_CLOSE'; end if;
    v_target:='closed';
  else raise exception 'SO_ACTION_INVALID'; end if;
  update public.sales_orders set status=v_target where id=v_so.id;
  select * into v_so from public.sales_orders where id=v_so.id;
  return v_so;
end; $$;

create or replace function public.validate_proforma_header()
returns trigger language plpgsql set search_path='public' as $$
declare v_so record;
begin
  select client_id,importer_id,currency,status,customer_reference into v_so from public.sales_orders where id=new.sales_order_id;
  if not found then raise exception 'PROFORMA_SO_NOT_FOUND'; end if;
  if tg_op='INSERT' or new.status='issued' then
    if v_so.status not in ('confirmed','closed') then raise exception 'PROFORMA_SO_NOT_CONFIRMED'; end if;
  end if;
  new.client_id:=v_so.client_id;
  new.importer_id:=v_so.importer_id;
  new.currency:=v_so.currency;
  new.customer_reference:=v_so.customer_reference;
  if tg_op='INSERT' and new.status<>'draft' then raise exception 'PROFORMA_MUST_START_DRAFT'; end if;
  return new;
end; $$;

revoke execute on function public.transition_sales_order(uuid,text) from public,anon,authenticated;
grant execute on function public.transition_sales_order(uuid,text) to service_role;
