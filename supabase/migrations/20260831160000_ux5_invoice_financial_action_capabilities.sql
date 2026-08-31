-- UX-5 · Facturación y Cobros: canonical DB-owned action capabilities.

create or replace function public.invoice_action_state(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_invoice public.invoices;
  v_financial record;
  v_item_count integer := 0;
  v_posted_payments integer := 0;
  v_posted_advance_applications integer := 0;
  v_edit_allowed boolean;
  v_issue_allowed boolean;
  v_payment_allowed boolean;
  v_void_allowed boolean;
  v_issue_reason text;
  v_payment_reason text;
  v_void_reason text;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  select count(*)::integer into v_item_count
  from public.invoice_items where invoice_id=v_invoice.id;

  select * into v_financial
  from public.invoice_financial_progress
  where invoice_id=v_invoice.id;

  select count(*)::integer into v_posted_payments
  from public.payments
  where invoice_id=v_invoice.id and status='posted';

  select count(*)::integer into v_posted_advance_applications
  from public.customer_advance_applications
  where invoice_id=v_invoice.id and status='posted';

  v_edit_allowed := v_invoice.status='draft';

  v_issue_reason := case
    when v_invoice.status<>'draft' then 'INVOICE_NOT_DRAFT'
    when v_item_count=0 then 'INVOICE_HAS_NO_ITEMS'
    else null
  end;
  v_issue_allowed := v_issue_reason is null;

  v_payment_reason := case
    when v_invoice.status<>'issued' then 'PAYMENT_INVOICE_NOT_ISSUED'
    when coalesce(v_financial.total,0)<=0 then 'PAYMENT_INVOICE_HAS_NO_TOTAL'
    when coalesce(v_financial.balance_due,0)<=0 then 'PAYMENT_INVOICE_ALREADY_SETTLED'
    else null
  end;
  v_payment_allowed := v_payment_reason is null;

  v_void_reason := case
    when v_invoice.status not in ('draft','issued') then 'INVOICE_CANNOT_VOID'
    when v_posted_payments>0 then 'INVOICE_HAS_POSTED_PAYMENTS'
    when v_posted_advance_applications>0 then 'INVOICE_HAS_POSTED_ADVANCE_APPLICATIONS'
    else null
  end;
  v_void_allowed := v_void_reason is null;

  return jsonb_build_object(
    'invoice_status',v_invoice.status,
    'payment_status',coalesce(v_financial.payment_status,case when v_invoice.status='draft' then 'draft' when v_invoice.status='void' then 'void' else 'unpaid' end),
    'item_count',v_item_count,
    'total',coalesce(v_financial.total,0),
    'cash_payment_amount',coalesce(v_financial.cash_payment_amount,0),
    'advance_applied_amount',coalesce(v_financial.advance_applied_amount,0),
    'balance_due',coalesce(v_financial.balance_due,0),
    'posted_payment_count',v_posted_payments,
    'posted_advance_application_count',v_posted_advance_applications,
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'INVOICE_NOT_DRAFT' end),
      'issue',jsonb_build_object('allowed',v_issue_allowed,'reason',v_issue_reason),
      'record_payment',jsonb_build_object('allowed',v_payment_allowed,'reason',v_payment_reason),
      'void',jsonb_build_object('allowed',v_void_allowed,'reason',v_void_reason)
    )
  );
end;
$$;

create or replace function public.assert_invoice_action(p_invoice_id uuid,p_action text)
returns void
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_state jsonb;
  v_allowed boolean;
  v_reason text;
