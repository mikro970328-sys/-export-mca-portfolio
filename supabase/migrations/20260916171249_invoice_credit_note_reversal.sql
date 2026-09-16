-- Append-only reversals preserve credit notes and their original decimal amounts.
create sequence public.invoice_credit_reversal_number_seq;
create table public.invoice_credit_note_reversals (
 id uuid primary key default gen_random_uuid(),
 reversal_number text not null unique default ('RC-'||nextval('public.invoice_credit_reversal_number_seq')::text),
 credit_note_id uuid not null unique references public.invoice_credit_notes(id) on delete restrict,
 invoice_id uuid not null references public.invoices(id) on delete restrict,
 request_id uuid not null unique,
 request_payload jsonb not null,
 reason text not null check(length(btrim(reason)) between 3 and 2000),
 created_by uuid not null references public.admin_users(id) on delete restrict,
 created_at timestamptz not null default now()
);
create index invoice_credit_note_reversals_invoice_idx on public.invoice_credit_note_reversals(invoice_id);
create index invoice_credit_note_reversals_actor_idx on public.invoice_credit_note_reversals(created_by);
alter table public.invoice_credit_note_reversals enable row level security;
revoke all on public.invoice_credit_note_reversals from public,anon,authenticated,service_role;
revoke all on sequence public.invoice_credit_reversal_number_seq from public,anon,authenticated,service_role;
grant select on public.invoice_credit_note_reversals to service_role;
create trigger invoice_credit_reversal_immutable before update or delete on public.invoice_credit_note_reversals for each row execute function public.reject_invoice_credit_mutation();

create or replace view public.invoice_active_credit_notes with(security_invoker=true) as
select n.* from public.invoice_credit_notes n
where not exists(select 1 from public.invoice_credit_note_reversals r where r.credit_note_id=n.id);
revoke all on public.invoice_active_credit_notes from public,anon,authenticated;
grant select on public.invoice_active_credit_notes to service_role;

create or replace view public.invoice_active_credit_note_lines with(security_invoker=true) as
select l.* from public.invoice_credit_note_lines l join public.invoice_active_credit_notes n on n.id=l.credit_note_id;
revoke all on public.invoice_active_credit_note_lines from public,anon,authenticated;
grant select on public.invoice_active_credit_note_lines to service_role;

create or replace view public.invoice_net_items with (security_invoker=true) as
select ii.id,ii.invoice_id,ii.sales_order_item_id,ii.product_id,ii.description,
       (ii.quantity-coalesce(c.quantity,0))::numeric as quantity,
       ii.unit,ii.unit_price,
       (round(ii.line_total,2)-coalesce(c.amount,0))::numeric as line_total,
       ii.notes,ii.created_at,ii.updated_at,
       ii.quantity as original_quantity,round(ii.line_total,2) as original_line_total,
       coalesce(c.quantity,0)::numeric as credited_quantity,
       coalesce(c.amount,0)::numeric as credited_amount
from public.invoice_items ii
left join (select invoice_item_id,sum(quantity) as quantity,sum(amount) as amount from public.invoice_active_credit_note_lines group by invoice_item_id) c on c.invoice_item_id=ii.id;

create or replace function public.create_invoice_quantity_credit(p_invoice_id uuid,p_request_id uuid,p_lines jsonb,p_reason text,p_actor uuid)
returns public.invoice_credit_notes
language plpgsql security definer set search_path=public,pg_temp as $$
declare
 v_invoice public.invoices; v_note public.invoice_credit_notes; v_line jsonb;
 v_item public.invoice_items; v_qty numeric; v_prior numeric; v_amount numeric;
 v_total numeric:=0; v_rows jsonb:='[]'::jsonb; v_payload jsonb;
 v_expected numeric; v_seen uuid[]:='{}'::uuid[];
