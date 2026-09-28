CREATE OR REPLACE FUNCTION public.admin_dashboard_snapshot(p_can_clients boolean, p_can_procurement boolean, p_can_products boolean, p_can_sales boolean, p_can_warehouse boolean, p_can_tasks boolean, p_can_notifications boolean)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
with
shipment_status as materialized (
  select
    s.id,
    s.client_id,
    s.operation_id,
    s.container_number,
    s.active,
    s.operational_status,
    s.last_status,
    s.last_event_at,
    s.updated_at,
    s.created_at,
    s.released_at,
    s.delivered_at,
    translate(lower(coalesce(s.operational_status, s.last_status, 'registrado')), 'áéíóúü', 'aeiouu') as status_norm
  from public.shipments s
),
shipment_rows as materialized (
  select
    x.*,
    case
      when x.active is false
        or x.delivered_at is not null
        or x.status_norm ~ '(entreg|delivered|cerrad|closed)' then 'delivered'
      when x.released_at is not null
        or x.status_norm ~ '(liberad|released|disponible para entrega|available for delivery)' then 'released'
      when x.status_norm ~ '(esperando liberacion|awaiting release|pendiente de liberacion)' then 'awaiting_release'
      when x.status_norm ~ '(destino|destination|arribo|arrived|descargad|discharged)' then 'at_destination'
      when x.status_norm ~ '(transit|transito|salio del puerto|salida del puerto|cargado en el buque|loaded on vessel|en navegacion|navegando|transbordo|transshipment|zarpo|zarpado|booking confirmado|cargado)' then 'in_transit'
      else 'active_other'
    end as shipment_group
  from shipment_status x
),
shipment_summary as (
  select
    count(*) as total,
    count(*) filter (where shipment_group <> 'delivered' and active is distinct from false) as active,
    count(*) filter (where shipment_group = 'in_transit') as in_transit,
    count(*) filter (where shipment_group = 'at_destination') as at_destination,
    count(*) filter (where shipment_group = 'awaiting_release') as awaiting_release,
    count(*) filter (where shipment_group = 'released') as released,
    count(*) filter (where shipment_group = 'delivered') as delivered,
    count(*) filter (where shipment_group = 'active_other') as active_other
  from shipment_rows
),
operation_links as (
  select
    operation_id,
    count(*) as shipment_count,
    bool_and(shipment_group = 'delivered') as all_delivered
  from shipment_rows
  where operation_id is not null
  group by operation_id
),
operation_summary as (
  select
    count(*) as total,
    count(*) filter (
      where x.status_norm <> 'cancelled'
        and not (coalesce(l.shipment_count, 0) > 0 and coalesce(l.all_delivered, false))
    ) as active,
    count(*) filter (
      where x.status_norm <> 'cancelled'
        and coalesce(l.shipment_count, 0) = 0
    ) as incomplete,
    count(*) filter (
      where coalesce(l.shipment_count, 0) > 0
        and coalesce(l.all_delivered, false)
    ) as closed
  from (
    select id, translate(lower(coalesce(status, '')), 'áéíóúü', 'aeiouu') as status_norm
    from public.operations
  ) x
  left join operation_links l on l.operation_id = x.id
),
movement_totals as (
  select
    receipt_item_id,
    coalesce(sum(quantity_delta), 0) as quantity_delta,
    coalesce(sum(pallets_delta), 0) as pallets_delta,
    coalesce(sum(reserved_quantity_delta), 0) as reserved_quantity_delta,
    coalesce(sum(reserved_pallets_delta), 0) as reserved_pallets_delta
  from public.inventory_movements
  where receipt_item_id is not null
  group by receipt_item_id
),
inventory_rows as materialized (
  select
    wri.receipt_id,
    wri.product_id,
    wri.quantity + coalesce(m.quantity_delta, 0) as physical_quantity,
    wri.pallets + coalesce(m.pallets_delta, 0) as physical_pallets,
    coalesce(m.reserved_quantity_delta, 0) as reserved_quantity,
    coalesce(m.reserved_pallets_delta, 0) as reserved_pallets
  from public.warehouse_receipt_items wri
  join public.warehouse_receipts wr
    on wr.id = wri.receipt_id and wr.status = 'received'
  join public.warehouses w
    on w.id = wr.warehouse_id and w.active is distinct from false
  join public.products p
    on p.id = wri.product_id
  left join movement_totals m on m.receipt_item_id = wri.id
),
inventory_summary as (
  select
    count(*) filter (
      where physical_quantity - reserved_quantity > 0
         or physical_pallets - reserved_pallets > 0
    ) as source_lines,
    count(distinct product_id) filter (
      where physical_quantity - reserved_quantity > 0
         or physical_pallets - reserved_pallets > 0
    ) as products_with_stock,
    count(distinct receipt_id) filter (
      where physical_quantity - reserved_quantity > 0
         or physical_pallets - reserved_pallets > 0
    ) as wr_with_stock,
    coalesce(sum(physical_quantity), 0) as physical_quantity,
    coalesce(sum(reserved_quantity), 0) as reserved_quantity,
    coalesce(sum(physical_quantity - reserved_quantity), 0) as available_quantity,
    coalesce(sum(physical_pallets), 0) as physical_pallets,
    coalesce(sum(reserved_pallets), 0) as reserved_pallets,
    coalesce(sum(physical_pallets - reserved_pallets), 0) as available_pallets
  from inventory_rows
),
attention as (
  select * from public.executive_operational_attention
),
currency_rows as (
  select currency from public.executive_invoice_kpi_source
  union all
  select currency from public.executive_sales_order_kpi_source
  union all
  select currency from public.executive_purchase_order_kpi_source
  union all
  select currency from public.executive_supplier_bill_kpi_source
),
currency_options as (
  select coalesce(jsonb_agg(currency order by currency), '[]'::jsonb) as currencies
  from (
    select distinct upper(btrim(currency)) as currency
    from currency_rows
    where btrim(coalesce(currency, '')) <> ''
  ) c
)
select jsonb_build_object(
  'stats', jsonb_build_object(
    'clients', (select count(*) from public.clients where active is distinct from false),
    'products', (select count(*) from public.products where active is distinct from false),
    'suppliers', (select count(*) from public.suppliers where active is distinct from false),
    'total', coalesce((select total from shipment_summary), 0),
    'active', coalesce((select active from shipment_summary), 0),
    'in_transit', coalesce((select in_transit from shipment_summary), 0),
    'at_destination', coalesce((select at_destination from shipment_summary), 0),
    'awaiting_release', coalesce((select awaiting_release from shipment_summary), 0),
    'released', coalesce((select released from shipment_summary), 0),
    'delivered', coalesce((select delivered from shipment_summary), 0),
    'active_other', coalesce((select active_other from shipment_summary), 0)
  ),
  'operations', coalesce((select to_jsonb(operation_summary) from operation_summary), '{}'::jsonb),
  'warehouse_receipts', jsonb_build_object(
    'total', (select count(*) from public.warehouse_receipts),
    'received', (select count(*) from public.warehouse_receipts where status = 'received'),
    'cancelled', (select count(*) from public.warehouse_receipts where status = 'cancelled')
  ),
  'loads', jsonb_build_object(
    'total', (select count(*) from public.loads),
    'active', (select count(*) from public.loads where status in ('draft','reserved','loading','loaded')),
    'draft', (select count(*) from public.loads where status = 'draft'),
    'reserved', (select count(*) from public.loads where status = 'reserved'),
    'dispatched', (select count(*) from public.loads where status = 'dispatched'),
    'cancelled', (select count(*) from public.loads where status = 'cancelled')
  ),
  'inventory', coalesce((select to_jsonb(inventory_summary) from inventory_summary), '{}'::jsonb),
  'warehouses', jsonb_build_object(
    'total', (select count(*) from public.warehouses),
    'active', (select count(*) from public.warehouses where active is distinct from false)
  ),
  'documents', jsonb_build_object(
    'total', (select count(*) from public.documents)
  ),
  'work_attention', jsonb_build_object(
    'tasks', case when p_can_tasks then (
      select jsonb_build_object(
        'open', coalesce(open_tasks, 0),
        'blocked', coalesce(blocked_tasks, 0),
        'overdue', coalesce(overdue_tasks, 0),
        'unassigned', coalesce(unassigned_tasks, 0),
        'due_soon', coalesce(due_soon_tasks, 0),
        'routing', coalesce(routing_attention_tasks, 0)
      ) from attention limit 1
    ) else 'null'::jsonb end,
    'alerts', case when p_can_notifications then (
      select jsonb_build_object(
        'active', coalesce(active_alerts, 0),
        'critical', coalesce(critical_alerts, 0)
      ) from attention limit 1
    ) else 'null'::jsonb end
  ),
  'filter_options', jsonb_build_object(
    'clients', case when p_can_clients then coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'company', company) order by name)
      from public.clients where active is true
    ), '[]'::jsonb) else '[]'::jsonb end,
    'suppliers', case when p_can_procurement then coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'legal_name', legal_name) order by name)
      from public.suppliers where active is true
    ), '[]'::jsonb) else '[]'::jsonb end,
    'products', case when p_can_products then coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'sku', sku, 'brand', brand) order by name)
      from public.products where active is true
    ), '[]'::jsonb) else '[]'::jsonb end,
    'currencies', (select currencies from currency_options),
    'capabilities', jsonb_build_object(
      'clients', p_can_clients,
      'suppliers', p_can_procurement,
      'products', p_can_products,
      'sales', p_can_sales,
      'warehouse', p_can_warehouse
    )
  ),
  'recent_activity', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', s.id,
      'container_number', s.container_number,
      'client_name', c.name,
      'operational_status', coalesce(s.operational_status, s.last_status, 'Registrado'),
      'updated_at', coalesce(s.updated_at, s.last_event_at, s.created_at)
    ) order by coalesce(s.updated_at, s.last_event_at, s.created_at, 'epoch'::timestamptz) desc, s.id desc)
    from (
      select *
      from shipment_rows
      order by coalesce(updated_at, last_event_at, created_at, 'epoch'::timestamptz) desc, id desc
      limit 6
    ) s
    left join public.clients c on c.id = s.client_id
  ), '[]'::jsonb)
);
$function$


REVOKE ALL ON FUNCTION public.admin_dashboard_snapshot(boolean, boolean, boolean, boolean, boolean, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_dashboard_snapshot(boolean, boolean, boolean, boolean, boolean, boolean, boolean) TO service_role;
