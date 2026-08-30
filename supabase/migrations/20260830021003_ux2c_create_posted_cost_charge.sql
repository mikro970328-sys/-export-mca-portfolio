create or replace function public.create_posted_cost_charge(
  p_category text,
  p_stage text,
  p_amount numeric,
  p_currency text default 'USD'::text,
  p_incurred_date date default current_date,
  p_supplier_id uuid default null::uuid,
  p_reference text default null::text,
  p_notes text default null::text,
  p_allocations jsonb default '[]'::jsonb,
  p_actor uuid default null::uuid
)
returns public.cost_charges
language plpgsql
security definer
set search_path = 'public'
as $function$
declare
  v_charge public.cost_charges;
begin
  v_charge := public.create_cost_charge(
    p_category,
    p_stage,
    p_amount,
    p_currency,
    p_incurred_date,
    p_supplier_id,
    p_reference,
    p_notes,
    p_allocations,
    p_actor
  );

  v_charge := public.post_cost_charge(v_charge.id, p_actor);
  return v_charge;
end;
$function$;

revoke all on function public.create_posted_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid) from public, anon, authenticated;
grant execute on function public.create_posted_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid) to service_role;

comment on function public.create_posted_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid)
is 'Atomically creates and posts one fully allocated cost charge. Any posting failure rolls back the charge and allocations.';
