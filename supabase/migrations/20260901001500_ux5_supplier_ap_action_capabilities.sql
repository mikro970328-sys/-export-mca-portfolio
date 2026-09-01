-- UX-5 · Supplier Bills / Accounts Payable: canonical DB-owned action capabilities.

create or replace function public.supplier_bill_action_state(p_supplier_bill_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_bill public.supplier_bills;
  v_financial record;
  v_item_count integer := 0;
  v_active_payment_count integer := 0;
  v_edit_allowed boolean;
  v_post_allowed boolean;
  v_void_allowed boolean;
  v_pay_allowed boolean;
  v_post_reason text;
  v_void_reason text;
  v_pay_reason text;
begin
  select * into v_bill
  from public.supplier_bills
  where id=p_supplier_bill_id;
  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;

  select * into v_financial
  from public.supplier_bill_financial_progress
  where supplier_bill_id=v_bill.id;

  select count(*)::integer into v_item_count
  from public.supplier_bill_items
  where supplier_bill_id=v_bill.id;

  select count(*)::integer into v_active_payment_count
  from public.supplier_payment_applications spa
  join public.supplier_payments sp on sp.id=spa.supplier_payment_id
  where spa.supplier_bill_id=v_bill.id
    and sp.status='posted';

  v_edit_allowed := v_bill.status='draft';

  v_post_reason := case
    when v_bill.status<>'draft' then 'SUPPLIER_BILL_NOT_DRAFT'
    when nullif(btrim(v_bill.supplier_invoice_number),'') is null then 'SUPPLIER_BILL_INVOICE_NUMBER_REQUIRED'
    when v_item_count=0 then 'SUPPLIER_BILL_HAS_NO_ITEMS'
    else null
  end;
  v_post_allowed := v_post_reason is null;

  v_void_reason := case
    when v_bill.status not in ('draft','posted') then 'SUPPLIER_BILL_CANNOT_VOID'
    when v_active_payment_count>0 then 'SUPPLIER_BILL_HAS_ACTIVE_PAYMENTS'
    else null
  end;
  v_void_allowed := v_void_reason is null;

  v_pay_reason := case
    when v_bill.status<>'posted' then 'SUPPLIER_BILL_NOT_POSTED'
    when coalesce(v_financial.balance_due,0)<=0 then 'SUPPLIER_BILL_ALREADY_PAID'
    else null
  end;
  v_pay_allowed := v_pay_reason is null;

  return jsonb_build_object(
    'bill_status',v_bill.status,
    'payment_status',coalesce(v_financial.payment_status,v_bill.status),
    'item_count',v_item_count,
    'bill_total',coalesce(v_financial.bill_total,0),
    'paid_amount',coalesce(v_financial.paid_amount,0),
    'balance_due',coalesce(v_financial.balance_due,0),
    'active_payment_count',v_active_payment_count,
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'SUPPLIER_BILL_NOT_DRAFT' end),
      'post',jsonb_build_object('allowed',v_post_allowed,'reason',v_post_reason),
      'void',jsonb_build_object('allowed',v_void_allowed,'reason',v_void_reason),
      'pay',jsonb_build_object('allowed',v_pay_allowed,'reason',v_pay_reason)
    )
  );
end;
$$;

