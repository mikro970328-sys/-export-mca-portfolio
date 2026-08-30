-- UX-2B · read models únicos para el workspace de una Sales Order.
-- Solo lectura: no mueve inventario, no crea facturas/cobros/costos y no hace FX.

create or replace view public.sales_order_workspace_logistics
with (security_invoker = true)
as
with load_origins as (
  select
    li.id as load_item_id,
    array_remove(array_agg(distinct wr.id), null) as warehouse_receipt_ids,
    array_remove(array_agg(distinct wr.receipt_number), null) as receipt_numbers
  from public.load_items li
  left join public.load_allocations la on la.load_item_id = li.id
  left join public.warehouse_receipt_items wri on wri.id = la.receipt_item_id
  left join public.warehouse_receipts wr on wr.id = wri.receipt_id
  group by li.id
)
select
  so.id as sales_order_id,
  so.so_number,
  soi.id as sales_order_item_id,
  soi.product_id,
  sfa.id as fulfillment_allocation_id,
  sfa.allocated_quantity,
  sfa.allocated_pallets,
  li.id as load_item_id,
  li.unit as load_item_unit,
  l.id as load_id,
  l.load_number,
  l.status as load_status,
  l.warehouse_id,
  l.scheduled_at,
  l.loading_started_at,
  l.loaded_at,
  l.dispatched_at,
  l.client_id as load_client_id,
  l.importer_id as load_importer_id,
  l.shipment_id,
  sh.container_number,
  sh.booking_number,
  sh.bol_number,
  sh.carrier,
  sh.operational_status as shipment_operational_status,
  sh.last_status as shipment_last_status,
  sh.departure_date,
  sh.operation_id,
  op.operation_code,
  op.status as operation_status,
  coalesce(lo.warehouse_receipt_ids, array[]::uuid[]) as warehouse_receipt_ids,
  coalesce(lo.receipt_numbers, array[]::text[]) as receipt_numbers
from public.sales_orders so
join public.sales_order_items soi on soi.sales_order_id = so.id
join public.sales_fulfillment_allocations sfa on sfa.sales_order_item_id = soi.id
join public.load_items li on li.id = sfa.load_item_id
join public.loads l on l.id = li.load_id
left join public.shipments sh on sh.id = l.shipment_id
left join public.operations op on op.id = sh.operation_id
left join load_origins lo on lo.load_item_id = li.id;

create or replace view public.sales_order_workspace_documents
with (security_invoker = true)
as
with candidates as (
  select distinct
    wl.sales_order_id,
    led.document_id,
    ('logistics_' || led.scope)::text as workspace_scope,
    (10 + led.scope_priority)::integer as scope_priority
  from public.sales_order_workspace_logistics wl
  join public.load_expediente_documents led on led.load_id = wl.load_id

  union all

  select
    i.sales_order_id,
    d.id,
    'invoice_source'::text,
    1
  from public.invoices i
  join public.documents d
    on d.source_type = 'invoice'
   and d.source_id = i.id
  where i.sales_order_id is not null

  union all

  select
    i.sales_order_id,
    d.id,
    'invoice_operation'::text,
    5
  from public.invoices i
  join public.documents d on d.operation_id = i.operation_id
  where i.sales_order_id is not null
    and i.operation_id is not null
), ranked as (
  select distinct on (sales_order_id, document_id)
    sales_order_id,
    document_id,
    workspace_scope,
    scope_priority
  from candidates
  order by sales_order_id, document_id, scope_priority
)
select
  r.sales_order_id,
  r.document_id,
  r.workspace_scope,
  r.scope_priority,
  d.operation_id,
  d.client_id,
  d.shipment_id,
  d.load_id,
  d.document_type,
  d.file_name,
  d.mime_type,
  d.file_size_bytes,
  d.version,
  d.notes,
  d.bol_number,
  d.shared_bl,
  d.generated,
  d.source_type,
  d.source_id,
  d.content_sha256,
  d.generated_at,
  d.created_at
