-- Record uses of customer invoice credit. Applications are settlement, not cash.
-- Refunds record money already returned; no bank/payment provider is invoked.
create sequence public.invoice_credit_movement_number_seq;
create table public.invoice_credit_movements (
 id uuid primary key default gen_random_uuid(),
 movement_number text not null unique default ('SC-'||nextval('public.invoice_credit_movement_number_seq')::text),
 movement_type text not null check(movement_type in ('application','refund','reversal')),
 source_invoice_id uuid not null references public.invoices(id) on delete restrict,
 target_invoice_id uuid references public.invoices(id) on delete restrict,
 amount numeric(18,2) not null check(amount>0 and amount<>'NaN'::numeric),
 currency text not null,
 effective_date date not null,
 method text,
 reference text,
 reason text not null check(length(btrim(reason)) between 3 and 2000),
 reverses_id uuid unique references public.invoice_credit_movements(id) on delete restrict,
 request_id uuid not null unique,
 request_payload jsonb not null,
 created_by uuid not null references public.admin_users(id) on delete restrict,
 created_at timestamptz not null default now(),
 check(source_invoice_id is distinct from target_invoice_id),
 check((movement_type='application' and target_invoice_id is not null and reverses_id is null)
    or (movement_type='refund' and target_invoice_id is null and reverses_id is null)
    or (movement_type='reversal' and reverses_id is not null))
);
create index invoice_credit_movements_source_idx on public.invoice_credit_movements(source_invoice_id);
create index invoice_credit_movements_target_idx on public.invoice_credit_movements(target_invoice_id);
create index invoice_credit_movements_actor_idx on public.invoice_credit_movements(created_by);
alter table public.invoice_credit_movements enable row level security;
revoke all on public.invoice_credit_movements from public,anon,authenticated,service_role;
revoke all on sequence public.invoice_credit_movement_number_seq from public,anon,authenticated,service_role;
grant select on public.invoice_credit_movements to service_role;
create trigger invoice_credit_movement_immutable before update or delete on public.invoice_credit_movements for each row execute function public.reject_invoice_credit_mutation();

create or replace view public.invoice_active_credit_movements with(security_invoker=true) as
select m.* from public.invoice_credit_movements m
where m.movement_type in ('application','refund')
 and not exists(select 1 from public.invoice_credit_movements r where r.reverses_id=m.id);
revoke all on public.invoice_active_credit_movements from public,anon,authenticated;
grant select on public.invoice_active_credit_movements to service_role;

create or replace view public.invoice_credit_totals with(security_invoker=true) as
with entries as (
 select source_invoice_id as invoice_id,0::numeric as received,
   case when movement_type='application' then amount else 0 end as transferred,
   case when movement_type='refund' then amount else 0 end as refunded
 from public.invoice_active_credit_movements
 union all
 select target_invoice_id,amount,0::numeric,0::numeric from public.invoice_active_credit_movements where movement_type='application'
)
select invoice_id,sum(received)::numeric as received,sum(transferred)::numeric as transferred,sum(refunded)::numeric as refunded
from entries group by invoice_id;
revoke all on public.invoice_credit_totals from public,anon,authenticated;
grant select on public.invoice_credit_totals to service_role;