begin
 if not exists(select 1 from public.admin_users where id=p_actor and is_active=true) then raise exception 'INVOICE_CREDIT_ACTOR_INVALID'; end if;
 if p_request_id is null then raise exception 'INVOICE_CREDIT_REQUEST_REQUIRED'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>2000 then raise exception 'INVOICE_CREDIT_REASON_REQUIRED'; end if;
 if jsonb_typeof(p_lines) is distinct from 'array' or jsonb_array_length(p_lines) not between 1 and 200 then raise exception 'INVOICE_CREDIT_LINES_INVALID'; end if;
 v_payload:=jsonb_build_object('invoice_id',p_invoice_id,'lines',p_lines,'reason',btrim(p_reason));
 select * into v_invoice from public.invoices where id=p_invoice_id for update;
 if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
 select * into v_note from public.invoice_credit_notes where request_id=p_request_id;
 if found then
   if v_note.request_payload is distinct from v_payload or v_note.created_by<>p_actor then raise exception 'INVOICE_CREDIT_REQUEST_CONFLICT'; end if;
   return v_note;
 end if;
 if v_invoice.status<>'issued' then raise exception 'INVOICE_CREDIT_REQUIRES_ISSUED'; end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
   begin
     v_qty:=(v_line->>'quantity')::numeric;
     v_expected:=(v_line->>'expected_credited_quantity')::numeric;
     select * into v_item from public.invoice_items where id=(v_line->>'invoice_item_id')::uuid and invoice_id=p_invoice_id for update;
   exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'INVOICE_CREDIT_LINES_INVALID'; end;
   if not found or v_item.id=any(v_seen) then raise exception 'INVOICE_CREDIT_LINES_INVALID'; end if;
   v_seen:=array_append(v_seen,v_item.id);
   if v_qty is null or v_qty<=0 or v_qty in ('NaN'::numeric,'Infinity'::numeric) then raise exception 'INVOICE_CREDIT_QUANTITY_INVALID'; end if;
   select coalesce(sum(quantity),0) into v_prior from public.invoice_active_credit_note_lines where invoice_item_id=v_item.id;
   if v_expected is null or v_expected is distinct from v_prior then raise exception 'INVOICE_CREDIT_STALE'; end if;
   if v_qty+v_prior>v_item.quantity then raise exception 'INVOICE_CREDIT_EXCEEDS_QUANTITY'; end if;
   v_amount:=round((v_item.quantity-v_prior)*v_item.unit_price,2)-round((v_item.quantity-v_prior-v_qty)*v_item.unit_price,2);
   v_total:=v_total+v_amount;
   v_rows:=v_rows||jsonb_build_array(jsonb_build_object('item',v_item.id,'quantity',v_qty,'prior',v_prior,'price',v_item.unit_price,'amount',v_amount));
 end loop;
 insert into public.invoice_credit_notes(invoice_id,request_id,request_payload,reason,total,currency,created_by)
 values(p_invoice_id,p_request_id,v_payload,btrim(p_reason),v_total,v_invoice.currency,p_actor) returning * into v_note;
 insert into public.invoice_credit_note_lines(credit_note_id,invoice_item_id,quantity,previous_credited_quantity,unit_price,amount)
 select v_note.id,(x->>'item')::uuid,(x->>'quantity')::numeric,(x->>'prior')::numeric,(x->>'price')::numeric,(x->>'amount')::numeric from jsonb_array_elements(v_rows) x;
 -- Publish through the existing invoice live-update trigger, with no ledger mutation.
 update public.invoices set updated_at=now() where id=p_invoice_id;
 return v_note;
end;
$$;

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
  coalesce((select sum(n.total) from public.invoice_active_credit_notes n where n.invoice_id=i.id),0)::numeric as credited_amount,
  greatest(round(coalesce(cpt.cash_payment_amount,0)+coalesce(at.advance_applied_amount,0)+coalesce(ct.received,0)-coalesce(ct.transferred,0)-coalesce(ct.refunded,0)-coalesce(lt.total,0),2),0)::numeric as customer_credit_balance,
  coalesce(ct.received,0)::numeric as credit_received_amount,
  coalesce(ct.transferred,0)::numeric as credit_transferred_amount,
  coalesce(ct.refunded,0)::numeric as credit_refunded_amount
from public.invoices i
left join line_totals lt on lt.invoice_id=i.id
left join cash_payment_totals cpt on cpt.invoice_id=i.id
left join advance_totals at on at.invoice_id=i.id
left join public.invoice_credit_totals ct on ct.invoice_id=i.id;

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
    when exists(select 1 from public.invoice_active_credit_notes where invoice_id=v_invoice.id) then 'INVOICE_HAS_CREDITS'
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

-- Capabilities and RPC share one dependency check. Reverse later notes on a
-- shared line first: their cent amounts were rounded from the earlier remainder.
create or replace function public.invoice_credit_note_action_state(p_credit_note_id uuid)
returns jsonb language plpgsql stable security invoker set search_path=public,pg_temp as $$
declare v_note public.invoice_credit_notes; v_reason text;
begin
 select * into v_note from public.invoice_credit_notes where id=p_credit_note_id;
 if not found then raise exception 'INVOICE_CREDIT_NOTE_NOT_FOUND'; end if;
 v_reason:=case
  when exists(select 1 from public.invoice_credit_note_reversals where credit_note_id=v_note.id) then 'INVOICE_CREDIT_NOTE_REVERSED'
  when not exists(select 1 from public.invoices where id=v_note.invoice_id and status='issued') then 'INVOICE_CREDIT_REQUIRES_ISSUED'
  when exists(
   select 1 from public.invoice_credit_note_lines original
   join public.invoice_active_credit_note_lines later on later.invoice_item_id=original.invoice_item_id
     and later.previous_credited_quantity>original.previous_credited_quantity
   where original.credit_note_id=v_note.id
  ) then 'INVOICE_CREDIT_LATER_NOTE_ACTIVE'
  when not public.invoice_credit_reduction_allowed(v_note.invoice_id,v_note.total) then 'INVOICE_CREDIT_BALANCE_USED'
  when exists(
   select 1 from (
    select ii.sales_order_item_id,sum(l.quantity) as quantity
    from public.invoice_credit_note_lines l join public.invoice_items ii on ii.id=l.invoice_item_id
    where l.credit_note_id=v_note.id group by ii.sales_order_item_id
   ) restored join public.sales_order_item_invoice_progress p using(sales_order_item_id)
   where p.allocated_invoice_quantity+restored.quantity>p.ordered_quantity
  ) then 'INVOICE_CREDIT_QUANTITY_REUSED'
  else null end;
 return jsonb_build_object('actions',jsonb_build_object('reverse',jsonb_build_object('allowed',v_reason is null,'reason',v_reason)));
