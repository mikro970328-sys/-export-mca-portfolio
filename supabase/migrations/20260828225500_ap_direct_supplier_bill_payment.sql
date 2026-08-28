create or replace function public.pay_supplier_bill(
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
set search_path = 'public'
as $function$
declare
  v_bill public.supplier_bills;
  v_balance numeric;
  v_payment public.supplier_payments;
begin
  if coalesce(p_amount,0) <= 0 then
    raise exception 'SUPPLIER_PAYMENT_AMOUNT_INVALID';
  end if;

  select * into v_bill
  from public.supplier_bills
  where id = p_supplier_bill_id
  for update;

  if not found then raise exception 'SUPPLIER_BILL_NOT_FOUND'; end if;
  if v_bill.status <> 'posted' then raise exception 'SUPPLIER_BILL_NOT_POSTED'; end if;

  select coalesce(balance_due,0)
    into v_balance
  from public.supplier_bill_financial_progress
  where supplier_bill_id = p_supplier_bill_id;

  if coalesce(v_balance,0) <= 0 then
    raise exception 'SUPPLIER_BILL_ALREADY_PAID';
  end if;
  if p_amount > v_balance then
    raise exception 'SUPPLIER_PAYMENT_APPLICATION_EXCEEDS_BILL';
  end if;

  select * into v_payment
  from public.register_supplier_payment(
    v_bill.purchase_order_id,
    p_amount,
    coalesce(p_payment_date,current_date),
    p_method,
    p_reference,
    p_notes,
    p_actor
  );

  select * into v_payment
  from public.replace_supplier_payment_applications(
    v_payment.id,
    jsonb_build_array(jsonb_build_object(
      'supplier_bill_id', p_supplier_bill_id::text,
      'amount', p_amount::text
    )),
    p_actor
  );

  return v_payment;
end;
$function$;

revoke all on function public.pay_supplier_bill(uuid,numeric,date,text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.pay_supplier_bill(uuid,numeric,date,text,text,text,uuid) to service_role;
