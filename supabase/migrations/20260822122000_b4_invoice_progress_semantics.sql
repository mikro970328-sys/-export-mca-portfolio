-- B4.1 forward · Semántica explícita de progreso de facturación.
-- Draft reserva capacidad para evitar sobre-facturación, pero solo issued cuenta como facturado.
-- Son views derivadas sin datos propios: se recrean para cambiar el contrato de columnas limpiamente.

drop view if exists public.sales_order_invoice_progress;
drop view if exists public.sales_order_item_invoice_progress;

create view public.sales_order_item_invoice_progress
with (security_invoker = true)
as
select
  soi.id as sales_order_item_id,
  soi.sales_order_id,
  soi.product_id,
  soi.ordered_quantity,
  soi.unit,
  soi.unit_price,
  coalesce(sum(ii.quantity) filter (where i.status = 'draft'),0)::numeric as draft_invoice_quantity,
  coalesce(sum(ii.quantity) filter (where i.status = 'issued'),0)::numeric as invoiced_quantity,
  coalesce(sum(ii.quantity) filter (where i.status in ('draft','issued')),0)::numeric as allocated_invoice_quantity,
  greatest(
    soi.ordered_quantity - coalesce(sum(ii.quantity) filter (where i.status in ('draft','issued')),0),
    0
  )::numeric as available_to_invoice_quantity,
  greatest(
    soi.ordered_quantity - coalesce(sum(ii.quantity) filter (where i.status = 'issued'),0),
    0
  )::numeric as uninvoiced_quantity
from public.sales_order_items soi
left join public.invoice_items ii on ii.sales_order_item_id = soi.id
left join public.invoices i on i.id = ii.invoice_id
group by soi.id, soi.sales_order_id, soi.product_id, soi.ordered_quantity, soi.unit, soi.unit_price;

create view public.sales_order_invoice_progress
with (security_invoker = true)
as
select
  so.id as sales_order_id,
  so.so_number,
  so.client_id,
  so.currency,
  coalesce(sum(soi.ordered_quantity * soi.unit_price),0)::numeric as sales_order_total,
  coalesce(sum(sip.draft_invoice_quantity * soi.unit_price),0)::numeric as draft_invoice_total,
  coalesce(sum(sip.invoiced_quantity * soi.unit_price),0)::numeric as invoiced_total,
  coalesce(sum(sip.allocated_invoice_quantity * soi.unit_price),0)::numeric as allocated_invoice_total,
  greatest(
    coalesce(sum(soi.ordered_quantity * soi.unit_price),0) -
    coalesce(sum(sip.allocated_invoice_quantity * soi.unit_price),0),
    0
  )::numeric as available_to_invoice_total,
  greatest(
    coalesce(sum(soi.ordered_quantity * soi.unit_price),0) -
    coalesce(sum(sip.invoiced_quantity * soi.unit_price),0),
    0
  )::numeric as uninvoiced_total,
  coalesce(bool_and(sip.uninvoiced_quantity = 0), false) as fully_invoiced
from public.sales_orders so
left join public.sales_order_items soi on soi.sales_order_id = so.id
left join public.sales_order_item_invoice_progress sip on sip.sales_order_item_id = soi.id
group by so.id, so.so_number, so.client_id, so.currency;

grant select on table public.sales_order_item_invoice_progress to service_role;
grant select on table public.sales_order_invoice_progress to service_role;

comment on view public.sales_order_item_invoice_progress is 'Progreso por línea: draft reservado, issued facturado y capacidad disponible.';
comment on view public.sales_order_invoice_progress is 'Progreso agregado: draft, emitido y disponible para facturar por Sales Order.';
