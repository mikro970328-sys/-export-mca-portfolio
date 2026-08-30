-- P12 · B8.4 Reportes ejecutivos.
-- Un único contrato de datasets filtrables y exportables sobre read-models existentes.
-- No aplica FX, no persiste métricas y no recalcula rentabilidad fuera de B5/B6/B8.

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
      select * from (
        select
          'customer_collection'::text as event_type,
          'in'::text as direction,
          x.payment_id as event_id,
          x.payment_date,
          c.name as party_name,
          c.company as party_detail,
          x.currency,
          x.amount,
          x.method,
          x.reference_number,
          inv.invoice_number as document_number
        from public.executive_customer_payment_kpi_source x
        left join public.clients c on c.id=x.client_id
        left join public.invoices inv on inv.id=x.invoice_id
        where p_supplier_id is null
          and (p_start_date is null or x.payment_date >= p_start_date)
          and (p_end_date is null or x.payment_date <= p_end_date)
          and (p_currency is null or upper(x.currency)=upper(p_currency))
          and (p_client_id is null or x.client_id=p_client_id)
          and (p_product_id is null or p_product_id=any(x.product_ids))

        union all

        select
          'supplier_payment'::text as event_type,
          'out'::text as direction,
          x.supplier_payment_id as event_id,
          x.payment_date,
          s.name as party_name,
          s.legal_name as party_detail,
          x.currency,
          x.amount,
          null::text as method,
          x.payment_number as reference_number,
          po.po_number as document_number
        from public.executive_supplier_payment_kpi_source x
        left join public.suppliers s on s.id=x.supplier_id
        left join public.purchase_orders po on po.id=x.purchase_order_id
        where p_client_id is null
          and (p_start_date is null or x.payment_date >= p_start_date)
          and (p_end_date is null or x.payment_date <= p_end_date)
          and (p_currency is null or upper(x.currency)=upper(p_currency))
          and (p_supplier_id is null or x.supplier_id=p_supplier_id)
          and (p_product_id is null or p_product_id=any(x.product_ids))
      ) combined
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

comment on function public.executive_report_dataset(text,date,date,text,uuid,uuid,uuid,integer) is
  'P12/B8.4 report datasets. Reads existing B8/B5/B6/inventory models, keeps currencies separate, no FX, max 5000 rows.';

revoke all on function public.executive_report_dataset(text,date,date,text,uuid,uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.executive_report_dataset(text,date,date,text,uuid,uuid,uuid,integer) to service_role;
