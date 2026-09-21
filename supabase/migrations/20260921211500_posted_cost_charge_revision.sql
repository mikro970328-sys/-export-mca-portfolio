-- Posted costs remain immutable. A correction atomically voids the original
-- charge and posts its replacement, preserving the financial audit trail.
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
  v_revision_reason text;
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
  v_revision_reason:=case
    when v_charge.status<>'posted' then 'COST_CHARGE_NOT_POSTED'
    when v_allocation_count<>1 then 'COST_CHARGE_REVISION_SINGLE_ALLOCATION_REQUIRED'
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
      'revise',jsonb_build_object('allowed',v_revision_reason is null,'reason',v_revision_reason),
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
  if v_action not in ('edit','revise','post','void') then raise exception 'COST_CHARGE_ACTION_INVALID'; end if;
  v_state:=public.cost_charge_action_state(p_cost_charge_id);
  v_allowed:=coalesce((v_state#>>array['actions',v_action,'allowed'])::boolean,false);
  v_reason:=coalesce(v_state#>>array['actions',v_action,'reason'],'COST_CHARGE_ACTION_NOT_ALLOWED');
  if v_allowed is not true then raise exception '%',v_reason; end if;
end;
$$;

create or replace function public.revise_posted_cost_charge(
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
declare
  v_original public.cost_charges;
  v_replacement public.cost_charges;
begin
  perform public.assert_active_cost_actor(p_actor);

  select * into v_original
  from public.cost_charges
  where id=p_cost_charge_id
  for update;
  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;

  perform public.assert_cost_charge_action(p_cost_charge_id,'revise');

  v_replacement:=public.create_posted_cost_charge(
    p_category,p_stage,p_amount,p_currency,p_incurred_date,p_supplier_id,
    p_reference,p_notes,p_allocations,p_actor
  );

  perform public.void_cost_charge_canonical(p_cost_charge_id,p_actor);
  return v_replacement;
end;
$$;

revoke all on function public.revise_posted_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid)
from public,anon,authenticated;
grant execute on function public.revise_posted_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid)
to service_role;

comment on function public.revise_posted_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid)
is 'Atomically replaces one posted, singly allocated cost charge while retaining the original as void.';