from ranked r
join public.documents d on d.id = r.document_id;

create or replace view public.sales_order_workspace_summary
with (security_invoker = true)
as
with billing as (
  select
    ifp.sales_order_id,
    count(*) filter (where ifp.invoice_status = 'draft')::integer as draft_invoice_count,
    count(*) filter (where ifp.invoice_status = 'issued')::integer as issued_invoice_count,
    count(*) filter (where ifp.invoice_status = 'void')::integer as void_invoice_count,
    count(distinct ifp.currency) filter (where ifp.invoice_status = 'issued')::integer as issued_currency_count,
    min(ifp.currency) filter (where ifp.invoice_status = 'issued') as issued_currency,
    case
      when count(*) filter (where ifp.invoice_status = 'issued') = 0 then 0::numeric
      when count(distinct ifp.currency) filter (where ifp.invoice_status = 'issued') = 1
        then sum(ifp.total) filter (where ifp.invoice_status = 'issued')
      else null::numeric
    end as issued_invoice_total,
    case
      when count(*) filter (where ifp.invoice_status = 'issued') = 0 then 0::numeric
      when count(distinct ifp.currency) filter (where ifp.invoice_status = 'issued') = 1
        then sum(ifp.paid_amount) filter (where ifp.invoice_status = 'issued')
      else null::numeric
    end as collected_amount,
    case
      when count(*) filter (where ifp.invoice_status = 'issued') = 0 then 0::numeric
      when count(distinct ifp.currency) filter (where ifp.invoice_status = 'issued') = 1
        then sum(ifp.balance_due) filter (where ifp.invoice_status = 'issued')
      else null::numeric
    end as balance_due
  from public.invoice_financial_progress ifp
  where ifp.sales_order_id is not null
  group by ifp.sales_order_id
), logistics as (
  select
    wl.sales_order_id,
    count(distinct wl.load_id)::integer as load_count,
    count(distinct wl.load_id) filter (where wl.load_status = 'dispatched')::integer as dispatched_load_count,
    count(distinct wl.shipment_id) filter (where wl.shipment_id is not null)::integer as shipment_count,
    count(distinct wl.operation_id) filter (where wl.operation_id is not null)::integer as operation_count,
    count(distinct wr_id)::integer as warehouse_receipt_count
  from public.sales_order_workspace_logistics wl
  left join lateral unnest(wl.warehouse_receipt_ids) wr_id on true
  group by wl.sales_order_id
), documents as (
  select
    sales_order_id,
    count(distinct document_id)::integer as document_count,
    count(distinct document_id) filter (where generated)::integer as generated_document_count
  from public.sales_order_workspace_documents
  group by sales_order_id
)
select
  so.id as sales_order_id,
  so.so_number,
  so.status as commercial_status,
  so.order_date,
  so.requested_at,
  so.currency as sales_currency,
  so.customer_reference,
  so.notes,
  so.client_id,
  c.name as client_name,
  c.company as client_company,
  so.importer_id,
  imp.name as importer_name,
  imp.legal_name as importer_legal_name,

  coalesce(sp.item_count, 0)::integer as item_count,
  coalesce(sp.order_total, 0)::numeric as order_total,
  coalesce(sp.fulfillment_status, 'pending') as fulfillment_status,
  coalesce(sp.pending_items, 0)::integer as pending_items,
  coalesce(sp.planned_items, 0)::integer as planned_items,
  coalesce(sp.prepared_items, 0)::integer as prepared_items,
  coalesce(sp.fully_dispatched_items, 0)::integer as fully_dispatched_items,
  coalesce(sp.has_partial_dispatch, false) as has_partial_dispatch,

  coalesce(lg.load_count, 0)::integer as load_count,
  coalesce(lg.dispatched_load_count, 0)::integer as dispatched_load_count,
  coalesce(lg.shipment_count, 0)::integer as shipment_count,
  coalesce(lg.operation_count, 0)::integer as operation_count,
  coalesce(lg.warehouse_receipt_count, 0)::integer as warehouse_receipt_count,

  coalesce(sip.draft_invoice_total, 0)::numeric as draft_invoice_value,
  coalesce(sip.invoiced_total, 0)::numeric as invoiced_sales_value,
  coalesce(sip.available_to_invoice_total, 0)::numeric as available_to_invoice_value,
  coalesce(sip.uninvoiced_total, 0)::numeric as uninvoiced_sales_value,
  coalesce(sip.fully_invoiced, false) as fully_invoiced,
  coalesce(b.draft_invoice_count, 0)::integer as draft_invoice_count,
  coalesce(b.issued_invoice_count, 0)::integer as issued_invoice_count,
  coalesce(b.void_invoice_count, 0)::integer as void_invoice_count,
  coalesce(b.issued_currency_count, 0)::integer as issued_invoice_currency_count,
  b.issued_currency,
  b.issued_invoice_total,
  b.collected_amount,
  b.balance_due,
  case
    when coalesce(b.issued_invoice_count, 0) = 0 and coalesce(b.draft_invoice_count, 0) > 0 then 'draft'
    when coalesce(b.issued_invoice_count, 0) = 0 then 'not_invoiced'
    when b.issued_currency_count > 1 then 'multi_currency'
    when b.issued_currency <> so.currency then 'currency_mismatch'
    when coalesce(b.balance_due, 0) = 0 and coalesce(b.issued_invoice_total, 0) > 0 then 'paid'
    when coalesce(b.collected_amount, 0) > 0 then 'partial'
    else 'unpaid'
  end as billing_status,
  case
    when coalesce(b.issued_invoice_count, 0) = 0 then true
    when b.issued_currency_count = 1 and b.issued_currency = so.currency then true
    else false
  end as billing_currency_comparable,

  p.attributed_sales_revenue,
  p.cogs_currency,
  p.recognized_merchandise_cogs,
  p.merchandise_cost_coverage,
  p.gross_margin,
  p.gross_margin_pct,
  p.profitability_status,
  p.direct_cost_currency_count,
  p.direct_cost_currency,
  p.direct_cost_charge_count,
  p.direct_cost_amount,
  p.contribution_margin,
  p.contribution_margin_pct,
  p.contribution_status,

  coalesce(d.document_count, 0)::integer as document_count,
  coalesce(d.generated_document_count, 0)::integer as generated_document_count
