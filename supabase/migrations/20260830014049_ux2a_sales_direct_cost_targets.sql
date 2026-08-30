-- UX-2A · gastos directos por venta / producto sin prorrateo automático

alter table public.cost_charge_allocations
  add column if not exists sales_order_id uuid references public.sales_orders(id) on delete restrict,
  add column if not exists sales_order_item_id uuid references public.sales_order_items(id) on delete restrict;

create index if not exists cost_charge_allocations_sales_order_id_idx
  on public.cost_charge_allocations(sales_order_id)
  where sales_order_id is not null;
create index if not exists cost_charge_allocations_sales_order_item_id_idx
  on public.cost_charge_allocations(sales_order_item_id)
  where sales_order_item_id is not null;

alter table public.cost_charge_allocations
  drop constraint if exists cost_charge_allocations_one_target_check;
alter table public.cost_charge_allocations
  add constraint cost_charge_allocations_one_target_check check (
    num_nonnulls(
      purchase_order_id,
      warehouse_receipt_id,
      load_id,
      shipment_id,
      operation_id,
      sales_order_id,
      sales_order_item_id
    ) = 1
  );

alter table public.cost_charges
  drop constraint if exists cost_charges_category_check;
alter table public.cost_charges
  add constraint cost_charges_category_check check (
    category = any (array[
      'domestic_trucking'::text,
      'ocean_freight'::text,
      'insurance'::text,
      'customs_duties'::text,
      'port_terminal'::text,
      'warehouse'::text,
      'inspection'::text,
      'brokerage'::text,
      'nationalization'::text,
      'commission'::text,
      'gifts'::text,
      'documentation'::text,
      'bank_fee'::text,
      'other'::text
    ])
  );

