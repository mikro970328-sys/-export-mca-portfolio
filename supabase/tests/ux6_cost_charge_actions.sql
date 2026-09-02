begin;

do $$
begin
  if exists(select 1 from public.cost_charges where id='19600000-0000-4000-8000-000000000001'::uuid) then
    raise exception 'UX6_COST_CHARGE_FIXTURE_ALREADY_EXISTS';
  end if;
  if not exists(select 1 from public.admin_users where is_active=true) then
    raise exception 'UX6_COST_CHARGE_ACTIVE_ACTOR_REQUIRED';
  end if;
  if not exists(select 1 from public.purchase_orders) then
    raise exception 'UX6_COST_CHARGE_PURCHASE_ORDER_REQUIRED';
  end if;
end;
$$;

insert into public.cost_charges(id,category,stage,amount,currency,incurred_date,status,notes,created_by)
select
  '19600000-0000-4000-8000-000000000001'::uuid,
  'domestic_trucking','inbound',100,'USD',current_date,'draft',
  'UX6 Cost Charge reversible fixture',au.id
from public.admin_users au
where au.is_active=true
order by au.id
limit 1;

do $$
declare s jsonb;
begin
  s:=public.cost_charge_action_state('19600000-0000-4000-8000-000000000001'::uuid);
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is not true then raise exception 'UX6_COST_EDIT_EXPECTED'; end if;
  if coalesce((s#>>'{actions,post,allowed}')::boolean,false) is true then raise exception 'UX6_COST_EMPTY_POST_FORBIDDEN'; end if;
  if s#>>'{actions,post,reason}' <> 'COST_CHARGE_HAS_NO_ALLOCATIONS' then raise exception 'UX6_COST_EMPTY_REASON_EXPECTED'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX6_COST_DRAFT_VOID_EXPECTED'; end if;
end;
$$;

insert into public.cost_charge_allocations(
  id,cost_charge_id,amount,basis,purchase_order_id,notes,created_by
)
select
  '19600000-0000-4000-8000-000000000011'::uuid,
  '19600000-0000-4000-8000-000000000001'::uuid,
  40,'manual',po.id,'UX6 partial allocation fixture',au.id
from (select id from public.purchase_orders order by id limit 1) po
cross join (select id from public.admin_users where is_active=true order by id limit 1) au;

do $$
declare s jsonb;
begin
  s:=public.cost_charge_action_state('19600000-0000-4000-8000-000000000001'::uuid);
  if coalesce((s#>>'{actions,post,allowed}')::boolean,false) is true then raise exception 'UX6_COST_PARTIAL_POST_FORBIDDEN'; end if;
  if s#>>'{actions,post,reason}' <> 'COST_CHARGE_NOT_FULLY_ALLOCATED' then raise exception 'UX6_COST_PARTIAL_REASON_EXPECTED'; end if;
  begin
    perform public.assert_cost_charge_action('19600000-0000-4000-8000-000000000001'::uuid,'post');
    raise exception 'UX6_COST_PARTIAL_ASSERT_DID_NOT_BLOCK';
  exception when others then
    if position('COST_CHARGE_NOT_FULLY_ALLOCATED' in sqlerrm)=0 then raise; end if;
  end;
end;
$$;

update public.cost_charge_allocations
set amount=100
where id='19600000-0000-4000-8000-000000000011'::uuid;

do $$
declare s jsonb;
begin
  s:=public.cost_charge_action_state('19600000-0000-4000-8000-000000000001'::uuid);
  if coalesce((s#>>'{actions,post,allowed}')::boolean,false) is not true then raise exception 'UX6_COST_ALLOCATED_POST_EXPECTED'; end if;
  perform public.assert_cost_charge_action('19600000-0000-4000-8000-000000000001'::uuid,'post');
end;
$$;

select public.post_cost_charge_canonical(
  '19600000-0000-4000-8000-000000000001'::uuid,
  (select id from public.admin_users where is_active=true order by id limit 1)
);

do $$
declare s jsonb;
begin
  s:=public.cost_charge_action_state('19600000-0000-4000-8000-000000000001'::uuid);
  if s->>'cost_charge_status' <> 'posted' then raise exception 'UX6_COST_POSTED_STATUS_EXPECTED'; end if;
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is true then raise exception 'UX6_COST_POSTED_EDIT_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,post,allowed}')::boolean,false) is true then raise exception 'UX6_COST_REPEAT_POST_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is not true then raise exception 'UX6_COST_POSTED_VOID_EXPECTED'; end if;
end;
$$;

select public.void_cost_charge_canonical(
  '19600000-0000-4000-8000-000000000001'::uuid,
  (select id from public.admin_users where is_active=true order by id limit 1)
);

do $$
declare s jsonb;
begin
  s:=public.cost_charge_action_state('19600000-0000-4000-8000-000000000001'::uuid);
  if s->>'cost_charge_status' <> 'void' then raise exception 'UX6_COST_VOID_STATUS_EXPECTED'; end if;
  if coalesce((s#>>'{actions,edit,allowed}')::boolean,false) is true then raise exception 'UX6_COST_VOID_EDIT_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,post,allowed}')::boolean,false) is true then raise exception 'UX6_COST_VOID_POST_FORBIDDEN'; end if;
  if coalesce((s#>>'{actions,void,allowed}')::boolean,false) is true then raise exception 'UX6_COST_REPEAT_VOID_FORBIDDEN'; end if;
end;
$$;

rollback;

select
  (select count(*) from public.cost_charges where id='19600000-0000-4000-8000-000000000001'::uuid) as cost_charge_fixture_residue,
  (select count(*) from public.cost_charge_allocations where id='19600000-0000-4000-8000-000000000011'::uuid) as cost_allocation_fixture_residue;
