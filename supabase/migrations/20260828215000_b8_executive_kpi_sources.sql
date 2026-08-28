-- B8.1 · Dashboard ejecutivo / fuentes KPI
-- Fuentes planas y filtrables. No convierten monedas ni persisten utilidad.

create or replace view public.executive_invoice_kpi_source
with (security_invoker = true)
as
select
  f.invoice_id,
  f.invoice_number,
  f.sales_order_id,
  i.operation_id,
  f.client_id,
  f.issue_date,
  f.due_date,
  f.currency,
  f.total as invoice_total,
  f.paid_amount,
  f.balance_due,
  f.payment_status,
  (f.balance_due > 0 and f.due_date is not null and f.due_date < current_date) as overdue,
  p.recognized_merchandise_cogs,
  p.cogs_currency,
  p.merchandise_cost_coverage,
  p.currency_comparable,
  p.gross_margin,
  p.gross_margin_pct,
  p.profitability_status,
  coalesce((
    select array_agg(distinct ii.product_id order by ii.product_id)
    from public.invoice_items ii
    where ii.invoice_id = f.invoice_id
      and ii.product_id is not null
  ), '{}'::uuid[]) as product_ids
from public.invoice_financial_progress f
join public.invoices i on i.id = f.invoice_id
left join public.issued_invoice_profitability p on p.invoice_id = f.invoice_id
where f.invoice_status = 'issued';

comment on view public.executive_invoice_kpi_source is
  'B8 KPI source: una fila por factura emitida con AR y rentabilidad B6; sin FX ni agregación entre monedas.';

create or replace view public.executive_customer_payment_kpi_source
with (security_invoker = true)
as
select
  p.id as payment_id,
  p.invoice_id,
  p.operation_id,
  p.client_id,
  p.payment_date,
  p.currency,
  p.amount,
  p.method,
  p.reference_number,
  coalesce((
    select array_agg(distinct ii.product_id order by ii.product_id)
    from public.invoice_items ii
    where ii.invoice_id = p.invoice_id
      and ii.product_id is not null
  ), '{}'::uuid[]) as product_ids
from public.payments p
where p.status = 'posted';

comment on view public.executive_customer_payment_kpi_source is
  'B8 KPI source: cobros de clientes efectivamente posted por fecha de pago.';

create or replace view public.executive_supplier_bill_kpi_source
with (security_invoker = true)
as
select
  f.supplier_bill_id,
  f.bill_number,
  f.purchase_order_id,
  f.supplier_id,
  f.supplier_invoice_number,
  f.bill_date,
  f.due_date,
  f.currency,
  f.bill_total,
  f.paid_amount,
  f.balance_due,
  f.payment_status,
  f.overdue,
  coalesce((
    select array_agg(distinct sbi.product_id order by sbi.product_id)
    from public.supplier_bill_items sbi
    where sbi.supplier_bill_id = f.supplier_bill_id
      and sbi.product_id is not null
  ), '{}'::uuid[]) as product_ids
from public.supplier_bill_financial_progress f
where f.status = 'posted';

comment on view public.executive_supplier_bill_kpi_source is
  'B8 KPI source: supplier bills posted con AP derivado; no incluye borradores como pasivo.';

create or replace view public.executive_supplier_payment_kpi_source
with (security_invoker = true)
as
select
  p.supplier_payment_id,
  p.payment_number,
  p.purchase_order_id,
  p.supplier_id,
  p.payment_date,
  p.currency,
  p.amount,
  p.applied_amount,
  p.unapplied_amount,
  p.application_status,
  coalesce((
    select array_agg(distinct poi.product_id order by poi.product_id)
    from public.purchase_order_items poi
    where poi.purchase_order_id = p.purchase_order_id
      and poi.product_id is not null
  ), '{}'::uuid[]) as product_ids
from public.supplier_payment_progress p
where p.status = 'posted';

