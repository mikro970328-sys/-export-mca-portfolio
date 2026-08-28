-- B8.2 · Rollup ejecutivo por período y moneda.
-- Consume las fuentes B8.1 y conserva AR/AP como snapshots actuales.

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
customer_payment_period as (
  select *
  from public.executive_customer_payment_kpi_source x
  where (p_start_date is null or x.payment_date >= p_start_date)
    and (p_end_date is null or x.payment_date <= p_end_date)
    and (p_currency is null or upper(x.currency) = upper(p_currency))
    and (p_client_id is null or x.client_id = p_client_id)
    and (p_product_id is null or p_product_id = any(x.product_ids))
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
supplier_payment_period as (
  select *
  from public.executive_supplier_payment_kpi_source x
  where (p_start_date is null or x.payment_date >= p_start_date)
    and (p_end_date is null or x.payment_date <= p_end_date)
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
    coalesce(sum(gross_margin) filter (where gross_margin is not null),0) as gross_margin
  from invoice_period
  group by currency
),
customer_cash_activity as (
  select currency, count(*)::integer as customer_payment_count, coalesce(sum(amount),0) as cash_collected
  from customer_payment_period
  group by currency
),
supplier_bill_activity as (
  select currency, count(*)::integer as supplier_bill_count, coalesce(sum(bill_total),0) as posted_supplier_bills
  from supplier_bill_period
  group by currency
),
supplier_cash_activity as (
  select currency, count(*)::integer as supplier_payment_count, coalesce(sum(amount),0) as cash_paid
  from supplier_payment_period
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
    coalesce(sum(order_total) filter (where lower(status) in ('confirmed','closed')),0) as booked_sales_order_value
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
    coalesce(sb.supplier_bill_count,0) as supplier_bill_count,
    coalesce(sb.posted_supplier_bills,0) as posted_supplier_bills,
    coalesce(sc.supplier_payment_count,0) as supplier_payment_count,
    coalesce(sc.cash_paid,0) as cash_paid,
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
    coalesce(i.gross_margin,0) as gross_margin,
    case when coalesce(i.margin_eligible_revenue,0) <> 0
      then (i.gross_margin / i.margin_eligible_revenue) * 100
      else null
    end as gross_margin_pct
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
    'client', 'sales_ar_customer_cash_margin',
    'supplier', 'purchases_ap_supplier_cash',
    'product', 'both_commercial_sides',
    'currency', 'all_financial_metrics',
    'period', 'activity_only'
  )
);
$$;

comment on function public.executive_dashboard_rollup(date,date,text,uuid,uuid,uuid) is
  'B8 ejecutivo: actividad por período + saldos actuales, agrupados por moneda y sin FX.';

revoke all on function public.executive_dashboard_rollup(date,date,text,uuid,uuid,uuid) from public, anon, authenticated, service_role;
grant execute on function public.executive_dashboard_rollup(date,date,text,uuid,uuid,uuid) to service_role;
