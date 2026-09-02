-- UX-6 · Cost Charges: canonical DB-owned action capabilities.
-- The existing transactional RPCs remain the final write guards; canonical
-- wrappers make the same action owner explicit for API and UI consumers.

create or replace function public.cost_charge_action_state(p_cost_charge_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','pg_temp'
as $$
declare
  v_charge public.cost_charges;
  v_allocation_count integer := 0;
  v_allocated_amount numeric := 0;
  v_edit_reason text;
  v_post_reason text;
  v_void_reason text;
begin
  select * into v_charge
  from public.cost_charges
  where id=p_cost_charge_id;
  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;

  select count(*)::integer,coalesce(sum(amount),0)::numeric
  into v_allocation_count,v_allocated_amount
  from public.cost_charge_allocations
  where cost_charge_id=v_charge.id;

  v_edit_reason:=case
    when v_charge.status<>'draft' then 'COST_CHARGE_NOT_DRAFT'
    else null
  end;
  v_post_reason:=case
    when v_charge.status<>'draft' then 'COST_CHARGE_NOT_DRAFT'
    when v_allocation_count=0 then 'COST_CHARGE_HAS_NO_ALLOCATIONS'
    when v_allocated_amount<>v_charge.amount then 'COST_CHARGE_NOT_FULLY_ALLOCATED'
    else null
  end;
  v_void_reason:=case
    when v_charge.status not in ('draft','posted') then 'COST_CHARGE_CANNOT_VOID'
    else null
  end;

  return jsonb_build_object(
    'cost_charge_status',v_charge.status,
    'allocation_count',v_allocation_count,
    'allocated_amount',v_allocated_amount,
    'unallocated_amount',greatest(v_charge.amount-v_allocated_amount,0),
    'actions',jsonb_build_object(
      'edit',jsonb_build_object('allowed',v_edit_reason is null,'reason',v_edit_reason),
      'post',jsonb_build_object('allowed',v_post_reason is null,'reason',v_post_reason),
      'void',jsonb_build_object('allowed',v_void_reason is null,'reason',v_void_reason)
    )
  );
end;
$$;

create or replace function public.assert_cost_charge_action(p_cost_charge_id uuid,p_action text)
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
  if v_action not in ('edit','post','void') then raise exception 'COST_CHARGE_ACTION_INVALID'; end if;
  v_state:=public.cost_charge_action_state(p_cost_charge_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'COST_CHARGE_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace view public.cost_charge_action_capabilities
with (security_invoker=true)
as
select id as cost_charge_id,public.cost_charge_action_state(id) as capabilities
from public.cost_charges;

create or replace function public.replace_cost_charge_canonical(
  p_cost_charge_id uuid,
  p_category text,
  p_stage text,
  p_amount numeric,
  p_currency text default 'USD',
  p_incurred_date date default current_date,
  p_supplier_id uuid default null,
  p_reference text default null,
  p_notes text default null,
  p_allocations jsonb default '[]'::jsonb,
  p_actor uuid default null
)
returns public.cost_charges
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  perform public.assert_cost_charge_action(p_cost_charge_id,'edit');
  return public.replace_cost_charge(
    p_cost_charge_id,p_category,p_stage,p_amount,p_currency,p_incurred_date,
    p_supplier_id,p_reference,p_notes,p_allocations,p_actor
  );
end;
$$;

create or replace function public.post_cost_charge_canonical(p_cost_charge_id uuid,p_actor uuid default null)
returns public.cost_charges
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  perform public.assert_cost_charge_action(p_cost_charge_id,'post');
  return public.post_cost_charge(p_cost_charge_id,p_actor);
end;
$$;

create or replace function public.void_cost_charge_canonical(p_cost_charge_id uuid,p_actor uuid default null)
returns public.cost_charges
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $$
begin
  perform public.assert_cost_charge_action(p_cost_charge_id,'void');
  return public.void_cost_charge(p_cost_charge_id,p_actor);
end;
$$;

revoke all on function public.cost_charge_action_state(uuid) from public,anon,authenticated;
revoke all on function public.assert_cost_charge_action(uuid,text) from public,anon,authenticated;
revoke all on function public.replace_cost_charge_canonical(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) from public,anon,authenticated;
revoke all on function public.post_cost_charge_canonical(uuid,uuid) from public,anon,authenticated;
revoke all on function public.void_cost_charge_canonical(uuid,uuid) from public,anon,authenticated;
grant execute on function public.cost_charge_action_state(uuid) to service_role;
grant execute on function public.assert_cost_charge_action(uuid,text) to service_role;
grant execute on function public.replace_cost_charge_canonical(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) to service_role;
grant execute on function public.post_cost_charge_canonical(uuid,uuid) to service_role;
grant execute on function public.void_cost_charge_canonical(uuid,uuid) to service_role;

revoke execute on function public.replace_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) from service_role;
revoke execute on function public.post_cost_charge(uuid,uuid) from service_role;
revoke execute on function public.void_cost_charge(uuid,uuid) from service_role;

revoke all on public.cost_charge_action_capabilities from public,anon,authenticated,service_role;
grant select on public.cost_charge_action_capabilities to service_role;

comment on function public.cost_charge_action_state(uuid)
is 'Canonical business-state owner for Cost Charge edit, post and void capabilities.';
comment on view public.cost_charge_action_capabilities
is 'Service-role-only Cost Charge action capabilities consumed by backend and UI.';
