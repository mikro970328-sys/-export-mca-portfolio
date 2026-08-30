-- P13 · B8.5 release validation fixture.
-- This file MUST remain reversible: no COMMIT, always ROLLBACK.

begin;

-- Deterministic identifiers make residue checks reproducible.
do $$
begin
  if exists(select 1 from public.suppliers where id='13b80000-0000-4000-8000-000000000001'::uuid or name='__P13_B8_SUPPLIER__') then
    raise exception 'P13_FIXTURE_PREEXISTS:supplier';
  end if;
  if exists(select 1 from public.warehouses where id='13b80000-0000-4000-8000-000000000002'::uuid or code='P13B8') then
    raise exception 'P13_FIXTURE_PREEXISTS:warehouse';
  end if;
  if exists(select 1 from public.products where id='13b80000-0000-4000-8000-000000000003'::uuid or sku='P13-B8-FIXTURE') then
    raise exception 'P13_FIXTURE_PREEXISTS:product';
  end if;
  if exists(select 1 from public.purchase_orders where id in (
    '13b80000-0000-4000-8000-000000000004'::uuid,
    '13b80000-0000-4000-8000-000000000006'::uuid
  ) or po_number in ('P13-B8-EUR','P13-B8-GBP')) then
    raise exception 'P13_FIXTURE_PREEXISTS:purchase_order';
  end if;
end $$;

insert into public.suppliers(id,name,legal_name,country,notes)
values(
  '13b80000-0000-4000-8000-000000000001'::uuid,
  '__P13_B8_SUPPLIER__',
  '__P13_B8_SUPPLIER_LEGAL__',
  'US',
  'Reversible P13 B8.5 fixture'
);

insert into public.warehouses(id,code,name,country,city,notes)
values(
  '13b80000-0000-4000-8000-000000000002'::uuid,
  'P13B8',
  '__P13_B8_WAREHOUSE__',
  'US',
  'Miami',
  'Reversible P13 B8.5 fixture'
);

insert into public.products(id,sku,name,unit,currency,notes)
values(
  '13b80000-0000-4000-8000-000000000003'::uuid,
  'P13-B8-FIXTURE',
  '__P13_B8_PRODUCT__',
  'unit',
  'USD',
  'Reversible P13 B8.5 fixture'
);

insert into public.purchase_orders(
  id,po_number,supplier_id,warehouse_id,order_date,currency,status,notes
) values
(
  '13b80000-0000-4000-8000-000000000004'::uuid,
  'P13-B8-EUR',
  '13b80000-0000-4000-8000-000000000001'::uuid,
  '13b80000-0000-4000-8000-000000000002'::uuid,
  current_date-2,
  'EUR',
  'confirmed',
  'Reversible P13 B8.5 EUR fixture'
),
(
  '13b80000-0000-4000-8000-000000000006'::uuid,
  'P13-B8-GBP',
  '13b80000-0000-4000-8000-000000000001'::uuid,
  '13b80000-0000-4000-8000-000000000002'::uuid,
  current_date-1,
  'GBP',
  'confirmed',
  'Reversible P13 B8.5 GBP fixture'
);

insert into public.purchase_order_items(
  id,purchase_order_id,product_id,ordered_quantity,ordered_pallets,unit,unit_cost,currency,notes
) values
(
  '13b80000-0000-4000-8000-000000000005'::uuid,
  '13b80000-0000-4000-8000-000000000004'::uuid,
  '13b80000-0000-4000-8000-000000000003'::uuid,
  10,0,'unit',12.50,'EUR','P13 EUR line = 125.00'
),
(
  '13b80000-0000-4000-8000-000000000007'::uuid,
  '13b80000-0000-4000-8000-000000000006'::uuid,
  '13b80000-0000-4000-8000-000000000003'::uuid,
  4,0,'unit',20.00,'GBP','P13 GBP line = 80.00'
);

-- Source read-model must expose exactly the two fixture POs with their own currencies.
do $$
declare
  v_count integer;
  v_eur numeric;
  v_gbp numeric;
begin
  select count(*)::integer,
         max(order_total) filter(where currency='EUR'),
         max(order_total) filter(where currency='GBP')
    into v_count,v_eur,v_gbp
  from public.executive_purchase_order_kpi_source
  where supplier_id='13b80000-0000-4000-8000-000000000001'::uuid;

  if v_count<>2 then raise exception 'P13_SOURCE_ROW_COUNT:%',v_count; end if;
  if v_eur<>125 then raise exception 'P13_SOURCE_EUR_TOTAL:%',v_eur; end if;
  if v_gbp<>80 then raise exception 'P13_SOURCE_GBP_TOTAL:%',v_gbp; end if;
end $$;

-- Dashboard must keep EUR and GBP in independent activity rows; no synthetic combined currency.
do $$
declare
  v_rollup jsonb;
  v_activity jsonb;
  v_eur numeric;
  v_gbp numeric;
