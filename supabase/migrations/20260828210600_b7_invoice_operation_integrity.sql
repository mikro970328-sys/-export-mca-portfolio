-- B7.4 · La asociación Factura → Expediente es explícita y debe pertenecer al mismo cliente de la Sales Order.

create or replace function public.create_invoice_plan(
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
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_so_status text;
  v_so_client_id uuid;
  v_operation_client_id uuid;
begin
  select status, client_id into v_so_status, v_so_client_id
  from public.sales_orders
  where id = p_sales_order_id
  for update;
  if not found then raise exception 'INVOICE_SO_NOT_FOUND'; end if;
  if v_so_status not in ('confirmed','closed') then raise exception 'INVOICE_SO_NOT_BILLABLE'; end if;

  if p_operation_id is not null then
    select client_id into v_operation_client_id
    from public.operations
    where id = p_operation_id;
    if not found then raise exception 'INVOICE_OPERATION_NOT_FOUND'; end if;
    if v_operation_client_id is distinct from v_so_client_id then
      raise exception 'INVOICE_OPERATION_CLIENT_MISMATCH';
    end if;
  end if;

  insert into public.invoices(sales_order_id, operation_id, issue_date, due_date, status, notes)
  values (p_sales_order_id, p_operation_id, coalesce(p_issue_date,current_date), p_due_date, 'draft', nullif(btrim(p_notes),''))
  returning * into v_invoice;

  perform public.populate_invoice_items(v_invoice.id, p_lines);
  select * into v_invoice from public.invoices where id = v_invoice.id;
  return v_invoice;
end;
$$;

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
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_so_status text;
  v_so_client_id uuid;
  v_operation_client_id uuid;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_invoice.status <> 'draft' then raise exception 'INVOICE_NOT_DRAFT'; end if;

  select status, client_id into v_so_status, v_so_client_id
  from public.sales_orders
  where id = p_sales_order_id
  for update;
  if not found then raise exception 'INVOICE_SO_NOT_FOUND'; end if;
  if v_so_status not in ('confirmed','closed') then raise exception 'INVOICE_SO_NOT_BILLABLE'; end if;

  if p_operation_id is not null then
    select client_id into v_operation_client_id
    from public.operations
    where id = p_operation_id;
    if not found then raise exception 'INVOICE_OPERATION_NOT_FOUND'; end if;
    if v_operation_client_id is distinct from v_so_client_id then
      raise exception 'INVOICE_OPERATION_CLIENT_MISMATCH';
    end if;
  end if;

  delete from public.invoice_items where invoice_id = p_invoice_id;
  update public.invoices
  set sales_order_id = p_sales_order_id,
      operation_id = p_operation_id,
      issue_date = coalesce(p_issue_date,current_date),
      due_date = p_due_date,
      notes = nullif(btrim(p_notes),''),
      updated_at = now()
  where id = p_invoice_id;

  perform public.populate_invoice_items(p_invoice_id, p_lines);
  select * into v_invoice from public.invoices where id = p_invoice_id;
  return v_invoice;
end;
$$;
