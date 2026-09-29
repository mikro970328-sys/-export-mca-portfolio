-- Coalesce concurrent dashboard reads and invalidate on every committed ERP change.
-- Values are keyed by the existing scope versions, so writes become visible immediately.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table if not exists private.dashboard_rpc_cache (
  cache_key text primary key,
  payload jsonb not null,
  generated_at timestamptz not null default clock_timestamp()
);

alter table private.dashboard_rpc_cache enable row level security;
revoke all on table private.dashboard_rpc_cache from public, anon, authenticated, service_role;
grant select, insert, update, delete on table private.dashboard_rpc_cache to service_role;

create or replace function public.admin_dashboard_snapshot_cached(
  p_can_clients boolean,
  p_can_procurement boolean,
  p_can_products boolean,
  p_can_sales boolean,
  p_can_warehouse boolean,
  p_can_tasks boolean,
  p_can_notifications boolean
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public, private
as $function$
declare
  v_permissions text := concat_ws(':',
    p_can_clients::text,
    p_can_procurement::text,
    p_can_products::text,
    p_can_sales::text,
    p_can_warehouse::text,
    p_can_tasks::text,
    p_can_notifications::text
  );
  v_generation text;
  v_cache_key text;
  v_payload jsonb;
begin
  -- One dashboard computation per permission set; peers wait and then reuse it.
  perform pg_advisory_xact_lock(hashtextextended('erp-dashboard:operational:' || v_permissions, 0));

  select md5(coalesce(string_agg(scope || ':' || version::text, '|' order by scope), ''))
  into v_generation
  from public.erp_change_state;

  v_cache_key := 'operational:' || v_permissions || ':' || v_generation;
  select payload into v_payload
  from private.dashboard_rpc_cache
  where cache_key = v_cache_key;

  if found then
    return v_payload;
  end if;

  v_payload := public.admin_dashboard_snapshot(
    p_can_clients,
    p_can_procurement,
    p_can_products,
    p_can_sales,
    p_can_warehouse,
    p_can_tasks,
    p_can_notifications
  );
  if v_payload is null then
    raise exception 'ADMIN_DASHBOARD_SNAPSHOT_EMPTY';
  end if;

  insert into private.dashboard_rpc_cache(cache_key, payload, generated_at)
  values (v_cache_key, v_payload, clock_timestamp())
  on conflict (cache_key) do update
    set payload = excluded.payload,
        generated_at = excluded.generated_at;

  delete from private.dashboard_rpc_cache
  where generated_at < clock_timestamp() - interval '3 days';

  return v_payload;
end;
$function$;

create or replace function public.executive_dashboard_rollup_cached(
  p_start_date date,
  p_end_date date,
  p_currency text,
  p_client_id uuid,
  p_supplier_id uuid,
  p_product_id uuid
)
returns jsonb
language plpgsql
volatile
set search_path = pg_catalog, public, private
as $function$
declare
  v_filters text := md5(jsonb_build_array(
    p_start_date,
    p_end_date,
    p_currency,
    p_client_id,
    p_supplier_id,
    p_product_id
  )::text);
  v_generation text;
  v_cache_key text;
  v_payload jsonb;
begin
  -- Identical filter sets share one calculation, even across serverless instances.
  perform pg_advisory_xact_lock(hashtextextended('erp-dashboard:financial:' || v_filters, 0));

  select md5(coalesce(string_agg(scope || ':' || version::text, '|' order by scope), ''))
  into v_generation
  from public.erp_change_state;

  v_cache_key := 'financial:' || v_filters || ':' || v_generation;
  select payload into v_payload
  from private.dashboard_rpc_cache
  where cache_key = v_cache_key;

  if found then
    return v_payload;
  end if;

  v_payload := public.executive_dashboard_rollup(
    p_start_date,
    p_end_date,
    p_currency,
    p_client_id,
    p_supplier_id,
    p_product_id
  );
  if v_payload is null then
    raise exception 'EXECUTIVE_DASHBOARD_ROLLUP_EMPTY';
  end if;

  insert into private.dashboard_rpc_cache(cache_key, payload, generated_at)
  values (v_cache_key, v_payload, clock_timestamp())
  on conflict (cache_key) do update
    set payload = excluded.payload,
        generated_at = excluded.generated_at;

  delete from private.dashboard_rpc_cache
  where generated_at < clock_timestamp() - interval '3 days';

  return v_payload;
end;
$function$;

revoke all on function public.admin_dashboard_snapshot_cached(boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
revoke all on function public.executive_dashboard_rollup_cached(date, date, text, uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.admin_dashboard_snapshot_cached(boolean, boolean, boolean, boolean, boolean, boolean, boolean) to service_role;
grant execute on function public.executive_dashboard_rollup_cached(date, date, text, uuid, uuid, uuid) to service_role;

comment on table private.dashboard_rpc_cache is
  'Version-keyed operational and financial dashboard snapshots; invalidated by erp_change_state versions.';