create or replace function public.populate_cost_charge_allocations(
  p_cost_charge_id uuid,
  p_allocations jsonb,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
  v_allocation jsonb;
  v_amount numeric;
  v_basis text;
  v_purchase_order_id uuid;
  v_warehouse_receipt_id uuid;
  v_load_id uuid;
  v_shipment_id uuid;
  v_operation_id uuid;
  v_sales_order_id uuid;
  v_sales_order_item_id uuid;
begin
  select * into v_charge
  from public.cost_charges
  where id = p_cost_charge_id
  for update;

  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status <> 'draft' then raise exception 'COST_CHARGE_NOT_DRAFT'; end if;

  if p_allocations is null then p_allocations := '[]'::jsonb; end if;
  if jsonb_typeof(p_allocations) <> 'array' then raise exception 'COST_CHARGE_ALLOCATIONS_INVALID'; end if;
  if jsonb_array_length(p_allocations) > 500 then raise exception 'COST_CHARGE_TOO_MANY_ALLOCATIONS'; end if;

  for v_allocation in select value from jsonb_array_elements(p_allocations)
  loop
    if jsonb_typeof(v_allocation) <> 'object' then raise exception 'COST_CHARGE_ALLOCATION_INVALID'; end if;

    v_amount := nullif(btrim(v_allocation->>'amount'),'')::numeric;
    v_basis := lower(coalesce(nullif(btrim(v_allocation->>'basis'),''),'manual'));
    v_purchase_order_id := nullif(btrim(v_allocation->>'purchase_order_id'),'')::uuid;
    v_warehouse_receipt_id := nullif(btrim(v_allocation->>'warehouse_receipt_id'),'')::uuid;
    v_load_id := nullif(btrim(v_allocation->>'load_id'),'')::uuid;
    v_shipment_id := nullif(btrim(v_allocation->>'shipment_id'),'')::uuid;
    v_operation_id := nullif(btrim(v_allocation->>'operation_id'),'')::uuid;
    v_sales_order_id := nullif(btrim(v_allocation->>'sales_order_id'),'')::uuid;
    v_sales_order_item_id := nullif(btrim(v_allocation->>'sales_order_item_id'),'')::uuid;

    if v_amount is null or v_amount <= 0 then raise exception 'COST_CHARGE_ALLOCATION_AMOUNT_INVALID'; end if;
    if v_basis not in ('manual','quantity','pallets','value','weight') then raise exception 'COST_CHARGE_ALLOCATION_BASIS_INVALID'; end if;

    if num_nonnulls(
      v_purchase_order_id,
      v_warehouse_receipt_id,
      v_load_id,
      v_shipment_id,
      v_operation_id,
      v_sales_order_id,
      v_sales_order_item_id
    ) <> 1 then
      raise exception 'COST_CHARGE_ALLOCATION_TARGET_INVALID';
    end if;

    insert into public.cost_charge_allocations(
      cost_charge_id, amount, basis,
      purchase_order_id, warehouse_receipt_id, load_id, shipment_id, operation_id,
      sales_order_id, sales_order_item_id,
      notes, created_by
    ) values (
      p_cost_charge_id, v_amount, v_basis,
      v_purchase_order_id, v_warehouse_receipt_id, v_load_id, v_shipment_id, v_operation_id,
      v_sales_order_id, v_sales_order_item_id,
      nullif(btrim(v_allocation->>'notes'),''), p_actor
    );
  end loop;
end;
$function$;

create or replace function public.create_cost_charge(
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
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
  v_category text := lower(btrim(coalesce(p_category,'')));
  v_stage text := lower(btrim(coalesce(p_stage,'')));
  v_currency text := upper(coalesce(nullif(btrim(p_currency),''),'USD'));
begin
  perform public.assert_active_cost_actor(p_actor);

  if v_category not in (
    'domestic_trucking','ocean_freight','insurance','customs_duties','port_terminal',
    'warehouse','inspection','brokerage','nationalization','commission','gifts',
    'documentation','bank_fee','other'
  ) then raise exception 'COST_CHARGE_CATEGORY_INVALID'; end if;
  if v_stage not in ('inbound','fulfillment','destination','overhead') then raise exception 'COST_CHARGE_STAGE_INVALID'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'COST_CHARGE_AMOUNT_INVALID'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'COST_CHARGE_CURRENCY_INVALID'; end if;

  insert into public.cost_charges(
    category, stage, amount, currency, incurred_date, supplier_id,
    reference, status, notes, created_by
  ) values (
    v_category, v_stage, p_amount, v_currency, coalesce(p_incurred_date,current_date),
    p_supplier_id, nullif(btrim(p_reference),''), 'draft', nullif(btrim(p_notes),''), p_actor
  ) returning * into v_charge;

  perform public.populate_cost_charge_allocations(v_charge.id, p_allocations, p_actor);
  select * into v_charge from public.cost_charges where id = v_charge.id;
  return v_charge;
end;
$function$;

create or replace function public.replace_cost_charge(
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
set search_path = public
as $function$
declare
  v_charge public.cost_charges;
  v_category text := lower(btrim(coalesce(p_category,'')));
  v_stage text := lower(btrim(coalesce(p_stage,'')));
  v_currency text := upper(coalesce(nullif(btrim(p_currency),''),'USD'));
begin
  perform public.assert_active_cost_actor(p_actor);
  select * into v_charge from public.cost_charges where id = p_cost_charge_id for update;
  if not found then raise exception 'COST_CHARGE_NOT_FOUND'; end if;
  if v_charge.status <> 'draft' then raise exception 'COST_CHARGE_NOT_DRAFT'; end if;

  if v_category not in (
    'domestic_trucking','ocean_freight','insurance','customs_duties','port_terminal',
    'warehouse','inspection','brokerage','nationalization','commission','gifts',
    'documentation','bank_fee','other'
  ) then raise exception 'COST_CHARGE_CATEGORY_INVALID'; end if;
  if v_stage not in ('inbound','fulfillment','destination','overhead') then raise exception 'COST_CHARGE_STAGE_INVALID'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'COST_CHARGE_AMOUNT_INVALID'; end if;
  if v_currency !~ '^[A-Z]{3}$' then raise exception 'COST_CHARGE_CURRENCY_INVALID'; end if;

  delete from public.cost_charge_allocations where cost_charge_id = p_cost_charge_id;
  update public.cost_charges
    set category=v_category, stage=v_stage, amount=p_amount, currency=v_currency,
        incurred_date=coalesce(p_incurred_date,current_date), supplier_id=p_supplier_id,
        reference=nullif(btrim(p_reference),''), notes=nullif(btrim(p_notes),'')
    where id=p_cost_charge_id;

  perform public.populate_cost_charge_allocations(p_cost_charge_id,p_allocations,p_actor);
  select * into v_charge from public.cost_charges where id=p_cost_charge_id;
  return v_charge;
end;
$function$;

create or replace view public.posted_cost_charge_allocations
with (security_invoker = true)
as
select
  cca.id as cost_charge_allocation_id,
  cc.id as cost_charge_id,
  cc.cost_number,
  cc.category,
  cc.stage,
  cc.currency,
  cc.incurred_date,
  cca.amount as allocated_amount,
  cca.basis,
  case
    when cca.purchase_order_id is not null then 'purchase_order'
    when cca.warehouse_receipt_id is not null then 'warehouse_receipt'
    when cca.load_id is not null then 'load'
    when cca.shipment_id is not null then 'shipment'
    when cca.operation_id is not null then 'operation'
    when cca.sales_order_id is not null then 'sales_order'
    when cca.sales_order_item_id is not null then 'sales_order_item'
    else null
  end as target_type,
  coalesce(
    cca.purchase_order_id,
    cca.warehouse_receipt_id,
    cca.load_id,
    cca.shipment_id,
    cca.operation_id,
    cca.sales_order_id,
    cca.sales_order_item_id
  ) as target_id,
  cca.purchase_order_id,
  cca.warehouse_receipt_id,
  cca.load_id,
  cca.shipment_id,
  cca.operation_id,
  cca.sales_order_id,
  cca.sales_order_item_id
from public.cost_charge_allocations cca
join public.cost_charges cc on cc.id = cca.cost_charge_id
where cc.status = 'posted';

create or replace view public.posted_cost_charge_traceability
with (security_invoker = true)
as
with resolved as (
  select
    p.cost_charge_allocation_id,
    p.cost_charge_id,
    p.cost_number,
    p.category,
    p.stage,
    p.currency,
    p.incurred_date,
    p.allocated_amount,
    p.basis,
    p.target_type,
    p.target_id,
    p.purchase_order_id,
    p.warehouse_receipt_id,
    p.load_id,
    p.shipment_id,
    p.operation_id,
    p.sales_order_id,
    p.sales_order_item_id,
    l.load_number,
    coalesce(p.shipment_id,l.shipment_id) as resolved_shipment_id,
    coalesce(sd.container_number,sl.container_number) as container_number,
    coalesce(p.operation_id,sd.operation_id,sl.operation_id) as resolved_operation_id,
    po.po_number,
    wr.receipt_number,
    coalesce(p.sales_order_id,soi.sales_order_id) as resolved_sales_order_id
  from public.posted_cost_charge_allocations p
  left join public.purchase_orders po on po.id = p.purchase_order_id
  left join public.warehouse_receipts wr on wr.id = p.warehouse_receipt_id
  left join public.loads l on l.id = p.load_id
  left join public.shipments sd on sd.id = p.shipment_id
  left join public.shipments sl on sl.id = l.shipment_id
  left join public.sales_order_items soi on soi.id = p.sales_order_item_id
)
select
  r.cost_charge_allocation_id,
  r.cost_charge_id,
  r.cost_number,
  r.category,
  r.stage,
  r.currency,
  r.incurred_date,
  r.allocated_amount,
  r.basis,
  r.target_type,
  r.target_id,
  r.purchase_order_id,
  r.po_number,
  r.warehouse_receipt_id,
  r.receipt_number,
  r.load_id,
  r.load_number,
  r.resolved_shipment_id as shipment_id,
  r.container_number,
  r.resolved_operation_id as operation_id,
  o.operation_code,
  case
    when r.target_type='purchase_order' then r.po_number
    when r.target_type='warehouse_receipt' then r.receipt_number
    when r.target_type='load' then r.load_number
    when r.target_type='shipment' then r.container_number
    when r.target_type='operation' then o.operation_code
    when r.target_type='sales_order' then so.so_number
    when r.target_type='sales_order_item' then so.so_number || ' · línea ' || left(r.sales_order_item_id::text,8)
    else null
  end as target_reference,
  r.resolved_sales_order_id as sales_order_id,
  so.so_number,
  r.sales_order_item_id
from resolved r
left join public.operations o on o.id = r.resolved_operation_id
left join public.sales_orders so on so.id = r.resolved_sales_order_id;

create or replace view public.sales_order_direct_costs
with (security_invoker = true)
as
with resolved as (
  select
    p.*,
    coalesce(p.sales_order_id,soi.sales_order_id) as resolved_sales_order_id
  from public.posted_cost_charge_allocations p
  left join public.sales_order_items soi
    on p.target_type='sales_order_item' and soi.id=p.sales_order_item_id
  where p.target_type in ('sales_order','sales_order_item')
)
select
  so.id as sales_order_id,
  so.so_number,
  so.status as sales_order_status,
  r.currency,
  count(r.cost_charge_allocation_id)::integer as allocation_count,
  count(distinct r.cost_charge_id)::integer as charge_count,
  sum(r.allocated_amount)::numeric as direct_cost_amount,
  coalesce(sum(r.allocated_amount) filter (where r.target_type='sales_order'),0)::numeric as sales_order_target_amount,
  coalesce(sum(r.allocated_amount) filter (where r.target_type='sales_order_item'),0)::numeric as sales_order_item_target_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage='inbound'),0)::numeric as inbound_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage='fulfillment'),0)::numeric as fulfillment_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage='destination'),0)::numeric as destination_amount,
  coalesce(sum(r.allocated_amount) filter (where r.stage='overhead'),0)::numeric as overhead_amount
