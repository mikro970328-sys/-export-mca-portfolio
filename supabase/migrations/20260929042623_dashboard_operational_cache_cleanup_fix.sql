-- Keep operational cache cleanup scoped to operational entries only.
-- The previous wrapper referenced the financial function's local v_filters variable.
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
security invoker
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
  perform pg_advisory_xact_lock(hashtextextended('erp-dashboard:operational:' || v_permissions, 0));

  select md5(coalesce(string_agg(scope || ':' || version::text, '|' order by scope), ''))
  into v_generation
  from public.erp_change_state
  where scope = any (array['clients','products','suppliers','shipments','purchases','warehouse','inventory','loads','sales','invoices','payables','costs','tasks']::text[]);

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
  where cache_key like 'operational:' || v_permissions || ':%'
    and cache_key <> v_cache_key;

  delete from private.dashboard_rpc_cache
  where generated_at < clock_timestamp() - interval '3 days';

  return v_payload;
end;
$function$;

revoke all on function public.admin_dashboard_snapshot_cached(boolean, boolean, boolean, boolean, boolean, boolean, boolean) from public, anon, authenticated;
grant execute on function public.admin_dashboard_snapshot_cached(boolean, boolean, boolean, boolean, boolean, boolean, boolean) to service_role;
