-- B6.1 · Hardening del core de Costos
-- Reconciliación posterior a 20260824141801_b6_cost_core, ya aplicada en producción.
-- No añade UI ni propagación COGS a Load/SO/Invoice.

alter table public.cost_charges
  add column posted_by uuid references public.admin_users(id) on delete set null,
  add column voided_by uuid references public.admin_users(id) on delete set null,
  add constraint cost_charges_lifecycle_timestamps_check check (
    (status = 'draft' and posted_at is null and voided_at is null)
    or (status = 'posted' and posted_at is not null and voided_at is null)
    or (status = 'void' and voided_at is not null)
  );

create index cost_charges_posted_by_idx on public.cost_charges(posted_by) where posted_by is not null;
create index cost_charges_voided_by_idx on public.cost_charges(voided_by) where voided_by is not null;

create or replace function public.guard_cost_charge_header()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_business_changed boolean;
  v_allocation_total numeric;
  v_transition text;
begin
  if tg_op = 'DELETE' then
    raise exception 'COST_CHARGE_DELETE_FORBIDDEN';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then raise exception 'COST_CHARGE_MUST_START_DRAFT'; end if;
    if new.posted_at is not null or new.posted_by is not null
       or new.voided_at is not null or new.voided_by is not null then
      raise exception 'COST_CHARGE_LIFECYCLE_FIELDS_FORBIDDEN_ON_CREATE';
    end if;
    return new;
  end if;

  if new.created_by is distinct from old.created_by then
    raise exception 'COST_CHARGE_CREATED_BY_IMMUTABLE';
  end if;

  v_business_changed :=
    new.category is distinct from old.category or
    new.stage is distinct from old.stage or
    new.amount is distinct from old.amount or
    new.currency is distinct from old.currency or
    new.incurred_date is distinct from old.incurred_date or
    new.supplier_id is distinct from old.supplier_id or
    new.reference is distinct from old.reference or
    new.notes is distinct from old.notes;

  if old.status <> 'draft' and v_business_changed then
    raise exception 'COST_CHARGE_HEADER_LOCKED';
  end if;

  if new.status is not distinct from old.status then
    if new.posted_at is distinct from old.posted_at
       or new.posted_by is distinct from old.posted_by
       or new.voided_at is distinct from old.voided_at
       or new.voided_by is distinct from old.voided_by then
      raise exception 'COST_CHARGE_LIFECYCLE_FIELDS_LOCKED';
    end if;

    if old.status = 'draft' and new.amount is distinct from old.amount then
      select coalesce(sum(amount),0)
        into v_allocation_total
      from public.cost_charge_allocations
      where cost_charge_id = old.id;

      if v_allocation_total > new.amount then
        raise exception 'COST_CHARGE_TOTAL_BELOW_ALLOCATIONS';
      end if;
    end if;

    return new;
  end if;

  if v_business_changed then
    raise exception 'COST_CHARGE_TRANSITION_WITH_HEADER_CHANGE';
  end if;

  if old.status = 'void' then
    raise exception 'COST_CHARGE_STATUS_FINAL';
  end if;

  v_transition := current_setting('export_mca.cost_charge_transition', true);

  if old.status = 'draft' and new.status = 'posted' and v_transition = 'post' then
    select coalesce(sum(amount),0)
      into v_allocation_total
    from public.cost_charge_allocations
    where cost_charge_id = old.id;

    if v_allocation_total = 0 then raise exception 'COST_CHARGE_HAS_NO_ALLOCATIONS'; end if;
    if v_allocation_total <> old.amount then raise exception 'COST_CHARGE_NOT_FULLY_ALLOCATED'; end if;
    if new.posted_at is null then raise exception 'COST_CHARGE_POSTED_AT_REQUIRED'; end if;
    if new.voided_at is not null or new.voided_by is not null then
      raise exception 'COST_CHARGE_VOID_FIELDS_INVALID';
    end if;
    return new;
  end if;

  if old.status in ('draft','posted') and new.status = 'void' and v_transition = 'void' then
    if new.voided_at is null then raise exception 'COST_CHARGE_VOIDED_AT_REQUIRED'; end if;
    if old.status = 'draft' and (new.posted_at is not null or new.posted_by is not null) then
      raise exception 'COST_CHARGE_POST_FIELDS_INVALID';
    end if;
    if old.status = 'posted' and (
      new.posted_at is distinct from old.posted_at
      or new.posted_by is distinct from old.posted_by
    ) then
      raise exception 'COST_CHARGE_POST_FIELDS_IMMUTABLE';
    end if;
    return new;
  end if;

  raise exception 'COST_CHARGE_STATUS_TRANSITION_INVALID';
end;
$function$;

create or replace function public.validate_cost_charge_allocation()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
  v_other numeric;
