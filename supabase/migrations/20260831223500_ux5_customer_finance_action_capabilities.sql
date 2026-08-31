-- UX-5 · Customer Advances / Proformas: canonical DB-owned action capabilities.

create or replace function public.sales_order_customer_finance_action_state(p_sales_order_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_so public.sales_orders;
  v_item_count integer:=0;
  v_create_reason text;
  v_register_reason text;
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id;
  if not found then raise exception 'SALES_ORDER_NOT_FOUND'; end if;

  select count(*)::integer into v_item_count from public.sales_order_items where sales_order_id=v_so.id;

  v_create_reason:=case
    when v_so.status not in ('confirmed','closed') then 'PROFORMA_SO_NOT_CONFIRMED'
    when v_item_count=0 then 'PROFORMA_SO_HAS_NO_ITEMS'
    else null
  end;
  v_register_reason:=case
    when v_so.status not in ('confirmed','closed') then 'CUSTOMER_ADVANCE_SO_NOT_CONFIRMED'
    else null
  end;

  return jsonb_build_object(
    'sales_order_status',v_so.status,
    'item_count',v_item_count,
    'actions',jsonb_build_object(
      'create_proforma',jsonb_build_object('allowed',v_create_reason is null,'reason',v_create_reason),
      'register_advance',jsonb_build_object('allowed',v_register_reason is null,'reason',v_register_reason)
    )
  );
end;
$$;

create or replace function public.assert_sales_order_customer_finance_action(p_sales_order_id uuid,p_action text)
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
  if v_action not in ('create_proforma','register_advance') then raise exception 'CUSTOMER_FINANCE_ACTION_INVALID'; end if;
  v_state:=public.sales_order_customer_finance_action_state(p_sales_order_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'CUSTOMER_FINANCE_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace function public.proforma_action_state(p_proforma_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_row public.proformas;
  v_item_count integer:=0;
  v_issue_reason text;
  v_void_reason text;
begin
  select * into v_row from public.proformas where id=p_proforma_id;
  if not found then raise exception 'PROFORMA_NOT_FOUND'; end if;
  select count(*)::integer into v_item_count from public.proforma_items where proforma_id=v_row.id;

  v_issue_reason:=case
    when v_row.status<>'draft' then 'PROFORMA_NOT_DRAFT'
    when v_item_count=0 then 'PROFORMA_HAS_NO_ITEMS'
    else null
  end;
  v_void_reason:=case when v_row.status in ('draft','issued') then null else 'PROFORMA_CANNOT_VOID' end;

  return jsonb_build_object(
    'proforma_status',v_row.status,
    'item_count',v_item_count,
    'actions',jsonb_build_object(
      'issue',jsonb_build_object('allowed',v_issue_reason is null,'reason',v_issue_reason),
      'void',jsonb_build_object('allowed',v_void_reason is null,'reason',v_void_reason)
    )
  );
end;
$$;

create or replace function public.assert_proforma_action(p_proforma_id uuid,p_action text)
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
  if v_action not in ('issue','void') then raise exception 'PROFORMA_ACTION_INVALID'; end if;
  v_state:=public.proforma_action_state(p_proforma_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'PROFORMA_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace function public.customer_advance_action_state(p_customer_advance_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_row public.customer_advances;
  v_applied numeric:=0;
  v_refunded numeric:=0;
  v_available numeric:=0;
  v_active_applications integer:=0;
  v_active_refunds integer:=0;
  v_applicable_invoices integer:=0;
  v_apply_reason text;
  v_refund_reason text;
  v_reverse_reason text;
begin
  select * into v_row from public.customer_advances where id=p_customer_advance_id;
  if not found then raise exception 'CUSTOMER_ADVANCE_NOT_FOUND'; end if;

  select coalesce(sum(amount),0),count(*)::integer into v_applied,v_active_applications
  from public.customer_advance_applications where customer_advance_id=v_row.id and status='posted';
  select coalesce(sum(amount),0),count(*)::integer into v_refunded,v_active_refunds
  from public.customer_advance_refunds where customer_advance_id=v_row.id and status='posted';
  v_available:=greatest(0,coalesce(v_row.amount,0)-v_applied-v_refunded);

  select count(*)::integer into v_applicable_invoices
  from public.invoice_financial_progress f
  where f.sales_order_id=v_row.sales_order_id
    and f.client_id=v_row.client_id
    and f.currency=v_row.currency
    and f.invoice_status='issued'
    and coalesce(f.balance_due,0)>0;

  v_apply_reason:=case
    when v_row.status<>'posted' then case when v_row.status='reversed' then 'CUSTOMER_ADVANCE_ALREADY_REVERSED' else 'CUSTOMER_ADVANCE_STATUS_FINAL' end
    when v_available<=0 then 'CUSTOMER_ADVANCE_NO_AVAILABLE_BALANCE'
    when v_applicable_invoices=0 then 'CUSTOMER_ADVANCE_NO_APPLICABLE_INVOICE'
    else null
  end;
  v_refund_reason:=case
    when v_row.status<>'posted' then case when v_row.status='reversed' then 'CUSTOMER_ADVANCE_ALREADY_REVERSED' else 'CUSTOMER_ADVANCE_STATUS_FINAL' end
    when v_available<=0 then 'CUSTOMER_ADVANCE_NO_AVAILABLE_BALANCE'
    else null
  end;
  v_reverse_reason:=case
    when v_row.status<>'posted' then case when v_row.status='reversed' then 'CUSTOMER_ADVANCE_ALREADY_REVERSED' else 'CUSTOMER_ADVANCE_STATUS_FINAL' end
    when v_active_applications>0 then 'CUSTOMER_ADVANCE_HAS_ACTIVE_APPLICATIONS'
    when v_active_refunds>0 then 'CUSTOMER_ADVANCE_HAS_ACTIVE_REFUNDS'
    else null
  end;

  return jsonb_build_object(
    'advance_status',v_row.status,
    'amount',coalesce(v_row.amount,0),
    'applied_amount',v_applied,
    'refunded_amount',v_refunded,
    'available_amount',v_available,
    'active_application_count',v_active_applications,
    'active_refund_count',v_active_refunds,
    'applicable_invoice_count',v_applicable_invoices,
    'actions',jsonb_build_object(
      'apply',jsonb_build_object('allowed',v_apply_reason is null,'reason',v_apply_reason),
      'refund',jsonb_build_object('allowed',v_refund_reason is null,'reason',v_refund_reason),
      'reverse',jsonb_build_object('allowed',v_reverse_reason is null,'reason',v_reverse_reason)
    )
  );
end;
$$;

create or replace function public.assert_customer_advance_action(p_customer_advance_id uuid,p_action text)
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
  if v_action not in ('apply','refund','reverse') then raise exception 'CUSTOMER_ADVANCE_ACTION_INVALID'; end if;
  v_state:=public.customer_advance_action_state(p_customer_advance_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'CUSTOMER_ADVANCE_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
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
  v_reason:=case when v_row.status='posted' then null when v_row.status='reversed' then 'CUSTOMER_ADVANCE_APPLICATION_ALREADY_REVERSED' else 'CUSTOMER_ADVANCE_APPLICATION_STATUS_FINAL' end;
  return jsonb_build_object('application_status',v_row.status,'customer_advance_id',v_row.customer_advance_id,'invoice_id',v_row.invoice_id,'actions',jsonb_build_object('reverse',jsonb_build_object('allowed',v_reason is null,'reason',v_reason)));
end;
$$;

create or replace function public.assert_customer_advance_application_action(p_application_id uuid,p_action text)
returns void
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare v_action text:=lower(btrim(coalesce(p_action,''))); v_state jsonb; v_reason text;
begin
  if v_action<>'reverse' then raise exception 'CUSTOMER_ADVANCE_APPLICATION_ACTION_INVALID'; end if;
  v_state:=public.customer_advance_application_action_state(p_application_id);
  if coalesce((v_state#>>'{actions,reverse,allowed}')::boolean,false) is not true then
    v_reason:=coalesce(v_state#>>'{actions,reverse,reason}','CUSTOMER_ADVANCE_APPLICATION_ACTION_NOT_ALLOWED');
    raise exception '%',v_reason;
  end if;
end;
$$;

create or replace function public.customer_advance_refund_action_state(p_refund_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advance_refunds; v_reason text;
begin
  select * into v_row from public.customer_advance_refunds where id=p_refund_id;
  if not found then raise exception 'CUSTOMER_ADVANCE_REFUND_NOT_FOUND'; end if;
  v_reason:=case when v_row.status='posted' then null when v_row.status='reversed' then 'CUSTOMER_ADVANCE_REFUND_ALREADY_REVERSED' else 'CUSTOMER_ADVANCE_REFUND_STATUS_FINAL' end;
  return jsonb_build_object('refund_status',v_row.status,'customer_advance_id',v_row.customer_advance_id,'actions',jsonb_build_object('reverse',jsonb_build_object('allowed',v_reason is null,'reason',v_reason)));
end;
$$;

create or replace function public.assert_customer_advance_refund_action(p_refund_id uuid,p_action text)
returns void
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare v_action text:=lower(btrim(coalesce(p_action,''))); v_state jsonb; v_reason text;
begin
  if v_action<>'reverse' then raise exception 'CUSTOMER_ADVANCE_REFUND_ACTION_INVALID'; end if;
  v_state:=public.customer_advance_refund_action_state(p_refund_id);
  if coalesce((v_state#>>'{actions,reverse,allowed}')::boolean,false) is not true then
    v_reason:=coalesce(v_state#>>'{actions,reverse,reason}','CUSTOMER_ADVANCE_REFUND_ACTION_NOT_ALLOWED');
    raise exception '%',v_reason;
  end if;
end;
$$;

create or replace view public.sales_order_customer_finance_action_capabilities with (security_invoker=true) as
select id as sales_order_id,public.sales_order_customer_finance_action_state(id) as capabilities from public.sales_orders;
create or replace view public.proforma_action_capabilities with (security_invoker=true) as
select id as proforma_id,sales_order_id,public.proforma_action_state(id) as capabilities from public.proformas;
create or replace view public.customer_advance_action_capabilities with (security_invoker=true) as
select id as customer_advance_id,sales_order_id,public.customer_advance_action_state(id) as capabilities from public.customer_advances;
create or replace view public.customer_advance_application_action_capabilities with (security_invoker=true) as
select id as application_id,customer_advance_id,public.customer_advance_application_action_state(id) as capabilities from public.customer_advance_applications;
create or replace view public.customer_advance_refund_action_capabilities with (security_invoker=true) as
select id as refund_id,customer_advance_id,public.customer_advance_refund_action_state(id) as capabilities from public.customer_advance_refunds;

create or replace function public.create_proforma(p_sales_order_id uuid,p_issue_date date default current_date,p_valid_until date default null,p_notes text default null,p_actor uuid default null)
returns public.proformas
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.proformas;v_so public.sales_orders;
begin
  select * into v_so from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'PROFORMA_SO_NOT_FOUND'; end if;
  perform public.assert_sales_order_customer_finance_action(v_so.id,'create_proforma');
  insert into public.proformas(sales_order_id,client_id,importer_id,issue_date,valid_until,currency,customer_reference,status,notes,created_by)
  values(v_so.id,v_so.client_id,v_so.importer_id,coalesce(p_issue_date,current_date),p_valid_until,v_so.currency,v_so.customer_reference,'draft',nullif(btrim(p_notes),''),p_actor) returning * into v_row;
  insert into public.proforma_items(proforma_id,sales_order_item_id,product_id,sku,description,quantity,unit,unit_price,line_total,notes)
  select v_row.id,soi.id,soi.product_id,p.sku,concat_ws(' · ',nullif(p.sku,''),p.name),soi.ordered_quantity,soi.unit,coalesce(soi.entered_line_total/nullif(soi.ordered_quantity,0),soi.unit_price),coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price),soi.notes
  from public.sales_order_items soi join public.products p on p.id=soi.product_id where soi.sales_order_id=v_so.id order by soi.created_at;
  return v_row;
end;
$$;

create or replace function public.transition_proforma(p_proforma_id uuid,p_action text,p_reason text default null,p_actor uuid default null)
returns public.proformas
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.proformas;v_action text:=lower(btrim(coalesce(p_action,'')));v_reason text:=nullif(btrim(p_reason),'');
begin
  select * into v_row from public.proformas where id=p_proforma_id for update;
  if not found then raise exception 'PROFORMA_NOT_FOUND'; end if;
  perform public.assert_proforma_action(v_row.id,v_action);
  if v_action='issue' then
    perform set_config('export_mca.proforma_transition','issue',true);
    update public.proformas set status='issued',issued_at=now(),issued_by=p_actor where id=v_row.id returning * into v_row;
  elsif v_action='void' then
    if v_reason is null then raise exception 'PROFORMA_VOID_REASON_REQUIRED'; end if;
    perform set_config('export_mca.proforma_transition','void',true);
    update public.proformas set status='void',voided_at=now(),voided_by=p_actor,void_reason=v_reason where id=v_row.id returning * into v_row;
  else raise exception 'PROFORMA_ACTION_INVALID'; end if;
  return v_row;
end;
$$;

create or replace function public.register_customer_advance(p_sales_order_id uuid,p_amount numeric,p_received_date date default current_date,p_method text default null,p_reference text default null,p_notes text default null,p_actor uuid default null)
returns public.customer_advances
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advances;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'CUSTOMER_ADVANCE_AMOUNT_INVALID'; end if;
  perform public.assert_sales_order_customer_finance_action(p_sales_order_id,'register_advance');
  insert into public.customer_advances(sales_order_id,client_id,amount,currency,received_date,method,reference,status,notes,created_by)
  values(p_sales_order_id,'00000000-0000-0000-0000-000000000000'::uuid,p_amount,'USD',coalesce(p_received_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference),''),'posted',nullif(btrim(p_notes),''),p_actor) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.apply_customer_advance(p_customer_advance_id uuid,p_invoice_id uuid,p_amount numeric,p_notes text default null,p_actor uuid default null)
returns public.customer_advance_applications
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advance_applications;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'CUSTOMER_ADVANCE_APPLICATION_AMOUNT_INVALID'; end if;
  perform public.assert_customer_advance_action(p_customer_advance_id,'apply');
  insert into public.customer_advance_applications(customer_advance_id,invoice_id,amount,status,notes,created_by)
  values(p_customer_advance_id,p_invoice_id,p_amount,'posted',nullif(btrim(p_notes),''),p_actor) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.refund_customer_advance(p_customer_advance_id uuid,p_amount numeric,p_refund_date date default current_date,p_method text default null,p_reference text default null,p_notes text default null,p_actor uuid default null)
returns public.customer_advance_refunds
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advance_refunds;
begin
  if coalesce(p_amount,0)<=0 then raise exception 'CUSTOMER_ADVANCE_REFUND_AMOUNT_INVALID'; end if;
  perform public.assert_customer_advance_action(p_customer_advance_id,'refund');
  insert into public.customer_advance_refunds(customer_advance_id,amount,refund_date,method,reference,status,notes,created_by)
  values(p_customer_advance_id,p_amount,coalesce(p_refund_date,current_date),nullif(btrim(p_method),''),nullif(btrim(p_reference),''),'posted',nullif(btrim(p_notes),''),p_actor) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.reverse_customer_advance(p_customer_advance_id uuid,p_reason text,p_actor uuid default null)
returns public.customer_advances
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advances;v_reason text:=nullif(btrim(p_reason),'');
begin
  if v_reason is null then raise exception 'CUSTOMER_ADVANCE_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_row from public.customer_advances where id=p_customer_advance_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_NOT_FOUND'; end if;
  perform public.assert_customer_advance_action(v_row.id,'reverse');
  perform set_config('export_mca.customer_advance_transition','reverse',true);
  update public.customer_advances set status='reversed',reversed_at=now(),reversed_by=p_actor,reversal_reason=v_reason where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.reverse_customer_advance_application(p_application_id uuid,p_reason text,p_actor uuid default null)
returns public.customer_advance_applications
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advance_applications;v_reason text:=nullif(btrim(p_reason),'');
begin
  if v_reason is null then raise exception 'CUSTOMER_ADVANCE_APPLICATION_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_row from public.customer_advance_applications where id=p_application_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_APPLICATION_NOT_FOUND'; end if;
  perform public.assert_customer_advance_application_action(v_row.id,'reverse');
  perform set_config('export_mca.customer_advance_application_transition','reverse',true);
  update public.customer_advance_applications set status='reversed',reversed_at=now(),reversed_by=p_actor,reversal_reason=v_reason where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.reverse_customer_advance_refund(p_refund_id uuid,p_reason text,p_actor uuid default null)
returns public.customer_advance_refunds
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
declare v_row public.customer_advance_refunds;v_reason text:=nullif(btrim(p_reason),'');
begin
  if v_reason is null then raise exception 'CUSTOMER_ADVANCE_REFUND_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_row from public.customer_advance_refunds where id=p_refund_id for update;
  if not found then raise exception 'CUSTOMER_ADVANCE_REFUND_NOT_FOUND'; end if;
  perform public.assert_customer_advance_refund_action(v_row.id,'reverse');
  perform set_config('export_mca.customer_advance_refund_transition','reverse',true);
  update public.customer_advance_refunds set status='reversed',reversed_at=now(),reversed_by=p_actor,reversal_reason=v_reason where id=v_row.id returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.sales_order_customer_finance_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_sales_order_customer_finance_action(uuid,text) from public,anon,authenticated;
revoke all on function public.proforma_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_proforma_action(uuid,text) from public,anon,authenticated;
revoke all on function public.customer_advance_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_customer_advance_action(uuid,text) from public,anon,authenticated;
revoke all on function public.customer_advance_application_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_customer_advance_application_action(uuid,text) from public,anon,authenticated;
revoke all on function public.customer_advance_refund_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_customer_advance_refund_action(uuid,text) from public,anon,authenticated;
revoke all on function public.create_proforma(uuid,date,date,text,uuid) from public,anon,authenticated;
revoke all on function public.transition_proforma(uuid,text,text,uuid) from public,anon,authenticated;
revoke all on function public.register_customer_advance(uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.apply_customer_advance(uuid,uuid,numeric,text,uuid) from public,anon,authenticated;
revoke all on function public.refund_customer_advance(uuid,numeric,date,text,text,text,uuid) from public,anon,authenticated;
revoke all on function public.reverse_customer_advance(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.reverse_customer_advance_application(uuid,text,uuid) from public,anon,authenticated;
revoke all on function public.reverse_customer_advance_refund(uuid,text,uuid) from public,anon,authenticated;

grant execute on function public.sales_order_customer_finance_action_state(uuid) to service_role;
grant execute on function public.assert_sales_order_customer_finance_action(uuid,text) to service_role;
grant execute on function public.proforma_action_state(uuid) to service_role;
grant execute on function public.assert_proforma_action(uuid,text) to service_role;
grant execute on function public.customer_advance_action_state(uuid) to service_role;
grant execute on function public.assert_customer_advance_action(uuid,text) to service_role;
grant execute on function public.customer_advance_application_action_state(uuid) to service_role;
grant execute on function public.assert_customer_advance_application_action(uuid,text) to service_role;
grant execute on function public.customer_advance_refund_action_state(uuid) to service_role;
grant execute on function public.assert_customer_advance_refund_action(uuid,text) to service_role;
grant execute on function public.create_proforma(uuid,date,date,text,uuid) to service_role;
grant execute on function public.transition_proforma(uuid,text,text,uuid) to service_role;
grant execute on function public.register_customer_advance(uuid,numeric,date,text,text,text,uuid) to service_role;
grant execute on function public.apply_customer_advance(uuid,uuid,numeric,text,uuid) to service_role;
grant execute on function public.refund_customer_advance(uuid,numeric,date,text,text,text,uuid) to service_role;
grant execute on function public.reverse_customer_advance(uuid,text,uuid) to service_role;
grant execute on function public.reverse_customer_advance_application(uuid,text,uuid) to service_role;
grant execute on function public.reverse_customer_advance_refund(uuid,text,uuid) to service_role;

revoke all on public.sales_order_customer_finance_action_capabilities from public,anon,authenticated;
revoke all on public.proforma_action_capabilities from public,anon,authenticated;
revoke all on public.customer_advance_action_capabilities from public,anon,authenticated;
revoke all on public.customer_advance_application_action_capabilities from public,anon,authenticated;
revoke all on public.customer_advance_refund_action_capabilities from public,anon,authenticated;
grant select on public.sales_order_customer_finance_action_capabilities to service_role;
grant select on public.proforma_action_capabilities to service_role;
grant select on public.customer_advance_action_capabilities to service_role;
grant select on public.customer_advance_application_action_capabilities to service_role;
grant select on public.customer_advance_refund_action_capabilities to service_role;
