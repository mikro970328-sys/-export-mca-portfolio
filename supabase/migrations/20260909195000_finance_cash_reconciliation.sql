-- Finance acceptance: all actual cash events share one read model.
-- Applications transfer settlement only: they never create another cash event.
-- Existing ledgers, historical rows and AR/AP/profitability semantics are preserved.
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
where r.status='posted' and a.status='posted';

revoke all on public.executive_cash_movement_source from public,anon,authenticated;
grant select on public.executive_cash_movement_source to service_role;
comment on view public.executive_cash_movement_source is
  'Actual posted cash: invoice collections, customer advances/refunds and supplier payments. No application double-counting or FX.';

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

comment on function public.executive_report_dataset(text,date,date,text,uuid,uuid,uuid,integer) is
  'P12/B8.4 report datasets. Reads existing B8/B5/B6/inventory models, keeps currencies separate, no FX, max 5000 rows.';

revoke all on function public.executive_report_dataset(text,date,date,text,uuid,uuid,uuid,integer) from public, anon, authenticated, service_role;
grant execute on function public.executive_report_dataset(text,date,date,text,uuid,uuid,uuid,integer) to service_role;

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

comment on function public.executive_dashboard_rollup(date,date,text,uuid,uuid,uuid) is
  'B8/P11 ejecutivo: actividad, COGS, margen, contribución y cash flow por período/moneda; AR/AP son snapshots actuales; sin FX.';

revoke all on function public.executive_dashboard_rollup(date,date,text,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.executive_dashboard_rollup(date,date,text,uuid,uuid,uuid) to service_role;