create or replace view public.invoice_financial_progress
with (security_invoker=true)
as
with line_totals as (
  select invoice_id,coalesce(sum(round(line_total,2)),0::numeric) as total
  from public.invoice_net_items
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
  round(coalesce(cpt.cash_payment_amount,0::numeric)+(coalesce(at.advance_applied_amount,0::numeric)+coalesce(ct.received,0)-coalesce(ct.transferred,0)-coalesce(ct.refunded,0)),2) as paid_amount,
  greatest(round(coalesce(lt.total,0::numeric)-coalesce(cpt.cash_payment_amount,0::numeric)-(coalesce(at.advance_applied_amount,0::numeric)+coalesce(ct.received,0)-coalesce(ct.transferred,0)-coalesce(ct.refunded,0)),2),0::numeric) as balance_due,
  case
    when i.status='draft' then 'draft'
    when i.status='void' then 'void'
    when coalesce(lt.total,0)=0 then 'paid'
    when round(coalesce(cpt.cash_payment_amount,0::numeric)+(coalesce(at.advance_applied_amount,0::numeric)+coalesce(ct.received,0)-coalesce(ct.transferred,0)-coalesce(ct.refunded,0)),2)>=coalesce(lt.total,0::numeric) and coalesce(lt.total,0::numeric)>0 then 'paid'
    when round(coalesce(cpt.cash_payment_amount,0::numeric)+(coalesce(at.advance_applied_amount,0::numeric)+coalesce(ct.received,0)-coalesce(ct.transferred,0)-coalesce(ct.refunded,0)),2)>0 then 'partial'
    when i.due_date is not null and i.due_date<current_date then 'overdue'
    else 'unpaid'
  end as payment_status,
  coalesce(cpt.cash_payment_amount,0::numeric) as cash_payment_amount,
  coalesce(at.advance_applied_amount,0::numeric) as advance_applied_amount,
  round(coalesce(cpt.cash_payment_amount,0::numeric)+(coalesce(at.advance_applied_amount,0::numeric)+coalesce(ct.received,0)-coalesce(ct.transferred,0)-coalesce(ct.refunded,0)),2) as settlement_amount,
  coalesce((select sum(round(ii.line_total,2)) from public.invoice_items ii where ii.invoice_id=i.id),0)::numeric as original_total,
  coalesce((select sum(n.total) from public.invoice_credit_notes n where n.invoice_id=i.id),0)::numeric as credited_amount,
  greatest(round(coalesce(cpt.cash_payment_amount,0)+coalesce(at.advance_applied_amount,0)+coalesce(ct.received,0)-coalesce(ct.transferred,0)-coalesce(ct.refunded,0)-coalesce(lt.total,0),2),0)::numeric as customer_credit_balance,
  coalesce(ct.received,0)::numeric as credit_received_amount,
  coalesce(ct.transferred,0)::numeric as credit_transferred_amount,
  coalesce(ct.refunded,0)::numeric as credit_refunded_amount
from public.invoices i
left join line_totals lt on lt.invoice_id=i.id
left join cash_payment_totals cpt on cpt.invoice_id=i.id
left join advance_totals at on at.invoice_id=i.id
left join public.invoice_credit_totals ct on ct.invoice_id=i.id;

-- A receipt/application cannot be reversed after its excess was spent unless
-- the remaining funding still covers all posted uses. Reverse those uses first.
create or replace function public.invoice_credit_reduction_allowed(p_invoice_id uuid,p_amount numeric)
returns boolean language sql stable security invoker set search_path=public,pg_temp as $$
 select coalesce((select (credit_transferred_amount+credit_refunded_amount=0 or customer_credit_balance>=p_amount)
 from public.invoice_financial_progress where invoice_id=p_invoice_id),false);
$$;
revoke all on function public.invoice_credit_reduction_allowed(uuid,numeric) from public,anon,authenticated;
grant execute on function public.invoice_credit_reduction_allowed(uuid,numeric) to service_role;

create or replace view public.invoice_credit_movement_state with(security_invoker=true) as
select m.id,m.movement_number,m.movement_type,m.source_invoice_id,m.target_invoice_id,m.amount,m.currency,m.effective_date,m.method,m.reference,m.reason,m.created_by,m.created_at,
 s.invoice_number as source_invoice_number,t.invoice_number as target_invoice_number,
 case when r.id is null then 'posted' else 'reversed' end as status,
 r.id as reversal_id,r.reason as reversal_reason,r.created_at as reversed_at,
 jsonb_build_object('actions',jsonb_build_object('reverse',jsonb_build_object(
 'allowed',r.id is null and (m.movement_type='refund' or public.invoice_credit_reduction_allowed(m.target_invoice_id,m.amount)),
 'reason',case when r.id is not null then 'INVOICE_CREDIT_MOVEMENT_REVERSED'
 when m.movement_type='application' and not public.invoice_credit_reduction_allowed(m.target_invoice_id,m.amount) then 'INVOICE_CREDIT_BALANCE_USED' else null end))) as capabilities
from public.invoice_credit_movements m
join public.invoices s on s.id=m.source_invoice_id
left join public.invoices t on t.id=m.target_invoice_id
left join public.invoice_credit_movements r on r.reverses_id=m.id
where m.movement_type<>'reversal';
revoke all on public.invoice_credit_movement_state from public,anon,authenticated;
grant select on public.invoice_credit_movement_state to service_role;

create or replace function public.manage_invoice_credit(
 p_action text,p_source_invoice_id uuid,p_target_invoice_id uuid,p_movement_id uuid,
 p_amount numeric,p_reason text,p_request_id uuid,p_actor uuid,
 p_effective_date date default current_date,p_method text default null,p_reference text default null,p_expected_available numeric default null
)
returns public.invoice_credit_movements
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_source public.invoices; v_target public.invoices; v_original public.invoice_credit_movements; v_row public.invoice_credit_movements;
 v_source_id uuid:=p_source_invoice_id; v_target_id uuid:=p_target_invoice_id;
 v_payload jsonb; v_financial record; v_target_financial record;
begin
 if not exists(select 1 from public.admin_users where id=p_actor and is_active=true) then raise exception 'INVOICE_CREDIT_ACTOR_INVALID'; end if;
 if p_action is null or p_action not in ('application','refund','reversal') then raise exception 'INVOICE_CREDIT_MOVEMENT_INVALID'; end if;
 if p_request_id is null then raise exception 'INVOICE_CREDIT_REQUEST_REQUIRED'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>2000 then raise exception 'INVOICE_CREDIT_REASON_REQUIRED'; end if;
 if p_effective_date is null or p_effective_date>current_date or p_effective_date<'1900-01-01'::date then raise exception 'INVOICE_CREDIT_DATE_INVALID'; end if;
 v_payload:=jsonb_build_object('action',p_action,'source',p_source_invoice_id,'target',p_target_invoice_id,'movement',p_movement_id,'amount',p_amount,'reason',btrim(p_reason),'date',p_effective_date,'method',p_method,'reference',p_reference,'expected',p_expected_available);
 if p_action='reversal' then
   select * into v_original from public.invoice_credit_movements where id=p_movement_id and movement_type<>'reversal';
   if not found then raise exception 'INVOICE_CREDIT_MOVEMENT_NOT_FOUND'; end if;
   v_source_id:=v_original.source_invoice_id;v_target_id:=v_original.target_invoice_id;
 end if;
 -- Sorted locks cover both ends of a transfer, including opposite-direction requests.
 perform 1 from public.invoices where id in (v_source_id,v_target_id) order by id for update;
 select * into v_source from public.invoices where id=v_source_id;
 if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
 select * into v_row from public.invoice_credit_movements where request_id=p_request_id;
 if found then
   if v_row.request_payload is distinct from v_payload or v_row.created_by<>p_actor then raise exception 'INVOICE_CREDIT_REQUEST_CONFLICT'; end if;
   return v_row;
 end if;
 if v_source.status<>'issued' then raise exception 'INVOICE_CREDIT_REQUIRES_ISSUED'; end if;
 if p_action='reversal' then
   if exists(select 1 from public.invoice_credit_movements where reverses_id=v_original.id) then raise exception 'INVOICE_CREDIT_MOVEMENT_REVERSED'; end if;
   if v_original.movement_type='application' and not public.invoice_credit_reduction_allowed(v_target_id,v_original.amount) then raise exception 'INVOICE_CREDIT_BALANCE_USED'; end if;
   insert into public.invoice_credit_movements(movement_type,source_invoice_id,target_invoice_id,amount,currency,effective_date,method,reference,reason,reverses_id,request_id,request_payload,created_by)
   values('reversal',v_source_id,v_target_id,v_original.amount,v_original.currency,p_effective_date,v_original.method,v_original.reference,btrim(p_reason),v_original.id,p_request_id,v_payload,p_actor) returning * into v_row;
 else
   if p_amount is null or p_amount<=0 or p_amount in ('NaN'::numeric,'Infinity'::numeric) or p_amount<>round(p_amount,2) then raise exception 'INVOICE_CREDIT_AMOUNT_INVALID'; end if;
   select * into v_financial from public.invoice_financial_progress where invoice_id=v_source_id;
   if p_expected_available is null or p_expected_available is distinct from v_financial.customer_credit_balance then raise exception 'INVOICE_CREDIT_BALANCE_STALE'; end if;
   if p_amount>v_financial.customer_credit_balance then raise exception 'INVOICE_CREDIT_EXCEEDS_AVAILABLE'; end if;
   if p_action='application' then
     select * into v_target from public.invoices where id=v_target_id;
     if not found or v_target_id=v_source_id or v_target.status<>'issued' or v_target.client_id<>v_source.client_id or v_target.currency<>v_source.currency then raise exception 'INVOICE_CREDIT_TARGET_INVALID'; end if;
     select * into v_target_financial from public.invoice_financial_progress where invoice_id=v_target_id;
     if p_amount>v_target_financial.balance_due then raise exception 'INVOICE_CREDIT_EXCEEDS_TARGET'; end if;
   elsif v_target_id is not null then raise exception 'INVOICE_CREDIT_TARGET_INVALID';
   elsif p_method is null or p_method not in ('wire','ach','check','cash','other') then raise exception 'INVOICE_CREDIT_METHOD_REQUIRED'; end if;
   insert into public.invoice_credit_movements(movement_type,source_invoice_id,target_invoice_id,amount,currency,effective_date,method,reference,reason,request_id,request_payload,created_by)
   values(p_action,v_source_id,v_target_id,p_amount,v_source.currency,p_effective_date,p_method,nullif(btrim(p_reference),''),btrim(p_reason),p_request_id,v_payload,p_actor) returning * into v_row;
 end if;
 update public.invoices set updated_at=now() where id in (v_source_id,v_target_id);
 return v_row;
exception when unique_violation then raise exception 'INVOICE_CREDIT_REQUEST_CONFLICT';
end;
$$;
revoke all on function public.manage_invoice_credit(text,uuid,uuid,uuid,numeric,text,uuid,uuid,date,text,text,numeric) from public,anon,authenticated;
grant execute on function public.manage_invoice_credit(text,uuid,uuid,uuid,numeric,text,uuid,uuid,date,text,text,numeric) to service_role;

create or replace function public.validate_invoice_payment()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_invoice public.invoices;
  v_total numeric;
  v_credit_net numeric;
  v_existing numeric;
  v_advance_applied numeric;
begin
  if tg_op='INSERT' and new.status='reversed' then raise exception 'PAYMENT_INVALID_INITIAL_STATUS'; end if;
  select * into v_invoice from public.invoices where id=new.invoice_id for update;
  if not found then raise exception 'PAYMENT_INVOICE_NOT_FOUND'; end if;
  if new.status<>'reversed' and v_invoice.status<>'issued' then raise exception 'PAYMENT_INVOICE_NOT_ISSUED'; end if;
  if tg_op='UPDATE' and old.status='posted' and new.status='reversed' and not public.invoice_credit_reduction_allowed(new.invoice_id,old.amount) then raise exception 'INVOICE_CREDIT_BALANCE_USED'; end if;
  select coalesce(received-transferred-refunded,0) into v_credit_net from public.invoice_credit_totals where invoice_id=new.invoice_id;
  v_credit_net:=coalesce(v_credit_net,0);
  new.client_id:=v_invoice.client_id;
  new.currency:=v_invoice.currency;
  new.operation_id:=null;
  if new.status='posted' then
    select coalesce(sum(round(line_total,2)),0) into v_total from public.invoice_net_items where invoice_id=new.invoice_id;
    select coalesce(round(sum(amount),2),0) into v_existing from public.payments where invoice_id=new.invoice_id and status='posted' and id<>new.id;
    select coalesce(round(sum(caa.amount),2),0) into v_advance_applied
    from public.customer_advance_applications caa
    join public.customer_advances ca on ca.id=caa.customer_advance_id
    where caa.invoice_id=new.invoice_id and caa.status='posted' and ca.status='posted';
    if v_total<=0 then raise exception 'PAYMENT_INVOICE_HAS_NO_TOTAL'; end if;
    if round(v_existing+v_advance_applied+v_credit_net+new.amount,2)>v_total then raise exception 'PAYMENT_EXCEEDS_BALANCE'; end if;
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
  v_credit_net numeric;
begin
  if new.status<>'posted' then
    if tg_op='UPDATE' and old.status='posted' then
      perform 1 from public.invoices where id=new.invoice_id for update;
      if not public.invoice_credit_reduction_allowed(new.invoice_id,old.amount) then raise exception 'INVOICE_CREDIT_BALANCE_USED'; end if;
    end if;
    return new;
  end if;
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
  select coalesce(sum(round(line_total,2)),0) into v_invoice_total from public.invoice_net_items where invoice_id=new.invoice_id;
  select coalesce(round(sum(amount),2),0) into v_invoice_cash from public.payments where invoice_id=new.invoice_id and status='posted';
  select coalesce(round(sum(amount),2),0) into v_invoice_advance from public.customer_advance_applications where invoice_id=new.invoice_id and status='posted' and id<>new.id;
  select coalesce(received-transferred-refunded,0) into v_credit_net from public.invoice_credit_totals where invoice_id=new.invoice_id;
  v_credit_net:=coalesce(v_credit_net,0);
  if v_invoice_total<=0 then raise exception 'CUSTOMER_ADVANCE_INVOICE_HAS_NO_TOTAL'; end if;
  if round(v_invoice_cash+v_invoice_advance+v_credit_net+new.amount,2)>v_invoice_total then raise exception 'CUSTOMER_ADVANCE_APPLICATION_EXCEEDS_INVOICE'; end if;
  return new;
end;
$$;

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
    when exists(select 1 from public.invoice_credit_notes where invoice_id=v_invoice.id) then 'INVOICE_HAS_CREDITS'
    when exists(select 1 from public.invoice_active_credit_movements where source_invoice_id=v_invoice.id or target_invoice_id=v_invoice.id) then 'INVOICE_HAS_CREDIT_MOVEMENTS'
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
      'apply_credit',jsonb_build_object('allowed',v_invoice.status='issued' and coalesce(v_financial.customer_credit_balance,0)>0,'reason',case when coalesce(v_financial.customer_credit_balance,0)<=0 then 'INVOICE_CREDIT_NO_BALANCE' else null end),
      'refund_credit',jsonb_build_object('allowed',v_invoice.status='issued' and coalesce(v_financial.customer_credit_balance,0)>0,'reason',case when coalesce(v_financial.customer_credit_balance,0)<=0 then 'INVOICE_CREDIT_NO_BALANCE' else null end),
      'credit',jsonb_build_object('allowed',v_invoice.status='issued' and exists(select 1 from public.invoice_net_items where invoice_id=v_invoice.id and quantity>0),'reason',case when v_invoice.status<>'issued' then 'INVOICE_CREDIT_REQUIRES_ISSUED' else null end),
      'edit',jsonb_build_object('allowed',v_edit_allowed,'reason',case when v_edit_allowed then null else 'INVOICE_NOT_DRAFT' end),
      'issue',jsonb_build_object('allowed',v_issue_allowed,'reason',v_issue_reason),
      'record_payment',jsonb_build_object('allowed',v_payment_allowed,'reason',v_payment_reason),
      'void',jsonb_build_object('allowed',v_void_allowed,'reason',v_void_reason)
    )
  );
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
  v_reverse_allowed:=v_payment.status='posted' and public.invoice_credit_reduction_allowed(v_payment.invoice_id,v_payment.amount);
  v_reason:=case when v_payment.status='posted' and not v_reverse_allowed then 'INVOICE_CREDIT_BALANCE_USED' when v_reverse_allowed then null when v_payment.status='reversed' then 'PAYMENT_ALREADY_REVERSED' else 'PAYMENT_STATUS_FINAL' end;
  return jsonb_build_object(
    'payment_status',v_payment.status,
    'invoice_id',v_payment.invoice_id,
    'actions',jsonb_build_object('reverse',jsonb_build_object('allowed',v_reverse_allowed,'reason',v_reason))
  );