begin
  if tg_op = 'UPDATE' then
    if new.cost_charge_id is distinct from old.cost_charge_id then
      raise exception 'COST_CHARGE_ALLOCATION_PARENT_IMMUTABLE';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'COST_CHARGE_ALLOCATION_CREATED_BY_IMMUTABLE';
    end if;
  end if;

  select *
    into v_charge
  from public.cost_charges
  where id = new.cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status <> 'draft' then raise exception 'COST_CHARGE_ALLOCATIONS_LOCKED'; end if;

  select coalesce(sum(amount),0)
    into v_other
  from public.cost_charge_allocations
  where cost_charge_id = new.cost_charge_id
    and id <> new.id;

  if v_other + new.amount > v_charge.amount then
    raise exception 'COST_CHARGE_ALLOCATION_EXCEEDS_TOTAL';
  end if;

  return new;
end;
$function$;

create or replace function public.guard_cost_charge_allocation_delete()
returns trigger
language plpgsql
set search_path = public
as $function$
declare
  v_status text;
begin
  select status
    into v_status
  from public.cost_charges
  where id = old.cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_status is distinct from 'draft' then raise exception 'COST_CHARGE_ALLOCATIONS_LOCKED'; end if;
  return old;
end;
$function$;

-- Las nuevas columnas/semánticas no son compatibles con CREATE OR REPLACE VIEW
-- sobre la versión B6.1 inicial. Se recrean únicamente las dos views dependientes.
drop view public.warehouse_receipt_item_merchandise_cost;
drop view public.purchase_order_item_merchandise_cost_basis;

create view public.purchase_order_item_merchandise_cost_basis
with (security_invoker = true)
as
with actual as (
  select
    sbi.purchase_order_item_id,
    coalesce(sum(sbi.billed_quantity),0)::numeric as billed_quantity,
    coalesce(sum(sbi.line_total),0)::numeric as billed_cost
  from public.supplier_bill_items sbi
  join public.supplier_bills sb on sb.id = sbi.supplier_bill_id
  where sb.status = 'posted'
  group by sbi.purchase_order_item_id
)
select
  poi.id as purchase_order_item_id,
  poi.purchase_order_id,
  poi.product_id,
  poi.ordered_quantity,
  poi.unit,
  poi.unit_cost as estimated_unit_cost,
  poi.currency,
  coalesce(a.billed_quantity,0)::numeric as actual_billed_quantity,
  coalesce(a.billed_cost,0)::numeric as actual_billed_cost,
  greatest(poi.ordered_quantity - coalesce(a.billed_quantity,0),0)::numeric as estimated_remaining_quantity,
  case
    when coalesce(a.billed_quantity,0) > 0 then a.billed_cost / a.billed_quantity
    else null
  end::numeric as actual_unit_cost,
  case
    when poi.ordered_quantity > 0
         and coalesce(a.billed_quantity,0) >= poi.ordered_quantity
         and coalesce(a.billed_quantity,0) > 0 then a.billed_cost
    when coalesce(a.billed_quantity,0) > 0
         and poi.unit_cost is not null
         and poi.ordered_quantity > 0 then
      a.billed_cost + greatest(poi.ordered_quantity - a.billed_quantity,0) * poi.unit_cost
    when coalesce(a.billed_quantity,0) = 0
         and poi.unit_cost is not null
         and poi.ordered_quantity > 0 then poi.ordered_quantity * poi.unit_cost
    else null
  end::numeric as recognized_merchandise_cost,
  case
    when poi.ordered_quantity > 0
         and coalesce(a.billed_quantity,0) >= poi.ordered_quantity
         and coalesce(a.billed_quantity,0) > 0 then a.billed_cost / a.billed_quantity
    when coalesce(a.billed_quantity,0) > 0
         and poi.unit_cost is not null
         and poi.ordered_quantity > 0 then
      (a.billed_cost + greatest(poi.ordered_quantity - a.billed_quantity,0) * poi.unit_cost) / poi.ordered_quantity
    when coalesce(a.billed_quantity,0) = 0 and poi.unit_cost is not null then poi.unit_cost
    else null
  end::numeric as recognized_unit_cost,
  case
    when poi.ordered_quantity > 0
         and coalesce(a.billed_quantity,0) >= poi.ordered_quantity
         and coalesce(a.billed_quantity,0) > 0 then 'actual'
    when coalesce(a.billed_quantity,0) > 0
         and poi.unit_cost is not null
         and poi.ordered_quantity > 0 then 'partial_actual'
    when coalesce(a.billed_quantity,0) = 0 and poi.unit_cost is not null then 'estimated'
    else 'incomplete_allocation'
  end as cost_coverage
from public.purchase_order_items poi
left join actual a on a.purchase_order_item_id = poi.id;

