-- Sincronización multiusuario del ERP sin exponer Supabase al navegador.
-- Cada sentencia que modifica datos incrementa una versión compacta por módulo.

create table if not exists public.erp_change_state (
  scope text primary key,
  version bigint not null default 0,
  changed_at timestamptz not null default clock_timestamp(),
  constraint erp_change_state_scope_valid check (
    scope = any (array[
      'products','suppliers','purchases','warehouse','inventory','loads','sales',
      'clients','shipments','publications','invoices','payables','costs','tasks',
      'notifications','account','workers'
    ])
  ),
  constraint erp_change_state_version_valid check (version >= 0)
);

alter table public.erp_change_state enable row level security;
revoke all privileges on table public.erp_change_state from public, anon, authenticated;
revoke all privileges on table public.erp_change_state from service_role;
grant select on table public.erp_change_state to service_role;

insert into public.erp_change_state(scope)
values
  ('products'),('suppliers'),('purchases'),('warehouse'),('inventory'),('loads'),
  ('sales'),('clients'),('shipments'),('publications'),('invoices'),('payables'),
  ('costs'),('tasks'),('notifications'),('account'),('workers')
on conflict (scope) do nothing;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create or replace function private.bump_erp_change_state()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_scope text := nullif(tg_argv[0], '');
begin
  if v_scope is null or v_scope <> all (array[
    'products','suppliers','purchases','warehouse','inventory','loads','sales',
    'clients','shipments','publications','invoices','payables','costs','tasks',
    'notifications','account','workers'
  ]) then
    raise exception 'ERP_CHANGE_SCOPE_INVALID';
  end if;

  insert into public.erp_change_state as current_state(scope, version, changed_at)
  values (v_scope, 1, clock_timestamp())
  on conflict (scope) do update
  set version = current_state.version + 1,
      changed_at = excluded.changed_at;

  return null;
end;
$$;

revoke all on function private.bump_erp_change_state() from public, anon, authenticated, service_role;

do $$
declare
  mapping record;
begin
  for mapping in
    select * from (values
      ('clients','clients'),
      ('client_importers','clients'),
      ('shipments','shipments'),
      ('shipment_history','shipments'),
      ('operations','shipments'),
      ('operation_items','shipments'),
      ('documents','shipments'),
      ('importers','shipments'),
      ('external_tracking_observations','shipments'),
      ('webhook_events','shipments'),
      ('direct_shipment_dispatches','shipments'),
      ('commercial_publications','publications'),
      ('inventory_listings','publications'),
      ('marketplace_leads','publications'),
      ('products','products'),
      ('suppliers','suppliers'),
      ('purchase_orders','purchases'),
      ('purchase_order_items','purchases'),
      ('warehouses','warehouse'),
      ('warehouse_receipts','warehouse'),
      ('warehouse_receipt_items','warehouse'),
      ('purchase_receipt_allocations','warehouse'),
      ('inventory_movements','inventory'),
      ('loads','loads'),
      ('load_items','loads'),
      ('load_allocations','loads'),
      ('sales_orders','sales'),
      ('sales_order_items','sales'),
      ('sales_fulfillment_allocations','sales'),
      ('sales_supply_plan_lines','sales'),
      ('sales_procurement_allocations','sales'),
      ('direct_shipment_allocations','sales'),
      ('customer_advances','sales'),
      ('customer_advance_applications','sales'),
      ('customer_advance_refunds','sales'),
      ('proformas','sales'),
      ('proforma_items','sales'),
      ('invoices','invoices'),
      ('invoice_items','invoices'),
      ('payments','invoices'),
      ('supplier_bills','payables'),
      ('supplier_bill_items','payables'),
      ('supplier_payments','payables'),
      ('supplier_payment_applications','payables'),
      ('cost_charges','costs'),
      ('cost_charge_allocations','costs'),
      ('expenses','costs'),
      ('operational_tasks','tasks'),
      ('operational_task_comments','tasks'),
      ('operational_task_history','tasks'),
      ('operational_task_dependencies','tasks'),
      ('workflow_task_routes','tasks'),
      ('notifications','notifications'),
      ('operational_alert_conditions','notifications'),
      ('notification_preferences','notifications'),
      ('notification_inbox_items','notifications'),
      ('notification_channel_deliveries','notifications'),
      ('notification_dispatch_claims','notifications'),
      ('push_subscriptions','notifications'),
      ('push_delivery_queue','notifications'),
      ('web_push_runtime_state','notifications'),
      ('admin_users','account'),
      ('access_permissions','account'),
      ('access_roles','account'),
      ('access_role_permissions','account'),
      ('teams','account'),
      ('team_memberships','account'),
      ('workers','workers'),
      ('worker_status_history','workers')
    ) as configured(table_name, scope)
  loop
    if to_regclass(format('public.%I', mapping.table_name)) is null then
      continue;
    end if;

    execute format(
      'drop trigger if exists erp_change_state_bump on public.%I',
      mapping.table_name
    );
    execute format(
      'create trigger erp_change_state_bump after insert or update or delete on public.%I for each statement execute function private.bump_erp_change_state(%L)',
      mapping.table_name,
      mapping.scope
    );
  end loop;
end;
$$;

comment on table public.erp_change_state is
  'Versiones compactas por módulo para sincronización automática y segura entre sesiones del ERP.';