end;
$$;

create or replace function public.customer_advance_application_action_state(p_application_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advance_applications; v_reason text;
begin
  select * into v_row from public.customer_advance_applications where id=p_application_id;
  if not found then raise exception 'CUSTOMER_ADVANCE_APPLICATION_NOT_FOUND'; end if;
  v_reason:=case when v_row.status='posted' and not public.invoice_credit_reduction_allowed(v_row.invoice_id,v_row.amount) then 'INVOICE_CREDIT_BALANCE_USED' when v_row.status='posted' then null when v_row.status='reversed' then 'CUSTOMER_ADVANCE_APPLICATION_ALREADY_REVERSED' else 'CUSTOMER_ADVANCE_APPLICATION_STATUS_FINAL' end;
  return jsonb_build_object('application_status',v_row.status,'customer_advance_id',v_row.customer_advance_id,'invoice_id',v_row.invoice_id,'actions',jsonb_build_object('reverse',jsonb_build_object('allowed',v_reason is null,'reason',v_reason)));
end;
$$;

create or replace view public.executive_invoice_kpi_source
with (security_invoker = true)
as
select
  f.invoice_id,
  f.invoice_number,
  f.sales_order_id,
  i.operation_id,
  f.client_id,
  f.issue_date,
  f.due_date,
  f.currency,
  f.total as invoice_total,
  f.paid_amount,
  f.balance_due,
  f.payment_status,
  (f.balance_due > 0 and f.due_date is not null and f.due_date < current_date) as overdue,
  p.recognized_merchandise_cogs,
  p.cogs_currency,
  p.merchandise_cost_coverage,
  p.currency_comparable,
  p.gross_margin,
  p.gross_margin_pct,
  p.profitability_status,
  coalesce((
    select array_agg(distinct ii.product_id order by ii.product_id)
    from public.invoice_items ii
    where ii.invoice_id = f.invoice_id
      and ii.product_id is not null
  ), '{}'::uuid[]) as product_ids,
  f.original_total,f.credited_amount,f.customer_credit_balance,
  f.cash_payment_amount,f.advance_applied_amount,f.credit_received_amount,f.credit_transferred_amount,f.credit_refunded_amount
from public.invoice_financial_progress f
join public.invoices i on i.id = f.invoice_id
left join public.issued_invoice_profitability p on p.invoice_id = f.invoice_id
where f.invoice_status = 'issued';

create or replace function public.executive_report_dataset(
  p_dataset text,
  p_start_date date default null,
  p_end_date date default null,
  p_currency text default null,
  p_client_id uuid default null,
  p_supplier_id uuid default null,
  p_product_id uuid default null,
  p_limit integer default 1000
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_dataset text := lower(btrim(coalesce(p_dataset,'')));
  v_limit integer := least(greatest(coalesce(p_limit,1000),1),5000);
  v_rows jsonb := '[]'::jsonb;
  v_basis text := 'period_activity';
  v_dimensions text[] := '{}'::text[];
begin
  if p_start_date is not null and p_end_date is not null and p_start_date > p_end_date then
    raise exception 'REPORT_DATE_RANGE_INVALID';
  end if;

  if p_currency is not null and btrim(p_currency) !~ '^[A-Za-z]{3,10}$' then
    raise exception 'REPORT_CURRENCY_INVALID';
  end if;

  if v_dataset = 'sales' then
    if p_supplier_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:supplier_id'; end if;
    v_dimensions := array['period','currency','client','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.order_date desc, q.so_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.sales_order_id,
        x.so_number,
        x.order_date,
        c.name as client_name,
        c.company as client_company,
        i.name as importer_name,
        x.status,
        x.currency,
        x.order_total,
        x.fulfillment_status,
        x.attributed_sales_revenue,
        x.unattributed_order_value,
        x.recognized_merchandise_cogs,
        x.merchandise_cost_coverage,
        x.gross_margin,
        x.gross_margin_pct,
        x.profitability_status,
        x.direct_cost_amount,
        x.contribution_margin,
        x.contribution_margin_pct,
        x.contribution_status
      from public.executive_sales_order_kpi_source x
      left join public.clients c on c.id=x.client_id
      left join public.importers i on i.id=x.importer_id
      where (p_start_date is null or x.order_date >= p_start_date)
        and (p_end_date is null or x.order_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_client_id is null or x.client_id=p_client_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.order_date desc, x.so_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'purchases' then
    if p_client_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:client_id'; end if;
    v_dimensions := array['period','currency','supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.order_date desc, q.po_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.purchase_order_id,
        x.po_number,
        x.order_date,
        x.expected_at,
        s.name as supplier_name,
        s.legal_name as supplier_legal_name,
        w.code as warehouse_code,
        w.name as warehouse_name,
        x.status,
        x.receipt_status,
        x.currency,
        x.order_total,
        x.order_value_coverage,
        x.item_count,
        x.costed_item_count,
        x.has_excess
      from public.executive_purchase_order_kpi_source x
      left join public.suppliers s on s.id=x.supplier_id
      left join public.warehouses w on w.id=x.warehouse_id
      where (p_start_date is null or x.order_date >= p_start_date)
        and (p_end_date is null or x.order_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_supplier_id is null or x.supplier_id=p_supplier_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.order_date desc, x.po_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'invoices' then
    if p_supplier_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:supplier_id'; end if;
    v_dimensions := array['period','currency','client','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.issue_date desc, q.invoice_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.invoice_id,
        x.invoice_number,
        x.issue_date,
        x.due_date,
        c.name as client_name,
        c.company as client_company,
        x.currency,
        x.invoice_total,
        x.original_total,x.credited_amount,x.customer_credit_balance,
        x.cash_payment_amount,x.advance_applied_amount,x.credit_received_amount,x.credit_transferred_amount,x.credit_refunded_amount,
        x.paid_amount,
        x.balance_due,
        x.payment_status,
        x.overdue,
        x.recognized_merchandise_cogs,
        x.merchandise_cost_coverage,
        x.gross_margin,
        x.gross_margin_pct,
        x.profitability_status
      from public.executive_invoice_kpi_source x
      left join public.clients c on c.id=x.client_id
      where (p_start_date is null or x.issue_date >= p_start_date)
        and (p_end_date is null or x.issue_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_client_id is null or x.client_id=p_client_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.issue_date desc, x.invoice_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'supplier_bills' then
    if p_client_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:client_id'; end if;
    v_dimensions := array['period','currency','supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.bill_date desc, q.bill_number desc),'[]'::jsonb)
      into v_rows
    from (
      select
        x.supplier_bill_id,
        x.bill_number,
        x.supplier_invoice_number,
        x.bill_date,
        x.due_date,
        s.name as supplier_name,
        s.legal_name as supplier_legal_name,
        x.currency,
        x.bill_total,
        x.paid_amount,
        x.balance_due,
        x.payment_status,
        x.overdue,
        po.po_number
      from public.executive_supplier_bill_kpi_source x
      left join public.suppliers s on s.id=x.supplier_id
      left join public.purchase_orders po on po.id=x.purchase_order_id
      where (p_start_date is null or x.bill_date >= p_start_date)
        and (p_end_date is null or x.bill_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_supplier_id is null or x.supplier_id=p_supplier_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by x.bill_date desc, x.bill_number desc
      limit v_limit
    ) q;

  elsif v_dataset = 'cash' then
    v_dimensions := array['period','currency','client','supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.payment_date desc, q.event_type, q.reference_number),'[]'::jsonb)
      into v_rows
    from (
      select
        x.event_type,x.direction,x.event_id,x.payment_date,x.party_name,x.party_detail,
        x.currency,x.amount,x.method,x.reference_number,x.document_number
      from public.executive_cash_movement_source x
      where (p_start_date is null or x.payment_date >= p_start_date)
        and (p_end_date is null or x.payment_date <= p_end_date)
        and (p_currency is null or upper(x.currency)=upper(p_currency))
        and (p_client_id is null or x.client_id=p_client_id)
        and (p_supplier_id is null or x.supplier_id=p_supplier_id)
        and (p_product_id is null or p_product_id=any(x.product_ids))
      order by payment_date desc, event_type, reference_number
      limit v_limit
    ) q;

  elsif v_dataset = 'inventory' then
    if p_start_date is not null or p_end_date is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:period'; end if;
    if p_currency is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:currency'; end if;
    if p_client_id is not null then raise exception 'REPORT_FILTER_NOT_APPLICABLE:client_id'; end if;
    v_basis := 'current_snapshot';
    v_dimensions := array['supplier','product'];
    select coalesce(jsonb_agg(to_jsonb(q) order by q.warehouse_code, q.product_name, q.receipt_number),'[]'::jsonb)
      into v_rows
    from (
      select
        ib.receipt_item_id,
        ib.receipt_number,
        ib.received_at,
        ib.warehouse_code,
        ib.warehouse_name,
        ib.product_id,
        ib.sku as product_sku,
        ib.product_name,
        ib.unit,
        ib.lot_number,
        wr.supplier_id,
        coalesce(s.name,wr.supplier_name) as supplier_name,
        ib.physical_quantity,
        ib.reserved_quantity,
        ib.available_quantity,
        ib.physical_pallets,
        ib.reserved_pallets,
        ib.available_pallets
      from public.inventory_by_receipt ib
      join public.warehouse_receipts wr on wr.id=ib.receipt_id
      left join public.suppliers s on s.id=wr.supplier_id
      where (p_supplier_id is null or wr.supplier_id=p_supplier_id)
        and (p_product_id is null or ib.product_id=p_product_id)
      order by ib.warehouse_code, ib.product_name, ib.receipt_number
      limit v_limit
    ) q;

  else
    raise exception 'REPORT_DATASET_INVALID';
  end if;

  return jsonb_build_object(
    'dataset',v_dataset,
    'basis',v_basis,
    'currency_policy','separate_no_fx',
    'dimensions',to_jsonb(v_dimensions),
    'filters',jsonb_build_object(
      'start_date',p_start_date,
      'end_date',p_end_date,
      'currency',case when p_currency is null then null else upper(p_currency) end,
      'client_id',p_client_id,
      'supplier_id',p_supplier_id,
      'product_id',p_product_id
    ),
    'limit',v_limit,
    'row_count',jsonb_array_length(v_rows),
    'rows',v_rows
  );
end;
$$;

create or replace view public.executive_cash_movement_source
with (security_invoker=true)
as
select
  'customer_collection'::text as event_type, 'in'::text as direction,
  x.payment_id as event_id, x.payment_date, x.client_id, null::uuid as supplier_id,
  c.name as party_name, c.company as party_detail,
  x.currency, x.amount, x.method, x.reference_number,
  i.invoice_number as document_number, x.product_ids
from public.executive_customer_payment_kpi_source x
left join public.clients c on c.id=x.client_id
left join public.invoices i on i.id=x.invoice_id
union all
select
  'supplier_payment','out',x.supplier_payment_id,x.payment_date,null::uuid,x.supplier_id,
  s.name,s.legal_name,x.currency,x.amount,p.method,coalesce(p.reference,x.payment_number),
  po.po_number,x.product_ids
from public.executive_supplier_payment_kpi_source x
join public.supplier_payments p on p.id=x.supplier_payment_id
left join public.suppliers s on s.id=x.supplier_id
left join public.purchase_orders po on po.id=x.purchase_order_id
union all
select
  'customer_advance','in',a.id,a.received_date,a.client_id,null::uuid,
  c.name,c.company,a.currency,a.amount,a.method,a.reference,a.advance_number,
  coalesce((select array_agg(distinct i.product_id order by i.product_id)
    from public.sales_order_items i where i.sales_order_id=a.sales_order_id),'{}'::uuid[])
from public.customer_advances a
left join public.clients c on c.id=a.client_id
where a.status='posted'
union all
select
  'customer_advance_refund','out',r.id,r.refund_date,a.client_id,null::uuid,
  c.name,c.company,a.currency,r.amount,r.method,r.reference,r.refund_number,
  coalesce((select array_agg(distinct i.product_id order by i.product_id)
    from public.sales_order_items i where i.sales_order_id=a.sales_order_id),'{}'::uuid[])
from public.customer_advance_refunds r
join public.customer_advances a on a.id=r.customer_advance_id
left join public.clients c on c.id=a.client_id
where r.status='posted' and a.status='posted'
union all
select 'invoice_credit_refund','out',m.id,m.effective_date,i.client_id,null::uuid,
 c.name,c.company,m.currency,m.amount,m.method,m.reference,m.movement_number,
 coalesce((select array_agg(distinct ii.product_id order by ii.product_id) from public.invoice_items ii where ii.invoice_id=i.id),'{}'::uuid[])
from public.invoice_active_credit_movements m
join public.invoices i on i.id=m.source_invoice_id
left join public.clients c on c.id=i.client_id
where m.movement_type='refund';

create or replace function public.executive_dashboard_rollup(
  p_start_date date default null,
  p_end_date date default null,
  p_currency text default null,
  p_client_id uuid default null,
  p_supplier_id uuid default null,
  p_product_id uuid default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
with
invoice_period as (
  select *
  from public.executive_invoice_kpi_source x
  where (p_start_date is null or x.issue_date >= p_start_date)
    and (p_end_date is null or x.issue_date <= p_end_date)
    and (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_client_id is null or x.client_id = p_client_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
cash_period as (
  select *
  from public.executive_cash_movement_source x
  where (p_start_date is null or x.payment_date >= p_start_date)
    and (p_end_date is null or x.payment_date <= p_end_date)
    and (p_currency is null or upper(x.currency) = upper(p_currency))
    -- Preserve dashboard dimension semantics: client applies to customer events,
    -- supplier applies to supplier events; product/currency/period apply to both.
    and (x.client_id is null or p_client_id is null or x.client_id=p_client_id)
    and (x.supplier_id is null or p_supplier_id is null or x.supplier_id=p_supplier_id)
    and (p_product_id is null or p_product_id=any(x.product_ids))
),
supplier_bill_period as (
  select *
  from public.executive_supplier_bill_kpi_source x
  where (p_start_date is null or x.bill_date >= p_start_date)
    and (p_end_date is null or x.bill_date <= p_end_date)
    and (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_supplier_id is null or x.supplier_id = p_supplier_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
po_period as (
  select *
  from public.executive_purchase_order_kpi_source x
  where (p_start_date is null or x.order_date >= p_start_date)
    and (p_end_date is null or x.order_date <= p_end_date)
    and (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_supplier_id is null or x.supplier_id = p_supplier_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
so_period as (
  select *
  from public.executive_sales_order_kpi_source x
  where (p_start_date is null or x.order_date >= p_start_date)
    and (p_end_date is null or x.order_date <= p_end_date)
    and (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_client_id is null or x.client_id = p_client_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
invoice_snapshot as (
  select *
  from public.executive_invoice_kpi_source x
  where (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_client_id is null or x.client_id = p_client_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
supplier_bill_snapshot as (
  select *
  from public.executive_supplier_bill_kpi_source x
  where (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_supplier_id is null or x.supplier_id = p_supplier_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
supplier_payment_snapshot as (
  select *
  from public.executive_supplier_payment_kpi_source x
  where (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_supplier_id is null or x.supplier_id = p_supplier_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
po_snapshot as (
  select *
  from public.executive_purchase_order_kpi_source x
  where (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_supplier_id is null or x.supplier_id = p_supplier_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
so_snapshot as (
  select *
  from public.executive_sales_order_kpi_source x
  where (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_client_id is null or x.client_id = p_client_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
),
invoice_activity as (
  select
    currency,
    count(*)::integer as issued_invoice_count,
    coalesce(sum(invoice_total),0) as issued_sales,
    count(*) filter (where gross_margin is not null)::integer as margin_eligible_invoice_count,
    count(*) filter (where gross_margin is null)::integer as margin_incomplete_invoice_count,
    coalesce(sum(invoice_total) filter (where gross_margin is not null),0) as margin_eligible_revenue,
    coalesce(sum(recognized_merchandise_cogs) filter (where gross_margin is not null),0) as recognized_cogs,
    coalesce(sum(gross_margin) filter (where gross_margin is not null),0) as gross_margin
  from invoice_period
  group by currency
),
customer_cash_activity as (
  select currency,
    count(*) filter (where event_type='customer_collection')::integer as customer_payment_count,
    count(*) filter (where event_type='customer_advance')::integer as customer_advance_count,
    coalesce(sum(amount),0) as cash_collected
  from cash_period where direction='in'
  group by currency
),
supplier_bill_activity as (
  select currency, count(*)::integer as supplier_bill_count, coalesce(sum(bill_total),0) as posted_supplier_bills
  from supplier_bill_period
  group by currency
),
supplier_cash_activity as (
  select currency,
    count(*) filter (where event_type='supplier_payment')::integer as supplier_payment_count,
    count(*) filter (where event_type='customer_advance_refund')::integer as customer_advance_refund_count,
    count(*) filter (where event_type='invoice_credit_refund')::integer as invoice_credit_refund_count,
    coalesce(sum(amount),0) as cash_paid
  from cash_period where direction='out'
  group by currency
),
po_activity as (
  select
    currency,
    count(*)::integer as purchase_order_count,
    count(*) filter (where lower(status) = 'draft')::integer as po_draft_count,
    count(*) filter (where lower(status) in ('issued','confirmed','closed'))::integer as po_committed_count,
    count(*) filter (where lower(status) in ('issued','confirmed','closed') and order_value_coverage <> 'complete')::integer as po_incomplete_value_count,
    coalesce(sum(order_total) filter (where lower(status) in ('issued','confirmed','closed') and order_value_coverage = 'complete'),0) as po_committed_value
  from po_period
  group by currency
),
so_activity as (
  select
    currency,
    count(*)::integer as sales_order_count,
    count(*) filter (where lower(status) = 'draft')::integer as so_draft_count,
    count(*) filter (where lower(status) in ('confirmed','closed'))::integer as so_confirmed_count,
    coalesce(sum(order_total) filter (where lower(status) in ('confirmed','closed')),0) as booked_sales_order_value,
    count(*) filter (where lower(status) in ('confirmed','closed') and contribution_margin is not null)::integer as contribution_eligible_order_count,
    count(*) filter (where lower(status) in ('confirmed','closed') and contribution_margin is null)::integer as contribution_incomplete_order_count,
    coalesce(sum(attributed_sales_revenue) filter (where lower(status) in ('confirmed','closed') and contribution_margin is not null),0) as contribution_eligible_revenue,
    coalesce(sum(recognized_merchandise_cogs) filter (where lower(status) in ('confirmed','closed') and contribution_margin is not null),0) as contribution_recognized_cogs,
    coalesce(sum(direct_cost_amount) filter (where lower(status) in ('confirmed','closed') and contribution_margin is not null),0) as contribution_direct_cost,
    coalesce(sum(contribution_margin) filter (where lower(status) in ('confirmed','closed') and contribution_margin is not null),0) as contribution_margin
  from so_period
  group by currency
),
activity_currencies as (
  select currency from invoice_activity
  union select currency from customer_cash_activity
  union select currency from supplier_bill_activity
  union select currency from supplier_cash_activity
  union select currency from po_activity
  union select currency from so_activity
),
activity as (
  select
    c.currency,
    coalesce(i.issued_invoice_count,0) as issued_invoice_count,
    coalesce(i.issued_sales,0) as issued_sales,
    coalesce(cc.customer_payment_count,0) as customer_payment_count,
    coalesce(cc.cash_collected,0) as cash_collected,
    coalesce(cc.customer_advance_count,0) as customer_advance_count,
    coalesce(sb.supplier_bill_count,0) as supplier_bill_count,
    coalesce(sb.posted_supplier_bills,0) as posted_supplier_bills,
    coalesce(sc.supplier_payment_count,0) as supplier_payment_count,
    coalesce(sc.cash_paid,0) as cash_paid,
    coalesce(sc.customer_advance_refund_count,0) as customer_advance_refund_count,
    coalesce(sc.invoice_credit_refund_count,0) as invoice_credit_refund_count,
    coalesce(cc.cash_collected,0) - coalesce(sc.cash_paid,0) as net_cash_flow,
    coalesce(po.purchase_order_count,0) as purchase_order_count,
    coalesce(po.po_draft_count,0) as po_draft_count,
    coalesce(po.po_committed_count,0) as po_committed_count,
    coalesce(po.po_incomplete_value_count,0) as po_incomplete_value_count,
    coalesce(po.po_committed_value,0) as po_committed_value,
    coalesce(so.sales_order_count,0) as sales_order_count,
    coalesce(so.so_draft_count,0) as so_draft_count,
    coalesce(so.so_confirmed_count,0) as so_confirmed_count,
    coalesce(so.booked_sales_order_value,0) as booked_sales_order_value,
    coalesce(i.margin_eligible_invoice_count,0) as margin_eligible_invoice_count,
    coalesce(i.margin_incomplete_invoice_count,0) as margin_incomplete_invoice_count,
    coalesce(i.margin_eligible_revenue,0) as margin_eligible_revenue,
    coalesce(i.recognized_cogs,0) as recognized_cogs,
    coalesce(i.gross_margin,0) as gross_margin,
    case when coalesce(i.margin_eligible_revenue,0) <> 0
      then (i.gross_margin / i.margin_eligible_revenue) * 100
      else null
    end as gross_margin_pct,
    coalesce(so.contribution_eligible_order_count,0) as contribution_eligible_order_count,
    coalesce(so.contribution_incomplete_order_count,0) as contribution_incomplete_order_count,
    coalesce(so.contribution_eligible_revenue,0) as contribution_eligible_revenue,
    coalesce(so.contribution_recognized_cogs,0) as contribution_recognized_cogs,
    coalesce(so.contribution_direct_cost,0) as contribution_direct_cost,
    coalesce(so.contribution_margin,0) as contribution_margin,
    case when coalesce(so.contribution_eligible_revenue,0) <> 0
      then (so.contribution_margin / so.contribution_eligible_revenue) * 100
      else null
    end as contribution_margin_pct
  from activity_currencies c
  left join invoice_activity i using (currency)
  left join customer_cash_activity cc using (currency)
  left join supplier_bill_activity sb using (currency)
  left join supplier_cash_activity sc using (currency)
  left join po_activity po using (currency)
  left join so_activity so using (currency)
),
ar_balance as (
  select
    currency,
    count(*) filter (where balance_due > 0)::integer as open_ar_invoice_count,
    coalesce(sum(balance_due) filter (where balance_due > 0),0) as ar_balance,
    count(*) filter (where overdue)::integer as overdue_ar_count,
    coalesce(sum(balance_due) filter (where overdue),0) as overdue_ar_balance
  from invoice_snapshot
  group by currency
),
ap_balance as (
  select
    currency,
    count(*) filter (where balance_due > 0)::integer as open_ap_bill_count,
    coalesce(sum(balance_due) filter (where balance_due > 0),0) as ap_balance,
    count(*) filter (where overdue)::integer as overdue_ap_count,
    coalesce(sum(balance_due) filter (where overdue),0) as overdue_ap_balance
  from supplier_bill_snapshot
  group by currency
),
unapplied_supplier_cash as (
  select
    currency,
    count(*) filter (where unapplied_amount > 0)::integer as unapplied_supplier_payment_count,
    coalesce(sum(unapplied_amount) filter (where unapplied_amount > 0),0) as unapplied_supplier_payment_amount
  from supplier_payment_snapshot
  group by currency
),
balance_currencies as (
  select currency from ar_balance
  union select currency from ap_balance
  union select currency from unapplied_supplier_cash
),
balances as (
  select
    c.currency,
    coalesce(ar.open_ar_invoice_count,0) as open_ar_invoice_count,
    coalesce(ar.ar_balance,0) as ar_balance,
    coalesce(ar.overdue_ar_count,0) as overdue_ar_count,
    coalesce(ar.overdue_ar_balance,0) as overdue_ar_balance,
    coalesce(ap.open_ap_bill_count,0) as open_ap_bill_count,
    coalesce(ap.ap_balance,0) as ap_balance,
    coalesce(ap.overdue_ap_count,0) as overdue_ap_count,
    coalesce(ap.overdue_ap_balance,0) as overdue_ap_balance,
    coalesce(usp.unapplied_supplier_payment_count,0) as unapplied_supplier_payment_count,
    coalesce(usp.unapplied_supplier_payment_amount,0) as unapplied_supplier_payment_amount
  from balance_currencies c
  left join ar_balance ar using (currency)
  left join ap_balance ap using (currency)
  left join unapplied_supplier_cash usp using (currency)
),
exceptions as (
  select jsonb_build_object(
    'overdue_ar_count', (select count(*) from invoice_snapshot where overdue),
    'overdue_ap_count', (select count(*) from supplier_bill_snapshot where overdue),
    'invoice_profitability_incomplete_count', (select count(*) from invoice_snapshot where gross_margin is null),
    'sales_order_contribution_incomplete_count', (select count(*) from so_snapshot where lower(status) in ('confirmed','closed') and contribution_margin is null),
    'supplier_unapplied_payment_count', (select count(*) from supplier_payment_snapshot where unapplied_amount > 0),
    'po_receipt_excess_count', (select count(*) from po_snapshot where has_excess),
    'po_order_value_incomplete_count', (select count(*) from po_snapshot where order_value_coverage <> 'complete'),
    'sales_order_partial_dispatch_count', (select count(*) from so_snapshot where has_partial_dispatch)
  ) as value
)
select jsonb_build_object(
  'period', jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'currency', case when p_currency is null then null else upper(p_currency) end,
    'client_id', p_client_id,
    'supplier_id', p_supplier_id,
    'product_id', p_product_id
  ),
  'balance_basis', 'current_snapshot',
  'activity_by_currency', coalesce((select jsonb_agg(to_jsonb(activity) order by currency) from activity), '[]'::jsonb),
  'balances_by_currency', coalesce((select jsonb_agg(to_jsonb(balances) order by currency) from balances), '[]'::jsonb),
  'exceptions', (select value from exceptions),
  'filter_semantics', jsonb_build_object(
    'client', 'sales_ar_customer_cash_margin_contribution',
    'supplier', 'purchases_ap_supplier_cash',
    'product', 'both_commercial_sides',
    'currency', 'all_financial_metrics',
    'period', 'activity_only'
  )
);
$$;

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
         coalesce(sum(balance_due) filter(where invoice_status='issued'),0) invoice_balance_due,
         coalesce(sum(credit_refunded_amount) filter(where invoice_status='issued'),0) invoice_credit_refunded
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
       coalesce(a.advance_cash_received,0)-coalesce(a.advance_cash_refunded,0)+coalesce(i.invoice_cash_received,0) -coalesce(i.invoice_credit_refunded,0) as cash_received_net,
       greatest(coalesce(sip.sales_order_total,0)-(coalesce(a.advance_cash_received,0)-coalesce(a.advance_cash_refunded,0)+coalesce(i.invoice_cash_received,0)-coalesce(i.invoice_credit_refunded,0)),0) as commercial_cash_gap,
       coalesce(i.invoice_credit_refunded,0)::numeric as invoice_credit_refunded
from public.sales_orders so left join public.sales_order_invoice_progress sip on sip.sales_order_id=so.id left join advance_totals a on a.sales_order_id=so.id left join invoice_totals i on i.sales_order_id=so.id;