comment on view public.executive_supplier_payment_kpi_source is
  'B8 KPI source: pagos a proveedor posted por fecha de pago, incluyendo saldo no aplicado.';

create or replace view public.executive_purchase_order_kpi_source
with (security_invoker = true)
as
select
  po.id as purchase_order_id,
  po.po_number,
  po.supplier_id,
  po.warehouse_id,
  po.order_date,
  po.expected_at,
  po.currency,
  po.status,
  progress.receipt_status,
  progress.has_excess,
  items.item_count,
  items.costed_item_count,
  items.order_total,
  case
    when items.item_count = 0 then 'no_items'
    when items.costed_item_count = items.item_count then 'complete'
    else 'incomplete'
  end as order_value_coverage,
  items.product_ids
from public.purchase_orders po
left join public.purchase_order_progress progress on progress.purchase_order_id = po.id
left join lateral (
  select
    count(*)::integer as item_count,
    count(*) filter (where poi.ordered_quantity is not null and poi.unit_cost is not null)::integer as costed_item_count,
    case
      when count(*) > 0
       and count(*) filter (where poi.ordered_quantity is not null and poi.unit_cost is not null) = count(*)
      then sum(poi.ordered_quantity * poi.unit_cost)
      else null
    end as order_total,
    coalesce(array_agg(distinct poi.product_id order by poi.product_id) filter (where poi.product_id is not null), '{}'::uuid[]) as product_ids
  from public.purchase_order_items poi
  where poi.purchase_order_id = po.id
) items on true;

comment on view public.executive_purchase_order_kpi_source is
  'B8 KPI source: Purchase Orders con valor esperado solo cuando todas las líneas tienen cantidad y costo; no convierte moneda.';

create or replace view public.executive_sales_order_kpi_source
with (security_invoker = true)
as
select
  s.id as sales_order_id,
  s.so_number,
  s.client_id,
  s.importer_id,
  s.order_date,
  s.requested_at,
  progress.commercial_status as status,
  progress.currency,
  progress.order_total,
  progress.fulfillment_status,
  progress.has_partial_dispatch,
  profitability.attributed_sales_revenue,
  profitability.unattributed_order_value,
  profitability.recognized_merchandise_cogs,
  profitability.cogs_currency,
  profitability.merchandise_cost_coverage,
  profitability.currency_comparable,
  profitability.gross_margin,
  profitability.gross_margin_pct,
  profitability.profitability_status,
  coalesce((
    select array_agg(distinct soi.product_id order by soi.product_id)
    from public.sales_order_items soi
    where soi.sales_order_id = s.id
      and soi.product_id is not null
  ), '{}'::uuid[]) as product_ids
from public.sales_orders s
join public.sales_order_progress progress on progress.sales_order_id = s.id
left join public.sales_order_profitability profitability on profitability.sales_order_id = s.id;

comment on view public.executive_sales_order_kpi_source is
  'B8 KPI source: Sales Orders con progreso y rentabilidad B6; no persiste ni recalcula utilidad.';

revoke all on public.executive_invoice_kpi_source from public, anon, authenticated;
revoke all on public.executive_customer_payment_kpi_source from public, anon, authenticated;
revoke all on public.executive_supplier_bill_kpi_source from public, anon, authenticated;
revoke all on public.executive_supplier_payment_kpi_source from public, anon, authenticated;
revoke all on public.executive_purchase_order_kpi_source from public, anon, authenticated;
revoke all on public.executive_sales_order_kpi_source from public, anon, authenticated;

grant select on public.executive_invoice_kpi_source to service_role;
grant select on public.executive_customer_payment_kpi_source to service_role;
grant select on public.executive_supplier_bill_kpi_source to service_role;
grant select on public.executive_supplier_payment_kpi_source to service_role;
grant select on public.executive_purchase_order_kpi_source to service_role;
grant select on public.executive_sales_order_kpi_source to service_role;
