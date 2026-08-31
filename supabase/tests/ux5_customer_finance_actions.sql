begin;

do $$
begin
  if exists(select 1 from public.proformas where notes='__UX5_CF_PROFORMA__') then raise exception 'UX5_CF_PROFORMA_FIXTURE_ALREADY_EXISTS'; end if;
  if exists(select 1 from public.customer_advances where reference='UX5-CF-ADV') then raise exception 'UX5_CF_ADVANCE_FIXTURE_ALREADY_EXISTS'; end if;
  if exists(select 1 from public.invoices where notes='__UX5_CF_INVOICE__') then raise exception 'UX5_CF_INVOICE_FIXTURE_ALREADY_EXISTS'; end if;
end;
$$;

create temporary table ux5_cf_context on commit drop as
select so.id as sales_order_id,sip.sales_order_item_id,least(1::numeric,sip.available_to_invoice_quantity) as quantity
from public.sales_orders so
join public.sales_order_item_invoice_progress sip on sip.sales_order_id=so.id
where so.status in ('confirmed','closed') and sip.available_to_invoice_quantity>0
order by so.created_at desc,sip.sales_order_item_id
limit 1;

do $$ begin if not exists(select 1 from ux5_cf_context) then raise exception 'UX5_CF_NO_BILLABLE_SALES_ORDER_AVAILABLE'; end if; end $$;

create temporary table ux5_cf_ids(proforma_id uuid,advance_id uuid,invoice_id uuid,application_id uuid,refund_id uuid) on commit drop;
insert into ux5_cf_ids default values;

update ux5_cf_ids set proforma_id=(select (public.create_proforma(sales_order_id,current_date,current_date+7,'__UX5_CF_PROFORMA__',null)).id from ux5_cf_context);
update ux5_cf_ids set advance_id=(select (public.register_customer_advance(sales_order_id,100,current_date,'wire','UX5-CF-ADV','__UX5_CF_ADVANCE__',null)).id from ux5_cf_context);