begin
  v_rollup:=public.executive_dashboard_rollup(
    null,null,null,null,
    '13b80000-0000-4000-8000-000000000001'::uuid,
    null
  );
  v_activity:=v_rollup->'activity_by_currency';

  if jsonb_array_length(v_activity)<>2 then
    raise exception 'P13_DASHBOARD_CURRENCY_ROW_COUNT:%',jsonb_array_length(v_activity);
  end if;

  select (x->>'po_committed_value')::numeric into v_eur
  from jsonb_array_elements(v_activity) x where x->>'currency'='EUR';
  select (x->>'po_committed_value')::numeric into v_gbp
  from jsonb_array_elements(v_activity) x where x->>'currency'='GBP';

  if v_eur<>125 then raise exception 'P13_DASHBOARD_EUR_TOTAL:%',v_eur; end if;
  if v_gbp<>80 then raise exception 'P13_DASHBOARD_GBP_TOTAL:%',v_gbp; end if;
  if exists(select 1 from jsonb_array_elements(v_activity) x where x->>'currency' not in ('EUR','GBP')) then
    raise exception 'P13_DASHBOARD_UNEXPECTED_CURRENCY';
  end if;
end $$;

-- Report dataset must expose the exact same two source rows and preserve no-FX semantics.
do $$
declare
  v_report jsonb;
  v_rows jsonb;
  v_eur numeric;
  v_gbp numeric;
begin
  v_report:=public.executive_report_dataset(
    'purchases',null,null,null,null,
    '13b80000-0000-4000-8000-000000000001'::uuid,
    null,100
  );
  v_rows:=v_report->'rows';

  if v_report->>'currency_policy'<>'separate_no_fx' then
    raise exception 'P13_REPORT_CURRENCY_POLICY:%',v_report->>'currency_policy';
  end if;
  if (v_report->>'row_count')::integer<>2 then
    raise exception 'P13_REPORT_ROW_COUNT:%',v_report->>'row_count';
  end if;

  select (x->>'order_total')::numeric into v_eur
  from jsonb_array_elements(v_rows) x where x->>'currency'='EUR';
  select (x->>'order_total')::numeric into v_gbp
  from jsonb_array_elements(v_rows) x where x->>'currency'='GBP';

  if v_eur<>125 then raise exception 'P13_REPORT_EUR_TOTAL:%',v_eur; end if;
  if v_gbp<>80 then raise exception 'P13_REPORT_GBP_TOTAL:%',v_gbp; end if;
end $$;

-- Currency filter must isolate EUR in both Dashboard and Reportes.
do $$
declare
  v_rollup jsonb;
  v_report jsonb;
begin
  v_rollup:=public.executive_dashboard_rollup(
    null,null,'EUR',null,
    '13b80000-0000-4000-8000-000000000001'::uuid,
    null
  );
  if jsonb_array_length(v_rollup->'activity_by_currency')<>1
     or v_rollup->'activity_by_currency'->0->>'currency'<>'EUR'
     or (v_rollup->'activity_by_currency'->0->>'po_committed_value')::numeric<>125 then
    raise exception 'P13_DASHBOARD_EUR_FILTER_FAILED:%',v_rollup->'activity_by_currency';
  end if;

  v_report:=public.executive_report_dataset(
    'purchases',null,null,'EUR',null,
    '13b80000-0000-4000-8000-000000000001'::uuid,
    null,100
  );
  if (v_report->>'row_count')::integer<>1
     or v_report->'rows'->0->>'currency'<>'EUR'
     or (v_report->'rows'->0->>'order_total')::numeric<>125 then
    raise exception 'P13_REPORT_EUR_FILTER_FAILED:%',v_report->'rows';
  end if;
end $$;

-- Period filter must include only the GBP PO dated current_date-1.
do $$
declare
  v_rollup jsonb;
  v_report jsonb;
begin
  v_rollup:=public.executive_dashboard_rollup(
    current_date-1,current_date,null,null,
    '13b80000-0000-4000-8000-000000000001'::uuid,
    null
  );
  if jsonb_array_length(v_rollup->'activity_by_currency')<>1
     or v_rollup->'activity_by_currency'->0->>'currency'<>'GBP'
     or (v_rollup->'activity_by_currency'->0->>'po_committed_value')::numeric<>80 then
    raise exception 'P13_DASHBOARD_PERIOD_FILTER_FAILED:%',v_rollup->'activity_by_currency';
  end if;

  v_report:=public.executive_report_dataset(
    'purchases',current_date-1,current_date,null,null,
    '13b80000-0000-4000-8000-000000000001'::uuid,
    null,100
  );
  if (v_report->>'row_count')::integer<>1
     or v_report->'rows'->0->>'currency'<>'GBP'
     or (v_report->'rows'->0->>'order_total')::numeric<>80 then
    raise exception 'P13_REPORT_PERIOD_FILTER_FAILED:%',v_report->'rows';
  end if;
end $$;

rollback;

-- Must return all zeros after rollback. This is the final result of the test file.
select
  (select count(*) from public.suppliers where id='13b80000-0000-4000-8000-000000000001'::uuid or name='__P13_B8_SUPPLIER__') as supplier_fixture_residue,
  (select count(*) from public.warehouses where id='13b80000-0000-4000-8000-000000000002'::uuid or code='P13B8') as warehouse_fixture_residue,
  (select count(*) from public.products where id='13b80000-0000-4000-8000-000000000003'::uuid or sku='P13-B8-FIXTURE') as product_fixture_residue,
  (select count(*) from public.purchase_orders where id in ('13b80000-0000-4000-8000-000000000004'::uuid,'13b80000-0000-4000-8000-000000000006'::uuid) or po_number in ('P13-B8-EUR','P13-B8-GBP')) as purchase_order_fixture_residue,
  (select count(*) from public.purchase_order_items where id in ('13b80000-0000-4000-8000-000000000005'::uuid,'13b80000-0000-4000-8000-000000000007'::uuid)) as purchase_order_item_fixture_residue;