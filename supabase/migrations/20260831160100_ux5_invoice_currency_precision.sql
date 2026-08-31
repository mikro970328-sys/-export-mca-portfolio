-- UX-5 · Financial settlement precision.
-- The cash ledger stores payment amounts at two decimals. Invoice settlement must use
-- the same precision in DB so a displayed USD 474.29 balance can be settled by USD 474.29.

create or replace view public.invoice_financial_progress
with (security_invoker=true)
as
with line_totals as (
  select invoice_id,coalesce(sum(round(line_total,2)),0::numeric) as total
  from public.invoice_items
  group by invoice_id
), cash_payment_totals as (
  select invoice_id,coalesce(round(sum(amount),2),0::numeric) as cash_payment_amount
  from public.payments
  where status='posted' and invoice_id is not null
  group by invoice_id
), advance_totals as (
  select caa.invoice_id,coalesce(round(sum(caa.amount),2),0::numeric) as advance_applied_amount
  from public.customer_advance_applications caa
  join public.customer_advances ca on ca.id=caa.customer_advance_id
  where caa.status='posted' and ca.status='posted'
  group by caa.invoice_id
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
  coalesce(lt.total,0::numeric) as subtotal,
  0::numeric as tax_total,
  coalesce(lt.total,0::numeric) as total,
  round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2) as paid_amount,
  greatest(round(coalesce(lt.total,0::numeric)-coalesce(cpt.cash_payment_amount,0::numeric)-coalesce(at.advance_applied_amount,0::numeric),2),0::numeric) as balance_due,
  case
    when i.status='draft' then 'draft'
    when i.status='void' then 'void'
    when round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2)>=coalesce(lt.total,0::numeric) and coalesce(lt.total,0::numeric)>0 then 'paid'
    when round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2)>0 then 'partial'
    when i.due_date is not null and i.due_date<current_date then 'overdue'
    else 'unpaid'
  end as payment_status,
  coalesce(cpt.cash_payment_amount,0::numeric) as cash_payment_amount,
  coalesce(at.advance_applied_amount,0::numeric) as advance_applied_amount,
  round(coalesce(cpt.cash_payment_amount,0::numeric)+coalesce(at.advance_applied_amount,0::numeric),2) as settlement_amount
from public.invoices i
left join line_totals lt on lt.invoice_id=i.id
left join cash_payment_totals cpt on cpt.invoice_id=i.id
left join advance_totals at on at.invoice_id=i.id;

create or replace function public.validate_invoice_payment()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
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
    select coalesce(sum(round(line_total,2)),0) into v_total from public.invoice_items where invoice_id=new.invoice_id;
    select coalesce(round(sum(amount),2),0) into v_existing from public.payments where invoice_id=new.invoice_id and status='posted' and id<>new.id;
    select coalesce(round(sum(caa.amount),2),0) into v_advance_applied
    from public.customer_advance_applications caa
    join public.customer_advances ca on ca.id=caa.customer_advance_id
    where caa.invoice_id=new.invoice_id and caa.status='posted' and ca.status='posted';
    if v_total<=0 then raise exception 'PAYMENT_INVOICE_HAS_NO_TOTAL'; end if;
    if round(v_existing+v_advance_applied+new.amount,2)>v_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
  end if;
  return new;
end;
$$;

create or replace function public.validate_customer_advance_application()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_advance record;
  v_invoice record;
  v_advance_applied numeric;
  v_advance_refunded numeric;
  v_invoice_total numeric;
  v_invoice_cash numeric;
  v_invoice_advance numeric;
begin
  if new.status<>'posted' then return new; end if;
  select id,sales_order_id,client_id,currency,amount,status into v_advance from public.customer_advances where id=new.customer_advance_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_NOT_FOUND'; end if;
  if v_advance.status<>'posted' then raise exception 'CUSTOMER_ADVANCE_NOT_POSTED'; end if;
  select id,sales_order_id,client_id,currency,status into v_invoice from public.invoices where id=new.invoice_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_INVOICE_NOT_FOUND'; end if;
  if v_invoice.status<>'issued' then raise exception 'CUSTOMER_ADVANCE_INVOICE_NOT_ISSUED'; end if;
  if v_invoice.sales_order_id<>v_advance.sales_order_id or v_invoice.client_id<>v_advance.client_id or v_invoice.currency<>v_advance.currency then raise exception 'CUSTOMER_ADVANCE_APPLICATION_CONTEXT_MISMATCH'; end if;
  select coalesce(sum(amount),0) into v_advance_applied from public.customer_advance_applications where customer_advance_id=new.customer_advance_id and status='posted' and id<>new.id;
  select coalesce(sum(amount),0) into v_advance_refunded from public.customer_advance_refunds where customer_advance_id=new.customer_advance_id and status='posted';
  if v_advance_applied+v_advance_refunded+new.amount>v_advance.amount then raise exception 'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_AVAILABLE'; end if;
  select coalesce(sum(round(line_total,2)),0) into v_invoice_total from public.invoice_items where invoice_id=new.invoice_id;
  select coalesce(round(sum(amount),2),0) into v_invoice_cash from public.payments where invoice_id=new.invoice_id and status='posted';
  select coalesce(round(sum(amount),2),0) into v_invoice_advance from public.customer_advance_applications where invoice_id=new.invoice_id and status='posted' and id<>new.id;
  if v_invoice_total<=0 then raise exception 'CUSTOMER_ADVANCE_INVOICE_HAS_NO_TOTAL'; end if;
  if round(v_invoice_cash+v_invoice_advance+new.amount,2)>v_invoice_total then raise exception 'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE'; end if;
  return new;
end;
$$;

-- Preserve the backend-only financial boundary after replacing the view/function bodies.
revoke all on public.invoice_financial_progress from public,anon,authenticated;
grant select on public.invoice_financial_progress to service_role;
revoke all on function public.validate_invoice_payment() from public,anon,authenticated,service_role;
revoke all on function public.validate_customer_advance_application() from public,anon,authenticated,service_role;
