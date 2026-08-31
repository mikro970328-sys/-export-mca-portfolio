-- UX-5 · Containers: canonical DB owner for entity action eligibility.

create or replace function public.shipment_action_state(p_shipment_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_shipment public.shipments;
  v_delivered boolean;
  v_linked_load boolean;
  v_delete_reason text;
begin
  select * into v_shipment from public.shipments where id=p_shipment_id;
  if not found then raise exception 'SHIPMENT_NOT_FOUND'; end if;

  v_delivered := v_shipment.delivered_at is not null or v_shipment.active is false;
  select exists(select 1 from public.loads l where l.shipment_id=v_shipment.id) into v_linked_load;
  v_delete_reason := case when v_linked_load then 'SHIPMENT_LINKED_TO_LOAD' else null end;

  return jsonb_build_object(
    'active',v_shipment.active,
    'delivered',v_delivered,
    'linked_load',v_linked_load,
    'actions',jsonb_build_object(
      'view_info',jsonb_build_object('allowed',true,'reason',null),
      'view_documents',jsonb_build_object('allowed',true,'reason',null),
      'view_history',jsonb_build_object('allowed',true,'reason',null),
      'edit',jsonb_build_object('allowed',true,'reason',null),
      'assign_client',jsonb_build_object(
        'allowed',v_shipment.client_id is null,
        'reason',case when v_shipment.client_id is not null then 'SHIPMENT_ALREADY_HAS_CLIENT' else null end
      ),
      'manual_tracking',jsonb_build_object(
        'allowed',not v_delivered,
        'reason',case when v_delivered then 'SHIPMENT_ALREADY_DELIVERED' else null end
      ),
      'release',jsonb_build_object(
        'allowed',not v_delivered and v_shipment.released_at is null,
        'reason',case when v_delivered then 'SHIPMENT_ALREADY_DELIVERED' when v_shipment.released_at is not null then 'SHIPMENT_ALREADY_RELEASED' else null end
      ),
      'deliver',jsonb_build_object(
        'allowed',not v_delivered,
        'reason',case when v_delivered then 'SHIPMENT_ALREADY_DELIVERED' else null end
      ),
      'reactivate',jsonb_build_object(
        'allowed',v_delivered,
        'reason',case when not v_delivered then 'SHIPMENT_NOT_DELIVERED' else null end
      ),
      'delete',jsonb_build_object('allowed',v_delete_reason is null,'reason',v_delete_reason)
    )
  );
end;
$$;

revoke all on function public.shipment_action_state(uuid) from public,anon,authenticated;
grant execute on function public.shipment_action_state(uuid) to service_role;

create or replace function public.assert_shipment_action(p_shipment_id uuid,p_action text)
returns void
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_action text:=lower(btrim(coalesce(p_action,'')));
  v_state jsonb;
  v_allowed boolean;
  v_reason text;
begin
  if v_action not in ('view_info','view_documents','view_history','edit','assign_client','manual_tracking','release','deliver','reactivate','delete') then
    raise exception 'SHIPMENT_ACTION_INVALID';
  end if;
  v_state:=public.shipment_action_state(p_shipment_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'SHIPMENT_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

revoke all on function public.assert_shipment_action(uuid,text) from public,anon,authenticated;
grant execute on function public.assert_shipment_action(uuid,text) to service_role;

create or replace view public.shipment_action_capabilities
with (security_invoker=true)
as
select s.id as shipment_id,public.shipment_action_state(s.id) as capabilities
from public.shipments s;

revoke all on public.shipment_action_capabilities from public,anon,authenticated;
grant select on public.shipment_action_capabilities to service_role;

comment on function public.shipment_action_state(uuid) is 'UX-5 canonical business action owner for Containers.';
comment on function public.assert_shipment_action(uuid,text) is 'Rejects Container actions that canonical shipment state does not allow.';