begin
  if v_action not in ('edit','issue','record_payment','void') then raise exception 'INVOICE_ACTION_INVALID'; end if;
  v_state:=public.invoice_action_state(p_invoice_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'INVOICE_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace function public.payment_action_state(p_payment_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_payment public.payments;
  v_reverse_allowed boolean;
  v_reason text;
begin
  select * into v_payment from public.payments where id=p_payment_id;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  v_reverse_allowed:=v_payment.status='posted';
  v_reason:=case when v_reverse_allowed then null when v_payment.status='reversed' then 'PAYMENT_ALREADY_REVERSED' else 'PAYMENT_STATUS_FINAL' end;
  return jsonb_build_object(
    'payment_status',v_payment.status,
    'invoice_id',v_payment.invoice_id,
    'actions',jsonb_build_object('reverse',jsonb_build_object('allowed',v_reverse_allowed,'reason',v_reason))
  );
end;
$$;

create or replace function public.assert_payment_action(p_payment_id uuid,p_action text)
returns void
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_state jsonb;
  v_allowed boolean;
  v_reason text;
begin
  if v_action<>'reverse' then raise exception 'PAYMENT_ACTION_INVALID'; end if;
  v_state:=public.payment_action_state(p_payment_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'PAYMENT_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace view public.invoice_action_capabilities
with (security_invoker=true)
as
select id as invoice_id, public.invoice_action_state(id) as capabilities
from public.invoices;

create or replace view public.payment_action_capabilities
with (security_invoker=true)
as
select id as payment_id, invoice_id, public.payment_action_state(id) as capabilities
from public.payments;

-- Editing must be revalidated by the same canonical owner exposed to the UI.
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
set search_path to 'public','pg_temp'
as $$
declare
  v_invoice public.invoices;
  v_so_status text;
  v_so_client_id uuid;
  v_operation_client_id uuid;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  perform public.assert_invoice_action(v_invoice.id,'edit');

  select status,client_id into v_so_status,v_so_client_id
  from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'INVOICE_SO_NOT_FOUND'; end if;
  if v_so_status not in ('confirmed','closed') then raise exception 'INVOICE_SO_NOT_BILLABLE'; end if;

  if p_operation_id is not null then
    select client_id into v_operation_client_id from public.operations where id=p_operation_id;
    if not found then raise exception 'INVOICE_OPERATION_NOT_FOUND'; end if;
    if v_operation_client_id is distinct from v_so_client_id then raise exception 'INVOICE_OPERATION_CLIENT_MISMATCH'; end if;
  end if;

  delete from public.invoice_items where invoice_id=p_invoice_id;
  update public.invoices
  set sales_order_id=p_sales_order_id,operation_id=p_operation_id,issue_date=coalesce(p_issue_date,current_date),due_date=p_due_date,notes=nullif(btrim(p_notes),''),updated_at=now()
  where id=p_invoice_id;
  perform public.populate_invoice_items(p_invoice_id,p_lines);
  select * into v_invoice from public.invoices where id=p_invoice_id;
  return v_invoice;
end;
$$;

create or replace function public.transition_invoice(p_invoice_id uuid,p_action text)
returns public.invoices
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_invoice public.invoices;
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_target text;
begin
  select * into v_invoice from public.invoices where id=p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  perform public.assert_invoice_action(v_invoice.id,v_action);
  if v_action='issue' then v_target:='issued';
  elsif v_action='void' then v_target:='void';
  else raise exception 'INVOICE_ACTION_INVALID';
  end if;
  update public.invoices set status=v_target,updated_at=now() where id=v_invoice.id returning * into v_invoice;
  return v_invoice;
end;
$$;

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
set search_path to 'public','pg_temp'
as $$
declare
  v_payment public.payments;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;
  perform public.assert_invoice_action(p_invoice_id,'record_payment');
  insert into public.payments(invoice_id,operation_id,client_id,amount,currency,payment_date,method,reference_number,status,notes,created_by)
  values(p_invoice_id,null,'00000000-0000-0000-0000-000000000000'::uuid,p_amount,'USD',coalesce(p_payment_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference_number),''),'posted',nullif(btrim(p_notes),''),null)
  returning * into v_payment;
  return v_payment;
end;
$$;

create or replace function public.reverse_invoice_payment(p_payment_id uuid,p_reason text default null)
returns public.payments
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_payment public.payments;
begin
  select * into v_payment from public.payments where id=p_payment_id for update;
  if not found then raise exception 'PAYMENT_NOT_FOUND'; end if;
  perform public.assert_payment_action(v_payment.id,'reverse');
  update public.payments
  set status='reversed',
      notes=case when nullif(btrim(p_reason),'') is null then notes when nullif(btrim(notes),'') is null then btrim(p_reason) else notes || E'\nReverso: ' || btrim(p_reason) end
  where id=v_payment.id returning * into v_payment;
  return v_payment;
end;
$$;

revoke all on function public.invoice_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_invoice_action(uuid,text) from public,anon,authenticated;
revoke all on function public.payment_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_payment_action(uuid,text) from public,anon,authenticated;
revoke all on function public.replace_invoice_plan(uuid,uuid,jsonb,date,date,uuid,text) from public,anon,authenticated;
revoke all on function public.transition_invoice(uuid,text) from public,anon,authenticated;
revoke all on function public.register_invoice_payment(uuid,numeric,date,text,text,text) from public,anon,authenticated;
revoke all on function public.reverse_invoice_payment(uuid,text) from public,anon,authenticated;
grant execute on function public.invoice_action_state(uuid) to service_role;
grant execute on function public.assert_invoice_action(uuid,text) to service_role;
grant execute on function public.payment_action_state(uuid) to service_role;
grant execute on function public.assert_payment_action(uuid,text) to service_role;
grant execute on function public.replace_invoice_plan(uuid,uuid,jsonb,date,date,uuid,text) to service_role;
grant execute on function public.transition_invoice(uuid,text) to service_role;
grant execute on function public.register_invoice_payment(uuid,numeric,date,text,text,text) to service_role;
grant execute on function public.reverse_invoice_payment(uuid,text) to service_role;

revoke all on public.invoice_action_capabilities from public,anon,authenticated;
revoke all on public.payment_action_capabilities from public,anon,authenticated;
grant select on public.invoice_action_capabilities to service_role;
grant select on public.payment_action_capabilities to service_role;