from resolved r
join public.sales_orders so on so.id = r.resolved_sales_order_id
group by so.id,so.so_number,so.status,r.currency;

create or replace view public.sales_order_profitability
with (security_invoker = true)
as
with item_scope as (
  select
    so.id as sales_order_id,
    soi.id as sales_order_item_id,
    coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price) as ordered_sales_value,
    coalesce(soic.active_allocated_quantity,0)::numeric as active_allocated_quantity,
    case
      when soi.ordered_quantity>0 then coalesce(soic.active_allocated_quantity,0) * (coalesce(soi.entered_line_total,soi.ordered_quantity*soi.unit_price)/soi.ordered_quantity)
      else 0
    end::numeric as attributed_sales_value,
    soic.cogs_currency,
    soic.attributable_merchandise_cogs,
    soic.cost_coverage
  from public.sales_orders so
  join public.sales_order_items soi on soi.sales_order_id=so.id
  left join public.sales_order_item_merchandise_cogs soic on soic.sales_order_item_id=soi.id
), aggregated as (
  select
    sales_order_id,
    count(*)::integer as item_count,
    count(*) filter (where active_allocated_quantity>0)::integer as active_item_count,
    coalesce(sum(ordered_sales_value),0)::numeric as order_total,
    coalesce(sum(attributed_sales_value) filter (where active_allocated_quantity>0),0)::numeric as attributed_sales_revenue,
    count(attributable_merchandise_cogs) filter (where active_allocated_quantity>0)::integer as costed_active_item_count,
    count(cogs_currency) filter (where active_allocated_quantity>0)::integer as known_currency_active_item_count,
    count(distinct cogs_currency) filter (where active_allocated_quantity>0)::integer as source_currency_count,
    min(cogs_currency) filter (where active_allocated_quantity>0) as single_cogs_currency,
    sum(attributable_merchandise_cogs) filter (where active_allocated_quantity>0)::numeric as cost_candidate,
    bool_or(cost_coverage='incomplete_allocation') filter (where active_allocated_quantity>0) as has_incomplete_cost,
    bool_and(cost_coverage='actual') filter (where active_allocated_quantity>0) as all_actual,
    bool_and(cost_coverage='estimated') filter (where active_allocated_quantity>0) as all_estimated
  from item_scope
  group by sales_order_id
), direct_cost as (
  select
    sales_order_id,
    count(*)::integer as direct_cost_currency_count,
    min(currency) as single_direct_cost_currency,
    sum(charge_count)::integer as direct_cost_charge_count,
    case when count(*)=1 then sum(direct_cost_amount) else null end::numeric as direct_cost_amount
  from public.sales_order_direct_costs
  group by sales_order_id
), base as (
  select
    so.id as sales_order_id,
    so.so_number,
    so.status as sales_order_status,
    so.client_id,
    so.importer_id,
    so.currency as sales_currency,
    coalesce(a.item_count,0)::integer as item_count,
    coalesce(a.active_item_count,0)::integer as active_item_count,
    coalesce(a.order_total,0)::numeric as order_total,
    coalesce(a.attributed_sales_revenue,0)::numeric as attributed_sales_revenue,
    greatest(coalesce(a.order_total,0)-coalesce(a.attributed_sales_revenue,0),0)::numeric as unattributed_order_value,
    coalesce(a.costed_active_item_count,0)::integer as costed_active_item_count,
    coalesce(a.source_currency_count,0)::integer as source_currency_count,
    case when coalesce(a.active_item_count,0)>0 and a.known_currency_active_item_count=a.active_item_count and a.source_currency_count=1 then a.single_cogs_currency else null end as cogs_currency,
    case when coalesce(a.active_item_count,0)>0 and a.costed_active_item_count=a.active_item_count and a.known_currency_active_item_count=a.active_item_count and a.source_currency_count=1 and coalesce(a.has_incomplete_cost,false) is false then a.cost_candidate else null end::numeric as recognized_merchandise_cogs,
    case
      when coalesce(a.active_item_count,0)=0 then 'incomplete_allocation'
      when a.costed_active_item_count<>a.active_item_count then 'incomplete_allocation'
      when a.known_currency_active_item_count<>a.active_item_count then 'incomplete_allocation'
      when a.source_currency_count<>1 then 'incomplete_allocation'
      when coalesce(a.has_incomplete_cost,false) then 'incomplete_allocation'
      when coalesce(a.all_actual,false) then 'actual'
      when coalesce(a.all_estimated,false) then 'estimated'
      else 'partial_actual'
    end as merchandise_cost_coverage,
    coalesce(dc.direct_cost_currency_count,0)::integer as direct_cost_currency_count,
    case when dc.direct_cost_currency_count=1 then dc.single_direct_cost_currency else null end as direct_cost_currency,
    coalesce(dc.direct_cost_charge_count,0)::integer as direct_cost_charge_count,
    case when coalesce(dc.direct_cost_currency_count,0)=0 then 0 when dc.direct_cost_currency_count=1 then dc.direct_cost_amount else null end::numeric as direct_cost_amount
  from public.sales_orders so
  left join aggregated a on a.sales_order_id=so.id
  left join direct_cost dc on dc.sales_order_id=so.id
), gross as (
  select
    b.*,
    ((recognized_merchandise_cogs is not null) and (cogs_currency=sales_currency)) as currency_comparable,
    case when recognized_merchandise_cogs is not null and cogs_currency=sales_currency then attributed_sales_revenue-recognized_merchandise_cogs else null end::numeric as gross_margin,
    case when recognized_merchandise_cogs is not null and cogs_currency=sales_currency and attributed_sales_revenue<>0 then ((attributed_sales_revenue-recognized_merchandise_cogs)/attributed_sales_revenue)*100 else null end::numeric as gross_margin_pct,
    case
      when active_item_count=0 then 'no_fulfillment'
      when recognized_merchandise_cogs is null then 'incomplete_cogs'
      when cogs_currency<>sales_currency then 'currency_mismatch'
      else 'comparable'
    end as profitability_status
  from base b
)
select
  sales_order_id,
  so_number,
  sales_order_status,
  client_id,
  importer_id,
  sales_currency,
  item_count,
  active_item_count,
  order_total,
  attributed_sales_revenue,
  unattributed_order_value,
  costed_active_item_count,
  source_currency_count,
  cogs_currency,
  recognized_merchandise_cogs,
  merchandise_cost_coverage,
  currency_comparable,
  gross_margin,
  gross_margin_pct,
  profitability_status,
  direct_cost_currency_count,
  direct_cost_currency,
  direct_cost_charge_count,
  direct_cost_amount,
  (currency_comparable and (direct_cost_currency_count=0 or (direct_cost_currency_count=1 and direct_cost_currency=sales_currency))) as contribution_currency_comparable,
  case
    when currency_comparable and (direct_cost_currency_count=0 or (direct_cost_currency_count=1 and direct_cost_currency=sales_currency))
      then gross_margin-coalesce(direct_cost_amount,0)
    else null
  end::numeric as contribution_margin,
  case
    when currency_comparable and (direct_cost_currency_count=0 or (direct_cost_currency_count=1 and direct_cost_currency=sales_currency)) and attributed_sales_revenue<>0
      then ((gross_margin-coalesce(direct_cost_amount,0))/attributed_sales_revenue)*100
    else null
  end::numeric as contribution_margin_pct,
  case
    when profitability_status<>'comparable' then profitability_status
    when direct_cost_currency_count>1 then 'direct_cost_multi_currency'
    when direct_cost_currency_count=1 and direct_cost_currency<>sales_currency then 'direct_cost_currency_mismatch'
    else 'comparable'
  end as contribution_status