from public.sales_orders so
left join public.clients c on c.id = so.client_id
left join public.importers imp on imp.id = so.importer_id
left join public.sales_order_progress sp on sp.sales_order_id = so.id
left join public.sales_order_invoice_progress sip on sip.sales_order_id = so.id
left join billing b on b.sales_order_id = so.id
left join logistics lg on lg.sales_order_id = so.id
left join public.sales_order_profitability p on p.sales_order_id = so.id
left join documents d on d.sales_order_id = so.id;

revoke all on table public.sales_order_workspace_logistics from anon, authenticated;
revoke all on table public.sales_order_workspace_documents from anon, authenticated;
revoke all on table public.sales_order_workspace_summary from anon, authenticated;
grant select on table public.sales_order_workspace_logistics to service_role;
grant select on table public.sales_order_workspace_documents to service_role;
grant select on table public.sales_order_workspace_summary to service_role;

comment on view public.sales_order_workspace_summary is 'Read-only one-row facade for the commercial workspace. Reuses authoritative fulfillment, billing and profitability read models; no FX or mutation.';
comment on view public.sales_order_workspace_logistics is 'Read-only Sales Order to fulfillment/load/WR/shipment/operation linkage for the workspace.';
comment on view public.sales_order_workspace_documents is 'Read-only documents reachable from Sales Order logistics or its invoices/operations; does not broaden by client alone.';
