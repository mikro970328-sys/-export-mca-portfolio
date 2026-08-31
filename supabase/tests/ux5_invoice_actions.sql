begin;

do $$
begin
  if exists(select 1 from public.invoices where notes='__UX5_INVOICE_FIXTURE__') then raise exception 'UX5_INVOICE_FIXTURE_ALREADY_EXISTS'; end if;
  if exists(select 1 from public.payments where reference_number like 'UX5-INVOICE-%') then raise exception 'UX5_PAYMENT_FIXTURE_ALREADY_EXISTS'; end if;
end;
$$;

create temporary table ux5_invoice_fixture_context on commit drop as
select so.id as sales_order_id,sip.sales_order_item_id,least(10::numeric,sip.available_to_invoice_quantity) as quantity
from public.sales_orders so
join public.sales_order_item_invoice_progress sip on sip.sales_order_id=so.id
where so.status in ('confirmed','closed') and sip.available_to_invoice_quantity>0
order by so.created_at desc,sip.sales_order_item_id
limit 1;

do $$ begin if not exists(select 1 from ux5_invoice_fixture_context) then raise exception 'UX5_NO_BILLABLE_SALES_ORDER_AVAILABLE'; end if; end $$;

create temporary table ux5_invoice_fixture_ids(invoice_id uuid,payment_id uuid) on commit drop;

insert into ux5_invoice_fixture_ids(invoice_id)
select (public.create_invoice_plan(
  c.sales_order_id,
  jsonb_build_array(jsonb_build_object('sales_order_item_id',c.sales_order_item_id,'quantity',c.quantity,'notes','__UX5_INVOICE_LINE__')),
  current_date,
  current_date+30,
  null,
  '__UX5_INVOICE_FIXTURE__'
)).id
from ux5_invoice_fixture_context c;

do $$
declare s jsonb; v_id uuid;
begin
  select invoice_id into v_id from ux5_invoice_fixture_ids;
  s:=public.invoice_action_state(v_id);
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is not true then raise exception 'UX5_INVOICE_DRAFT_EDIT_EXPECTED'; end if;
  if coalesce((s#>>'{actions,issue,allowed}')::boolean,false) is not true then raise exception 'UX5_INVOICE_DRAFT_ISSUE_EXPECTED'; end if;
  if coalesce((s#>>'{actions,record_payment,allowed}')::boolean,false) is true then raise exception 'UX5_INVOICE_DRAFT_PAYMENT_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX5_INVOICE_DRAFT_VOID_EXPECTED'; end if;
  perform public.assert_invoice_action(v_id,'issue');
end;
$$;

select public.transition_invoice(invoice_id,'issue') from ux5_invoice_fixture_ids;

do $$
declare s jsonb; v_id uuid;
begin
  select invoice_id into v_id from ux5_invoice_fixture_ids;
  s:=public.invoice_action_state(v_id);
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is true then raise exception 'UX5_INVOICE_ISSUED_EDIT_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,record_payment,allowed}')::boolean,false) is not true then raise exception 'UX5_INVOICE_ISSUED_PAYMENT_EXPECTED'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX5_INVOICE_ISSUED_VOID_EXPECTED'; end if;
end;
$$;

update ux5_invoice_fixture_ids x
set payment_id=(
  select (public.register_invoice_payment(x.invoice_id,f.total/3,current_date,'wire','UX5-INVOICE-PARTIAL','__UX5_INVOICE_PAYMENT__')).id
  from public.invoice_financial_progress f where f.invoice_id=x.invoice_id
);

do $$
declare s jsonb; ps jsonb; v_invoice uuid; v_payment uuid;
begin
  select invoice_id,payment_id into v_invoice,v_payment from ux5_invoice_fixture_ids;
  s:=public.invoice_action_state(v_invoice);
  ps:=public.payment_action_state(v_payment);
  if s->>'payment_status'<>'partial' then raise exception 'UX5_INVOICE_PARTIAL_STATUS_EXPECTED'; end if;
  if coalesce((s#>>'{actions,record_payment,allowed}')::boolean,false) is not true then raise exception 'UX5_INVOICE_PARTIAL_PAYMENT_EXPECTED'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is true then raise exception 'UX5_INVOICE_VOID_WITH_PAYMENT_FORBIDDEN'; end if;
  if s#>>'{actions,void,reason}'<>'INVOICE_HAS_POSTED_PAYMENTS' then raise exception 'UX5_INVOICE_VOID_PAYMENT_REASON_EXPECTED'; end if;
  if coalesce((ps#>>'{actions,reverse,allowed}')::boolean,false) is not true then raise exception 'UX5_PAYMENT_REVERSE_EXPECTED'; end if;
  begin
    perform public.assert_invoice_action(v_invoice,'void');
    raise exception 'UX5_INVOICE_VOID_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('INVOICE_HAS_POSTED_PAYMENTS' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

select public.reverse_invoice_payment(payment_id,'UX5 reversible fixture') from ux5_invoice_fixture_ids;

update ux5_invoice_fixture_ids x
set payment_id=(
  select (public.register_invoice_payment(x.invoice_id,f.balance_due,current_date,'wire','UX5-INVOICE-FULL','__UX5_INVOICE_PAYMENT__')).id
  from public.invoice_financial_progress f where f.invoice_id=x.invoice_id
);

do $$
declare s jsonb; v_invoice uuid;
begin
  select invoice_id into v_invoice from ux5_invoice_fixture_ids;
  s:=public.invoice_action_state(v_invoice);
  if s->>'payment_status'<>'paid' then raise exception 'UX5_INVOICE_PAID_STATUS_EXPECTED'; end if;
  if coalesce((s#>>'{actions,record_payment,allowed}')::boolean,false) is true then raise exception 'UX5_INVOICE_PAID_PAYMENT_MUST_DISAPPEAR'; end if;
  if s#>>'{actions,record_payment,reason}'<>'PAYMENT_INVOICE_ALREADY_SETTLED' then raise exception 'UX5_INVOICE_SETTLED_REASON_EXPECTED'; end if;
end;
$$;

select public.reverse_invoice_payment(payment_id,'UX5 reversible fixture') from ux5_invoice_fixture_ids;
select public.transition_invoice(invoice_id,'void') from ux5_invoice_fixture_ids;

do $$
declare s jsonb; v_invoice uuid;
begin
  select invoice_id into v_invoice from ux5_invoice_fixture_ids;
  s:=public.invoice_action_state(v_invoice);
  if s->>'invoice_status'<>'void' then raise exception 'UX5_INVOICE_VOID_STATUS_EXPECTED'; end if;
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) or coalesce((s#>>'{actions,issue,allowed}')::boolean,false) or coalesce((s#>>'{actions,record_payment,allowed}')::boolean,false) or coalesce((s#>>'{actions,void,allowed}')::boolean,false) then raise exception 'UX5_INVOICE_VOID_NO_ACTIONS_EXPECTED'; end if;
end;
$$;

rollback;

select
  (select count(*) from public.invoices where notes='__UX5_INVOICE_FIXTURE__') as invoice_fixture_residue,
  (select count(*) from public.invoice_items where notes='__UX5_INVOICE_LINE__') as invoice_item_fixture_residue,
  (select count(*) from public.payments where reference_number like 'UX5-INVOICE-%') as payment_fixture_residue;