create or replace function public.assert_supplier_bill_action(p_supplier_bill_id uuid,p_action text)
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
  if v_action not in ('edit','post','void','pay') then
    raise exception 'SUPPLIER_BILL_ACTION_INVALID';
  end if;
  v_state:=public.supplier_bill_action_state(p_supplier_bill_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'SUPPLIER_BILL_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace function public.supplier_payment_action_state(p_supplier_payment_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_payment public.supplier_payments;
  v_application_count integer := 0;
  v_applied_amount numeric := 0;
  v_active boolean;
  v_reason text;
begin
  select * into v_payment
  from public.supplier_payments
  where id=p_supplier_payment_id;
  if not found then raise exception 'SUPPLIER_PAYMENT_NOT_FOUND'; end if;

  select count(*)::integer,coalesce(sum(amount),0)
    into v_application_count,v_applied_amount
  from public.supplier_payment_applications
  where supplier_payment_id=v_payment.id;

  v_active := v_payment.status='posted';
  v_reason := case
    when v_active then null
    when v_payment.status='reversed' then 'SUPPLIER_PAYMENT_ALREADY_REVERSED'
    else 'SUPPLIER_PAYMENT_NOT_POSTED'
  end;

  return jsonb_build_object(
    'payment_status',v_payment.status,
    'purchase_order_id',v_payment.purchase_order_id,
    'amount',v_payment.amount,
    'application_count',v_application_count,
    'applied_amount',v_applied_amount,
    'unapplied_amount',greatest(v_payment.amount-v_applied_amount,0),
    'actions',jsonb_build_object(
      'allocate',jsonb_build_object('allowed',v_active,'reason',v_reason),
      'reverse',jsonb_build_object('allowed',v_active,'reason',v_reason)
    )
  );
end;
$$;

create or replace function public.assert_supplier_payment_action(p_supplier_payment_id uuid,p_action text)
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
  if v_action not in ('allocate','reverse') then
    raise exception 'SUPPLIER_PAYMENT_ACTION_INVALID';
  end if;
  v_state:=public.supplier_payment_action_state(p_supplier_payment_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'SUPPLIER_PAYMENT_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace view public.supplier_bill_action_capabilities
with (security_invoker=true)
as
select id as supplier_bill_id, public.supplier_bill_action_state(id) as capabilities
from public.supplier_bills;

create or replace view public.supplier_payment_action_capabilities
with (security_invoker=true)
as
select id as supplier_payment_id, purchase_order_id, public.supplier_payment_action_state(id) as capabilities
from public.supplier_payments;

-- Canonical mutation wrappers. The legacy mutation RPCs remain implementation details
-- and are no longer directly executable by service_role for these entity actions.
create or replace function public.replace_supplier_bill_plan_canonical(
  p_supplier_bill_id uuid,
  p_purchase_order_id uuid,
  p_lines jsonb,
  p_supplier_invoice_number text default null,
  p_bill_date date default current_date,
  p_due_date date default null,
  p_notes text default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_bill public.supplier_bills;
begin
  perform public.assert_supplier_bill_action(p_supplier_bill_id,'edit');
  select * into v_bill
  from public.replace_supplier_bill_plan(
    p_supplier_bill_id,p_purchase_order_id,p_lines,p_supplier_invoice_number,
    p_bill_date,p_due_date,p_notes
  );
  return v_bill;
end;
$$;

create or replace function public.transition_supplier_bill_canonical(
  p_supplier_bill_id uuid,
  p_action text,
  p_actor uuid default null
)
returns public.supplier_bills
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_bill public.supplier_bills;
  v_action text:=lower(btrim(coalesce(p_action,'')));
begin
  perform public.assert_supplier_bill_action(p_supplier_bill_id,v_action);
  select * into v_bill
  from public.transition_supplier_bill(p_supplier_bill_id,v_action,p_actor);
  return v_bill;
end;
$$;

create or replace function public.pay_supplier_bill_canonical(
  p_supplier_bill_id uuid,
  p_amount numeric,
  p_payment_date date default current_date,
  p_method text default null,
  p_reference text default null,
  p_notes text default null,
  p_actor uuid default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_payment public.supplier_payments;
begin
  perform public.assert_supplier_bill_action(p_supplier_bill_id,'pay');
  select * into v_payment
  from public.pay_supplier_bill(
    p_supplier_bill_id,p_amount,p_payment_date,p_method,p_reference,p_notes,p_actor
  );
  return v_payment;
end;
$$;

create or replace function public.reverse_supplier_payment_canonical(
  p_supplier_payment_id uuid,
  p_reason text,
  p_actor uuid default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_payment public.supplier_payments;
begin
  perform public.assert_supplier_payment_action(p_supplier_payment_id,'reverse');
  select * into v_payment
  from public.reverse_supplier_payment(p_supplier_payment_id,p_reason,p_actor);
  return v_payment;
end;
$$;

create or replace function public.replace_supplier_payment_applications_canonical(
  p_supplier_payment_id uuid,
  p_applications jsonb,
  p_actor uuid default null
)
returns public.supplier_payments
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare
  v_payment public.supplier_payments;
begin
  perform public.assert_supplier_payment_action(p_supplier_payment_id,'allocate');
  select * into v_payment
  from public.replace_supplier_payment_applications(p_supplier_payment_id,p_applications,p_actor);
  return v_payment;
end;
$$;

revoke all on function public.supplier_bill_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_supplier_bill_action(uuid,text) from public,anon,authenticated;
revoke all on function public.supplier_payment_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_supplier_payment_action(uuid,text) from public,anon,authenticated;
revoke all on function public.replace_supplier_bill_plan_canonical(uuid,uuid,jsonb,text,date,date,text) from public,anon,authenticated;
revoke all on function public.transition_supplier_bill_canonical(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.pay_supplier_bill_canonical(uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.reverse_supplier_payment_canonical(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.replace_supplier_payment_applications_canonical(uuid,jsonb,uuid) from public,anon,authenticated;

grant execute on function public.supplier_bill_action_state(uuid) to service_role;
grant execute on function public.assert_supplier_bill_action(uuid,text) to service_role;
grant execute on function public.supplier_payment_action_state(uuid) to service_role;
grant execute on function public.assert_supplier_payment_action(uuid,text) to service_role;
grant execute on function public.replace_supplier_bill_plan_canonical(uuid,uuid,jsonb,text,date,date,text) to service_role;
grant execute on function public.transition_supplier_bill_canonical(uuid,text,uuid) to service_role;
grant execute on function public.pay_supplier_bill_canonical(uuid,numeric,date,text,text,text,uuid) to service_role;
grant execute on function public.reverse_supplier_payment_canonical(uuid,text,uuid) to service_role;
grant execute on function public.replace_supplier_payment_applications_canonical(uuid,jsonb,uuid) to service_role;

-- Remove direct service-role execution for entity mutations that must pass canonical action assertions.
revoke execute on function public.replace_supplier_bill_plan(uuid,uuid,jsonb,text,date,date,text) from service_role;
revoke execute on function public.transition_supplier_bill(uuid,text,uuid) from service_role;
revoke execute on function public.pay_supplier_bill(uuid,numeric,date,text,text,text,uuid) from service_role;
revoke execute on function public.reverse_supplier_payment(uuid,text,uuid) from service_role;
revoke execute on function public.replace_supplier_payment_applications(uuid,jsonb,uuid) from service_role;

revoke all on public.supplier_bill_action_capabilities from public,anon,authenticated;
revoke all on public.supplier_payment_action_capabilities from public,anon,authenticated;
grant select on public.supplier_bill_action_capabilities to service_role;
grant select on public.supplier_payment_action_capabilities to service_role;
