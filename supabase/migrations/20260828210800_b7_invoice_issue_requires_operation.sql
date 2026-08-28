-- B7.4 · Una factura emitida queda estructuralmente bloqueada, por lo que debe tener Expediente antes de emitirla.

create or replace function public.transition_invoice(p_invoice_id uuid, p_action text)
returns public.invoices
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invoice public.invoices;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_target text;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  if v_action = 'issue' then
    if v_invoice.status <> 'draft' then raise exception 'INVOICE_NOT_DRAFT'; end if;
    if v_invoice.operation_id is null then raise exception 'INVOICE_OPERATION_REQUIRED'; end if;
    v_target := 'issued';
  elsif v_action = 'void' then
    if v_invoice.status not in ('draft','issued') then raise exception 'INVOICE_CANNOT_VOID'; end if;
    v_target := 'void';
  else
    raise exception 'INVOICE_ACTION_INVALID';
  end if;

  update public.invoices set status = v_target, updated_at = now() where id = p_invoice_id;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  return v_invoice;
end;
$$;
