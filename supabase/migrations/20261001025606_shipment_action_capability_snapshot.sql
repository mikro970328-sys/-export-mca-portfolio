-- Read-only scalar snapshot avoids repeated REST pages (including their offset
-- work) while preserving the existing canonical shipment action owner.
create or replace function public.shipment_action_capability_snapshot(p_max_rows integer default 50000)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $function$
declare
  v_ids uuid[];
  v_rows jsonb;
begin
  if p_max_rows is null or p_max_rows < 1 or p_max_rows > 50000 then
    raise exception 'SHIPMENT_LIST_QUERY_INVALID';
  end if;

  select array_agg(bounded.id order by bounded.id) into v_ids
  from (
    select s.id from public.shipments s order by s.id limit (p_max_rows + 1)
  ) bounded;
  if coalesce(cardinality(v_ids),0) > p_max_rows then
    raise exception 'SHIPMENT_LIST_VOLUME_LIMIT';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'shipment_id',ids.shipment_id,
    'capabilities',public.shipment_action_state(ids.shipment_id)
  ) order by ids.shipment_id),'[]'::jsonb) into v_rows
  from unnest(v_ids) as ids(shipment_id);
  return v_rows;
end;
$function$;

revoke all on function public.shipment_action_capability_snapshot(integer) from public,anon,authenticated;
grant execute on function public.shipment_action_capability_snapshot(integer) to service_role;
comment on function public.shipment_action_capability_snapshot(integer) is
  'Bounded read-only shipment action snapshot; delegates all business rules to shipment_action_state.';
notify pgrst, 'reload schema';