end;
$$;
revoke all on function public.invoice_credit_note_action_state(uuid) from public,anon,authenticated;
grant execute on function public.invoice_credit_note_action_state(uuid) to service_role;

create or replace view public.invoice_credit_note_state with(security_invoker=true) as
select n.id,n.credit_number,n.invoice_id,n.reason,n.total,n.currency,n.created_by,n.created_at,
 case when r.id is null then 'posted' else 'reversed' end as status,
 r.id as reversal_id,r.reversal_number,r.reason as reversal_reason,r.created_by as reversed_by,r.created_at as reversed_at,
 public.invoice_credit_note_action_state(n.id) as capabilities
from public.invoice_credit_notes n left join public.invoice_credit_note_reversals r on r.credit_note_id=n.id;
revoke all on public.invoice_credit_note_state from public,anon,authenticated;
grant select on public.invoice_credit_note_state to service_role;

create or replace function public.reverse_invoice_quantity_credit(p_credit_note_id uuid,p_request_id uuid,p_reason text,p_actor uuid)
returns public.invoice_credit_note_reversals
language plpgsql security definer set search_path=public,pg_temp as $$
declare v_note public.invoice_credit_notes; v_invoice public.invoices; v_row public.invoice_credit_note_reversals;
 v_payload jsonb; v_state jsonb; v_reason text;
begin
 if not exists(select 1 from public.admin_users where id=p_actor and is_active=true) then raise exception 'INVOICE_CREDIT_ACTOR_INVALID'; end if;
 if p_request_id is null then raise exception 'INVOICE_CREDIT_REQUEST_REQUIRED'; end if;
 if length(btrim(coalesce(p_reason,'')))<3 or length(p_reason)>2000 then raise exception 'INVOICE_CREDIT_REASON_REQUIRED'; end if;
 select * into v_note from public.invoice_credit_notes where id=p_credit_note_id;
 if not found then raise exception 'INVOICE_CREDIT_NOTE_NOT_FOUND'; end if;
 select * into v_invoice from public.invoices where id=v_note.invoice_id for update;
 v_payload:=jsonb_build_object('credit_note_id',p_credit_note_id,'reason',btrim(p_reason));
 select * into v_row from public.invoice_credit_note_reversals where request_id=p_request_id;
 if found then
  if v_row.request_payload is distinct from v_payload or v_row.created_by<>p_actor then raise exception 'INVOICE_CREDIT_REQUEST_CONFLICT'; end if;
  return v_row;
 end if;
 -- Match billing's parent/line locks before restoring capacity. A competing
 -- draft or replacement must finish before the shared action-state read.
 perform 1 from public.sales_orders where id=v_invoice.sales_order_id for update;
 perform 1 from public.sales_order_items where id in (
  select ii.sales_order_item_id from public.invoice_credit_note_lines l join public.invoice_items ii on ii.id=l.invoice_item_id where l.credit_note_id=v_note.id
 ) order by id for update;
 v_state:=public.invoice_credit_note_action_state(v_note.id);
 v_reason:=v_state#>>'{actions,reverse,reason}';
 if v_reason is not null then raise exception '%',v_reason; end if;
 insert into public.invoice_credit_note_reversals(credit_note_id,invoice_id,request_id,request_payload,reason,created_by)
 values(v_note.id,v_note.invoice_id,p_request_id,v_payload,btrim(p_reason),p_actor) returning * into v_row;
 update public.invoices set updated_at=now() where id=v_note.invoice_id;
 return v_row;
exception when unique_violation then raise exception 'INVOICE_CREDIT_REQUEST_CONFLICT';
end;
$$;
revoke all on function public.reverse_invoice_quantity_credit(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.reverse_invoice_quantity_credit(uuid,uuid,text,uuid) to service_role;