create view public.warehouse_receipt_item_merchandise_cost
with (security_invoker = true)
as
with link_costs as (
  select
    pra.id as purchase_receipt_allocation_id,
    pra.receipt_item_id,
    pra.purchase_order_item_id,
    pra.received_quantity,
    cb.currency,
    cb.recognized_unit_cost,
    cb.cost_coverage
  from public.purchase_receipt_allocations pra
  join public.purchase_order_item_merchandise_cost_basis cb
    on cb.purchase_order_item_id = pra.purchase_order_item_id
), aggregated as (
  select
    lc.receipt_item_id,
    count(lc.purchase_receipt_allocation_id)::integer as allocation_count,
    count(distinct lc.purchase_order_item_id)::integer as purchase_order_line_count,
    coalesce(sum(lc.received_quantity),0)::numeric as linked_quantity,
    coalesce(sum(lc.received_quantity) filter (where lc.recognized_unit_cost is not null),0)::numeric as costed_quantity,
    count(distinct lc.currency)::integer as source_currency_count,
    min(lc.currency) as single_currency,
    sum(lc.received_quantity * lc.recognized_unit_cost)
      filter (where lc.recognized_unit_cost is not null)::numeric as single_currency_cost_candidate,
    bool_or(lc.cost_coverage = 'incomplete_allocation') as has_incomplete_source,
    bool_and(lc.cost_coverage = 'actual') as all_actual,
    bool_and(lc.cost_coverage = 'estimated') as all_estimated
  from link_costs lc
  group by lc.receipt_item_id
)
select
  wri.id as receipt_item_id,
  wri.receipt_id,
  wr.status as warehouse_receipt_status,
  wri.product_id,
  wri.quantity as physical_quantity,
  wri.unit,
  coalesce(a.linked_quantity,0)::numeric as linked_quantity,
  greatest(wri.quantity - coalesce(a.linked_quantity,0),0)::numeric as unlinked_quantity,
  coalesce(a.costed_quantity,0)::numeric as costed_quantity,
  coalesce(a.purchase_order_line_count,0)::integer as purchase_order_line_count,
  coalesce(a.source_currency_count,0)::integer as source_currency_count,
  case when a.source_currency_count = 1 then a.single_currency else null end as currency,
  case
    when coalesce(a.allocation_count,0) > 0
         and a.source_currency_count = 1
         and a.linked_quantity = wri.quantity
         and a.costed_quantity = a.linked_quantity
         and coalesce(a.has_incomplete_source,false) is false
      then a.single_currency_cost_candidate
    else null
  end::numeric as recognized_merchandise_cost,
  case
    when coalesce(a.allocation_count,0) > 0
         and a.source_currency_count = 1
         and a.linked_quantity = wri.quantity
         and a.costed_quantity = a.linked_quantity
         and coalesce(a.has_incomplete_source,false) is false
         and wri.quantity > 0
      then a.single_currency_cost_candidate / wri.quantity
    else null
  end::numeric as recognized_unit_cost,
  case
    when coalesce(a.allocation_count,0) = 0 then 'incomplete_allocation'
    when a.source_currency_count <> 1 then 'incomplete_allocation'
    when a.linked_quantity <> wri.quantity then 'incomplete_allocation'
    when a.costed_quantity <> a.linked_quantity then 'incomplete_allocation'
    when coalesce(a.has_incomplete_source,false) then 'incomplete_allocation'
    when coalesce(a.all_actual,false) then 'actual'
    when coalesce(a.all_estimated,false) then 'estimated'
    else 'partial_actual'
  end as cost_coverage
from public.warehouse_receipt_items wri
join public.warehouse_receipts wr on wr.id = wri.receipt_id
left join aggregated a on a.receipt_item_id = wri.id;

-- Seguridad explícita: no depender de default privileges del proyecto Supabase.
revoke all on table public.cost_charge_progress from anon, authenticated;
revoke all on table public.purchase_order_item_merchandise_cost_basis from anon, authenticated;
revoke all on table public.warehouse_receipt_item_merchandise_cost from anon, authenticated;
revoke all on sequence public.cost_charges_cost_serial_seq from anon, authenticated, service_role;

grant select on table public.cost_charge_progress to service_role;
grant select on table public.purchase_order_item_merchandise_cost_basis to service_role;
grant select on table public.warehouse_receipt_item_merchandise_cost to service_role;

revoke all on function public.guard_cost_charge_header() from public, anon, authenticated, service_role;
revoke all on function public.validate_cost_charge_allocation() from public, anon, authenticated, service_role;
revoke all on function public.guard_cost_charge_allocation_delete() from public, anon, authenticated, service_role;

comment on column public.cost_charges.posted_by is 'Actor que publica el Cost Charge; se establece únicamente durante la transición controlada de B6.2.';
comment on column public.cost_charges.voided_by is 'Actor que anula el Cost Charge; se conserva como parte de la historia financiera.';
comment on view public.cost_charge_progress is 'Estado derivado de asignación de Cost Charges; void conserva historia y no implica costo activo.';
comment on view public.purchase_order_item_merchandise_cost_basis is 'Costo estimado/actual/reconocido por línea de PO desde PO + Supplier Bills posted. partial_actual solo se reconoce si existe estimado para la parte aún no facturada.';
comment on view public.warehouse_receipt_item_merchandise_cost is 'Costo reconocido por línea física WR usando purchase_receipt_allocations; nunca suma monedas distintas ni usa warehouse_receipt_items.unit_cost como fuente.';