do $$
declare so_state jsonb; p_state jsonb; a_state jsonb; v_so uuid; v_p uuid; v_a uuid;
begin
  select sales_order_id into v_so from ux5_cf_context;
  select proforma_id,advance_id into v_p,v_a from ux5_cf_ids;
  so_state:=public.sales_order_customer_finance_action_state(v_so);
  p_state:=public.proforma_action_state(v_p);
  a_state:=public.customer_advance_action_state(v_a);
  if coalesce((so_state#>>'{actions,create_proforma,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_CREATE_PROFORMA_EXPECTED'; end if;
  if coalesce((so_state#>>'{actions,register_advance,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_REGISTER_ADVANCE_EXPECTED'; end if;
  if coalesce((p_state#>>'{actions,issue,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_PROFORMA_ISSUE_EXPECTED'; end if;
  if coalesce((p_state#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_PROFORMA_VOID_EXPECTED'; end if;
  if coalesce((a_state#>>'{actions,apply,allowed}')::boolean,false) is true then raise exception 'UX5_CF_APPLY_WITHOUT_INVOICE_FORBIDDEN'; end if;
  if a_state#>>'{actions,apply,reason}'<>'CUSTOMER_ADVANCE_NO_APPLICABLE_INVOICE' then raise exception 'UX5_CF_APPLY_NO_INVOICE_REASON_EXPECTED'; end if;
  if coalesce((a_state#>>'{actions,refund,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_REFUND_EXPECTED'; end if;
  if coalesce((a_state#>>'{actions,reverse,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_REVERSE_EXPECTED'; end if;
end;
$$;

select public.transition_proforma(proforma_id,'issue',null,null) from ux5_cf_ids;

update ux5_cf_ids x set invoice_id=(
  select (public.create_invoice_plan(c.sales_order_id,jsonb_build_array(jsonb_build_object('sales_order_item_id',c.sales_order_item_id,'quantity',c.quantity,'notes','__UX5_CF_INVOICE_LINE__')),current_date,current_date+30,null,'__UX5_CF_INVOICE__')).id
  from ux5_cf_context c
);
select public.transition_invoice(invoice_id,'issue') from ux5_cf_ids;

do $$
declare p_state jsonb; a_state jsonb; v_p uuid; v_a uuid;
begin
  select proforma_id,advance_id into v_p,v_a from ux5_cf_ids;
  p_state:=public.proforma_action_state(v_p);
  a_state:=public.customer_advance_action_state(v_a);
  if coalesce((p_state#>>'{actions,issue,allowed}')::boolean,false) is true then raise exception 'UX5_CF_ISSUED_PROFORMA_ISSUE_FORBIDDEN'; end if;
  if coalesce((p_state#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_ISSUED_PROFORMA_VOID_EXPECTED'; end if;
  if coalesce((a_state#>>'{actions,apply,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_APPLY_WITH_INVOICE_EXPECTED'; end if;
end;
$$;

update ux5_cf_ids x set application_id=(
  select (public.apply_customer_advance(x.advance_id,x.invoice_id,least(a.available_amount,f.balance_due)/2,'__UX5_CF_APPLICATION__',null)).id
  from public.customer_advance_progress a,public.invoice_financial_progress f
  where a.customer_advance_id=x.advance_id and f.invoice_id=x.invoice_id
);

do $$
declare a_state jsonb; app_state jsonb; v_a uuid; v_app uuid;
begin
  select advance_id,application_id into v_a,v_app from ux5_cf_ids;
  a_state:=public.customer_advance_action_state(v_a);
  app_state:=public.customer_advance_application_action_state(v_app);
  if coalesce((a_state#>>'{actions,reverse,allowed}')::boolean,false) is true then raise exception 'UX5_CF_ADVANCE_REVERSE_WITH_APPLICATION_FORBIDDEN'; end if;
  if a_state#>>'{actions,reverse,reason}'<>'CUSTOMER_ADVANCE_HAS_ACTIVE_APPLICATIONS' then raise exception 'UX5_CF_ACTIVE_APPLICATION_REASON_EXPECTED'; end if;
  if coalesce((app_state#>>'{actions,reverse,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_APPLICATION_REVERSE_EXPECTED'; end if;
end;
$$;

select public.reverse_customer_advance_application(application_id,'UX5 reversible fixture',null) from ux5_cf_ids;

update ux5_cf_ids x set refund_id=(
  select (public.refund_customer_advance(x.advance_id,least(10::numeric,a.available_amount),current_date,'wire','UX5-CF-REFUND','__UX5_CF_REFUND__',null)).id
  from public.customer_advance_progress a where a.customer_advance_id=x.advance_id
);

do $$
declare a_state jsonb; r_state jsonb; v_a uuid; v_r uuid;
begin
  select advance_id,refund_id into v_a,v_r from ux5_cf_ids;
  a_state:=public.customer_advance_action_state(v_a);
  r_state:=public.customer_advance_refund_action_state(v_r);
  if coalesce((a_state#>>'{actions,reverse,allowed}')::boolean,false) is true then raise exception 'UX5_CF_ADVANCE_REVERSE_WITH_REFUND_FORBIDDEN'; end if;
  if a_state#>>'{actions,reverse,reason}'<>'CUSTOMER_ADVANCE_HAS_ACTIVE_REFUNDS' then raise exception 'UX5_CF_ACTIVE_REFUND_REASON_EXPECTED'; end if;
  if coalesce((r_state#>>'{actions,reverse,allowed}')::boolean,false) is not true then raise exception 'UX5_CF_REFUND_REVERSE_EXPECTED'; end if;
end;
$$;

select public.reverse_customer_advance_refund(refund_id,'UX5 reversible fixture',null) from ux5_cf_ids;
select public.reverse_customer_advance(advance_id,'UX5 reversible fixture',null) from ux5_cf_ids;
select public.transition_proforma(proforma_id,'void','UX5 reversible fixture',null) from ux5_cf_ids;

do $$
declare a_state jsonb; p_state jsonb; v_a uuid; v_p uuid;
begin
  select advance_id,proforma_id into v_a,v_p from ux5_cf_ids;
  a_state:=public.customer_advance_action_state(v_a);
  p_state:=public.proforma_action_state(v_p);
  if coalesce((a_state#>>'{actions,apply,allowed}')::boolean,false) or coalesce((a_state#>>'{actions,refund,allowed}')::boolean,false) or coalesce((a_state#>>'{actions,reverse,allowed}')::boolean,false) then raise exception 'UX5_CF_REVERSED_ADVANCE_NO_ACTIONS_EXPECTED'; end if;
  if coalesce((p_state#>>'{actions,issue,allowed}')::boolean,false) or coalesce((p_state#>>'{actions,void,allowed}')::boolean,false) then raise exception 'UX5_CF_VOID_PROFORMA_NO_ACTIONS_EXPECTED'; end if;
end;
$$;

rollback;

select
  (select count(*) from public.proformas where notes='__UX5_CF_PROFORMA__') as proforma_fixture_residue,
  (select count(*) from public.customer_advances where reference='UX5-CF-ADV') as advance_fixture_residue,
  (select count(*) from public.invoices where notes='__UX5_CF_INVOICE__') as invoice_fixture_residue,
  (select count(*) from public.customer_advance_applications where notes='__UX5_CF_APPLICATION__') as application_fixture_residue,
  (select count(*) from public.customer_advance_refunds where reference='UX5-CF-REFUND') as refund_fixture_residue;