from gross;

revoke all on table public.sales_order_direct_costs from anon, authenticated;
grant select on table public.sales_order_direct_costs to service_role;

revoke all on function public.populate_cost_charge_allocations(uuid,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function public.create_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid) from public, anon, authenticated, service_role;
revoke all on function public.replace_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) from public, anon, authenticated, service_role;
grant execute on function public.create_cost_charge(text,text,numeric,text,date,uuid,text,text,jsonb,uuid) to service_role;
grant execute on function public.replace_cost_charge(uuid,text,text,numeric,text,date,uuid,text,text,jsonb,uuid) to service_role;

comment on column public.cost_charge_allocations.sales_order_id is 'Objetivo explícito de gasto directo para toda una Sales Order. No implica prorrateo automático.';
comment on column public.cost_charge_allocations.sales_order_item_id is 'Objetivo explícito de gasto directo para una línea/producto de Sales Order. No implica prorrateo automático.';
comment on view public.sales_order_direct_costs is 'Gastos posted explícitamente asignados a una Sales Order o a sus líneas. No hereda costos de Cargue/Shipment/Operación y no hace FX.';
comment on view public.sales_order_profitability is 'Margen bruto de mercancía más margen de contribución después de gastos directos explícitos de venta; sin FX ni prorrateos automáticos.';
