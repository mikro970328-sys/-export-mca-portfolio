-- P5 · Reglas backend-authoritative de handoff y triggers de reconciliación.

create or replace view public.workflow_sales_order_handoff_state
with (security_invoker=true)
as
with purchase_plan as (
  select soi.sales_order_id,
    coalesce(sum(spl.planned_quantity) filter (where spl.supply_method in ('purchase_warehouse','purchase_direct')),0) as purchase_planned_quantity,
    coalesce(sum(spl.planned_pallets) filter (where spl.supply_method in ('purchase_warehouse','purchase_direct')),0) as purchase_planned_pallets,
    coalesce(sum(spl.planned_quantity) filter (where spl.supply_method='purchase_direct'),0) as direct_planned_quantity,
    coalesce(sum(spl.planned_pallets) filter (where spl.supply_method='purchase_direct'),0) as direct_planned_pallets,
    coalesce(sum(spl.planned_quantity) filter (where spl.supply_method<>'purchase_direct'),0) as non_direct_planned_quantity,
    coalesce(sum(spl.planned_pallets) filter (where spl.supply_method<>'purchase_direct'),0) as non_direct_planned_pallets
  from public.sales_order_items soi
  left join public.sales_supply_plan_lines spl on spl.sales_order_item_id=soi.id
  group by soi.sales_order_id
), procurement as (
  select soi.sales_order_id,
    coalesce(sum(spa.allocated_sales_quantity) filter (where spl.supply_method in ('purchase_warehouse','purchase_direct')),0) as purchase_linked_quantity,
    coalesce(sum(spa.allocated_sales_pallets) filter (where spl.supply_method in ('purchase_warehouse','purchase_direct')),0) as purchase_linked_pallets,
    coalesce(sum(spa.allocated_sales_quantity) filter (where spl.supply_method='purchase_direct'),0) as direct_linked_quantity,
    coalesce(sum(spa.allocated_sales_pallets) filter (where spl.supply_method='purchase_direct'),0) as direct_linked_pallets
  from public.sales_procurement_allocations spa
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  group by soi.sales_order_id
), direct_state as (
  select soi.sales_order_id,
    coalesce(sum(dsa.allocated_sales_quantity),0) as direct_container_allocated_quantity,
    coalesce(sum(dsa.allocated_sales_pallets),0) as direct_container_allocated_pallets,
    coalesce(sum(dsa.allocated_sales_quantity) filter (where dsd.shipment_id is not null),0) as direct_dispatched_quantity,
    coalesce(sum(dsa.allocated_sales_pallets) filter (where dsd.shipment_id is not null),0) as direct_dispatched_pallets
  from public.direct_shipment_allocations dsa
  join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id
  join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  left join public.direct_shipment_dispatches dsd on dsd.shipment_id=dsa.shipment_id
  group by soi.sales_order_id
), load_dispatch as (
  select soi.sales_order_id,
    coalesce(sum(sfa.allocated_quantity) filter (where l.status='dispatched'),0) as load_dispatched_quantity,
    coalesce(sum(sfa.allocated_pallets) filter (where l.status='dispatched'),0) as load_dispatched_pallets
  from public.sales_fulfillment_allocations sfa
  join public.sales_order_items soi on soi.id=sfa.sales_order_item_id
  join public.load_items li on li.id=sfa.load_item_id
  join public.loads l on l.id=li.load_id
  group by soi.sales_order_id
), non_direct_plan_eval as (
  select spl.id as plan_id,soi.sales_order_id,
    case
      when spl.supply_method='inventory' then
        coalesce((select sum(i.available_quantity) from public.inventory_summary i where i.warehouse_id=spl.warehouse_id and i.product_id=soi.product_id),0) >= spl.planned_quantity
        and (spl.planned_pallets=0 or coalesce((select sum(i.available_pallets) from public.inventory_summary i where i.warehouse_id=spl.warehouse_id and i.product_id=soi.product_id),0) >= spl.planned_pallets)
      when spl.supply_method='purchase_warehouse' then
        coalesce((select sum(spa.allocated_sales_quantity) from public.sales_procurement_allocations spa where spa.supply_plan_line_id=spl.id),0) >= spl.planned_quantity
        and (spl.planned_pallets=0 or coalesce((select sum(spa.allocated_sales_pallets) from public.sales_procurement_allocations spa where spa.supply_plan_line_id=spl.id),0) >= spl.planned_pallets)
        and exists(select 1 from public.sales_procurement_allocations spa where spa.supply_plan_line_id=spl.id)
        and not exists(
          select 1 from public.sales_procurement_allocations spa
          join public.purchase_order_items poi on poi.id=spa.purchase_order_item_id
          left join public.purchase_order_item_progress pip on pip.purchase_order_item_id=poi.id
          where spa.supply_plan_line_id=spl.id and coalesce(pip.receipt_status,'pending')<>'received'
        )
      else false
    end as is_ready
  from public.sales_supply_plan_lines spl
  join public.sales_order_items soi on soi.id=spl.sales_order_item_id
  where spl.supply_method<>'purchase_direct'
), non_direct_ready as (
  select sales_order_id,count(*)::integer as non_direct_plan_count,count(*) filter (where is_ready)::integer as non_direct_ready_count
  from non_direct_plan_eval group by sales_order_id
)
select
  sop.sales_order_id,
  sop.so_number,
  sop.commercial_status,
  sop.fulfillment_status,
  sop.item_count,
  sop.fully_dispatched_items,
  coalesce(sosp.supply_plan_status,'empty') as supply_plan_status,
  coalesce(sosp.unplanned_items,0) as unplanned_items,
  coalesce(sosp.partially_planned_items,0) as partially_planned_items,
  coalesce(pp.purchase_planned_quantity,0) as purchase_planned_quantity,
  coalesce(pp.purchase_planned_pallets,0) as purchase_planned_pallets,
  coalesce(pr.purchase_linked_quantity,0) as purchase_linked_quantity,
  coalesce(pr.purchase_linked_pallets,0) as purchase_linked_pallets,
  coalesce(pp.direct_planned_quantity,0) as direct_planned_quantity,
  coalesce(pp.direct_planned_pallets,0) as direct_planned_pallets,
  coalesce(pr.direct_linked_quantity,0) as direct_linked_quantity,
  coalesce(pr.direct_linked_pallets,0) as direct_linked_pallets,
  coalesce(ds.direct_container_allocated_quantity,0) as direct_container_allocated_quantity,
  coalesce(ds.direct_container_allocated_pallets,0) as direct_container_allocated_pallets,
  coalesce(ds.direct_dispatched_quantity,0) as direct_dispatched_quantity,
  coalesce(ds.direct_dispatched_pallets,0) as direct_dispatched_pallets,
  coalesce(pp.non_direct_planned_quantity,0) as non_direct_planned_quantity,
  coalesce(pp.non_direct_planned_pallets,0) as non_direct_planned_pallets,
  coalesce(nr.non_direct_plan_count,0) as non_direct_plan_count,
  coalesce(nr.non_direct_ready_count,0) as non_direct_ready_count,
  coalesce(ld.load_dispatched_quantity,0) as load_dispatched_quantity,
  coalesce(ld.load_dispatched_pallets,0) as load_dispatched_pallets,
  coalesce(sip.fully_invoiced,false) as fully_invoiced,
  coalesce(sip.uninvoiced_total,0) as uninvoiced_total
from public.sales_order_progress sop
left join public.sales_order_supply_progress sosp using(sales_order_id)
left join purchase_plan pp using(sales_order_id)
left join procurement pr using(sales_order_id)
left join direct_state ds using(sales_order_id)
left join non_direct_ready nr using(sales_order_id)
left join load_dispatch ld using(sales_order_id)
left join public.sales_order_invoice_progress sip using(sales_order_id);

revoke all on public.workflow_sales_order_handoff_state from public,anon,authenticated;
grant select on public.workflow_sales_order_handoff_state to service_role;

create or replace function public.reconcile_sales_order_workflow_tasks(p_sales_order_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.workflow_sales_order_handoff_state%rowtype;
  v_cancel boolean;
  v_prepare_existing boolean;
  v_supply_open boolean;
  v_proc_open boolean;
  v_direct_open boolean;
  v_prepare_open boolean;
  v_invoice_open boolean;
begin
  select * into v from public.workflow_sales_order_handoff_state where sales_order_id=p_sales_order_id;
  if not found then return; end if;
  v_cancel := v.commercial_status='cancelled';

  v_supply_open := v.commercial_status='confirmed' and v.fully_dispatched_items<v.item_count and v.supply_plan_status in ('unplanned','partial');
  perform public.sync_workflow_task(
    'sales_supply_planning','sales_order',v.sales_order_id,v_supply_open,
    'Planificar abastecimiento · '||coalesce(v.so_number,'Venta'),
    'Estado del plan: '||v.supply_plan_status||' · sin planificar: '||v.unplanned_items||' · parcial: '||v.partially_planned_items,
    'supply:'||v.commercial_status||':'||v.fulfillment_status||':'||v.supply_plan_status,
    null,case when v_cancel then 'cancel' else 'complete' end
  );

  v_proc_open := v.commercial_status='confirmed' and v.fully_dispatched_items<v.item_count and v.purchase_planned_quantity>v.purchase_linked_quantity;
  perform public.sync_workflow_task(
    'sales_procurement_linkage','sales_order',v.sales_order_id,v_proc_open,
    'Vincular compra · '||coalesce(v.so_number,'Venta'),
    'Planificado por compra: '||v.purchase_planned_quantity||' · vinculado explícitamente a PO: '||v.purchase_linked_quantity,
    'procurement:'||v.purchase_planned_quantity||':'||v.purchase_linked_quantity,
    null,case when v_cancel then 'cancel' else 'complete' end
  );

  v_direct_open := v.commercial_status='confirmed'
    and v.direct_planned_quantity>0
    and v.direct_linked_quantity>=v.direct_planned_quantity
    and v.direct_dispatched_quantity<v.direct_planned_quantity;
  perform public.sync_workflow_task(
    'direct_fulfillment','sales_order',v.sales_order_id,v_direct_open,
    'Coordinar Direct Ship · '||coalesce(v.so_number,'Venta'),
    case when v.direct_container_allocated_quantity<v.direct_planned_quantity
      then 'Compra directa vinculada. Falta asignar contenedor a '||(v.direct_planned_quantity-v.direct_container_allocated_quantity)||' unidades de venta.'
      else 'Contenedor asignado. Falta despachar '||(v.direct_planned_quantity-v.direct_dispatched_quantity)||' unidades de venta.' end,
    'direct:'||v.direct_planned_quantity||':'||v.direct_container_allocated_quantity||':'||v.direct_dispatched_quantity,
    null,case when v_cancel then 'cancel' else 'complete' end
  );

  select exists(
    select 1 from public.operational_tasks
    where dedupe_key='workflow:prepare_load:sales_order:'||p_sales_order_id::text and status in ('pending','in_progress','blocked')
  ) into v_prepare_existing;
  v_prepare_open := v.commercial_status='confirmed'
    and v.non_direct_planned_quantity>v.load_dispatched_quantity
    and v.non_direct_plan_count>0
    and ((v.non_direct_ready_count=v.non_direct_plan_count) or v_prepare_existing);
  perform public.sync_workflow_task(
    'prepare_load','sales_order',v.sales_order_id,v_prepare_open,
    'Preparar Cargue · '||coalesce(v.so_number,'Venta'),
    'Mercancía no-directa lista/gestionada. Pendiente de despachar por Cargue: '||greatest(v.non_direct_planned_quantity-v.load_dispatched_quantity,0),
    'load:'||v.non_direct_planned_quantity||':'||v.non_direct_ready_count||':'||v.non_direct_plan_count||':'||v.load_dispatched_quantity,
    null,case when v_cancel then 'cancel' else 'complete' end
  );

  v_invoice_open := v.commercial_status in ('confirmed','closed') and v.fulfillment_status='dispatched' and not v.fully_invoiced and v.uninvoiced_total>0;
  perform public.sync_workflow_task(
    'sales_invoice','sales_order',v.sales_order_id,v_invoice_open,
    'Emitir factura · '||coalesce(v.so_number,'Venta'),
    'Venta totalmente despachada. Importe pendiente de facturar: '||v.uninvoiced_total,
    'invoice:'||v.fulfillment_status||':'||v.fully_invoiced||':'||v.uninvoiced_total,
    null,case when v_cancel then 'cancel' else 'complete' end
  );
end;
$$;

create or replace function public.reconcile_purchase_order_workflow_tasks(p_purchase_order_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v record;
  v_open boolean;
  v_due timestamptz;
begin
  select p.*,po.expected_at into v
  from public.purchase_order_progress p join public.purchase_orders po on po.id=p.purchase_order_id
  where p.purchase_order_id=p_purchase_order_id;
  if not found then return; end if;
  v_open := v.commercial_status='confirmed' and v.warehouse_id is not null and v.receipt_status<>'received';
  v_due := v.expected_at;
  perform public.sync_workflow_task(
    'purchase_receipt','purchase_order',v.purchase_order_id,v_open,
    'Recibir compra · '||coalesce(v.po_number,'PO'),
    'Recepción: '||v.receipt_status||' · pendientes: '||v.pending_items||' · parciales: '||v.partial_items||' · recibidos: '||v.received_items,
    'receipt:'||v.commercial_status||':'||v.receipt_status,
    v_due,case when v.commercial_status='cancelled' then 'cancel' else 'complete' end
  );
end;
$$;

create or replace function public.reconcile_shipment_workflow_tasks(p_shipment_id uuid,p_allow_inactive boolean default true)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.shipment_customs_document_readiness%rowtype;
  v_open boolean;
begin
  select * into v from public.shipment_customs_document_readiness where shipment_id=p_shipment_id;
  if not found then return; end if;
  v_open := v.documentation_required and v.document_status='pending' and (p_allow_inactive or v.active);
  perform public.sync_workflow_task(
    'shipment_cuba_documents','shipment',v.shipment_id,v_open,
    'Completar documentos Cuba · '||v.container_number,
    case when array_length(v.missing_documents,1)>0 then 'Faltan: '||array_to_string(v.missing_documents,', ') else 'Documentación Cuba completa.' end,
    'docs:'||v.document_status||':'||array_to_string(v.missing_documents,','),
    null,'complete'
  );
end;
$$;

create or replace function public.reconcile_invoice_workflow_tasks(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.invoice_financial_progress%rowtype;
  v_open boolean;
  v_due timestamptz;
begin
  select * into v from public.invoice_financial_progress where invoice_id=p_invoice_id;
  if not found then return; end if;
  v_open := v.invoice_status='issued' and v.balance_due>0;
  v_due := case when v.due_date is not null then (v.due_date::timestamp + time '17:00') at time zone 'America/New_York' end;
  perform public.sync_workflow_task(
    'invoice_collection','invoice',v.invoice_id,v_open,
    'Cobrar saldo · '||coalesce(v.invoice_number,'Factura'),
    'Saldo pendiente: '||v.balance_due||' '||v.currency||' · estado de pago: '||v.payment_status,
    'collection:'||v.invoice_status||':'||v.payment_status||':'||v.balance_due,
    v_due,case when v.invoice_status='void' then 'cancel' else 'complete' end
  );
end;
$$;

create or replace function public.reconcile_supplier_bill_workflow_tasks(p_supplier_bill_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.supplier_bill_financial_progress%rowtype;
  v_open boolean;
  v_due timestamptz;
begin
  select * into v from public.supplier_bill_financial_progress where supplier_bill_id=p_supplier_bill_id;
  if not found then return; end if;
  v_open := v.status='posted' and v.balance_due>0;
  v_due := case when v.due_date is not null then (v.due_date::timestamp + time '17:00') at time zone 'America/New_York' end;
  perform public.sync_workflow_task(
    'supplier_bill_payment','supplier_bill',v.supplier_bill_id,v_open,
    'Pagar factura proveedor · '||coalesce(v.bill_number,v.supplier_invoice_number,'Factura proveedor'),
    'Saldo pendiente: '||v.balance_due||' '||v.currency||' · estado: '||v.payment_status,
    'supplier-payment:'||v.status||':'||v.payment_status||':'||v.balance_due,
    v_due,case when v.status='void' then 'cancel' else 'complete' end
  );
end;
$$;

-- Trigger helpers. They only identify the affected aggregate and delegate to the central reconciler.
create or replace function public.workflow_reconcile_sales_order_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_sales_order_workflow_tasks(coalesce(new.id,old.id)); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_sales_plan_row() returns trigger language plpgsql set search_path=public as $$ declare v_so uuid; begin select soi.sales_order_id into v_so from public.sales_order_items soi where soi.id=coalesce(new.sales_order_item_id,old.sales_order_item_id); if v_so is not null then perform public.reconcile_sales_order_workflow_tasks(v_so); end if; return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_procurement_row() returns trigger language plpgsql set search_path=public as $$ declare v_so uuid; begin select soi.sales_order_id into v_so from public.sales_supply_plan_lines spl join public.sales_order_items soi on soi.id=spl.sales_order_item_id where spl.id=coalesce(new.supply_plan_line_id,old.supply_plan_line_id); if v_so is not null then perform public.reconcile_sales_order_workflow_tasks(v_so); end if; return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_fulfillment_row() returns trigger language plpgsql set search_path=public as $$ declare v_so uuid; begin select sales_order_id into v_so from public.sales_order_items where id=coalesce(new.sales_order_item_id,old.sales_order_item_id); if v_so is not null then perform public.reconcile_sales_order_workflow_tasks(v_so); end if; return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_direct_allocation_row() returns trigger language plpgsql set search_path=public as $$ declare v_so uuid; begin select soi.sales_order_id into v_so from public.sales_procurement_allocations spa join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id join public.sales_order_items soi on soi.id=spl.sales_order_item_id where spa.id=coalesce(new.sales_procurement_allocation_id,old.sales_procurement_allocation_id); if v_so is not null then perform public.reconcile_sales_order_workflow_tasks(v_so); end if; return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_direct_dispatch_row() returns trigger language plpgsql set search_path=public as $$ declare r record; v_shipment uuid:=coalesce(new.shipment_id,old.shipment_id); begin for r in select distinct soi.sales_order_id from public.direct_shipment_allocations dsa join public.sales_procurement_allocations spa on spa.id=dsa.sales_procurement_allocation_id join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id join public.sales_order_items soi on soi.id=spl.sales_order_item_id where dsa.shipment_id=v_shipment loop perform public.reconcile_sales_order_workflow_tasks(r.sales_order_id); end loop; perform public.reconcile_shipment_workflow_tasks(v_shipment,true); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_load_row() returns trigger language plpgsql set search_path=public as $$ declare r record; begin for r in select distinct soi.sales_order_id from public.load_items li join public.sales_fulfillment_allocations sfa on sfa.load_item_id=li.id join public.sales_order_items soi on soi.id=sfa.sales_order_item_id where li.load_id=coalesce(new.id,old.id) loop perform public.reconcile_sales_order_workflow_tasks(r.sales_order_id); end loop; if new.shipment_id is not null then perform public.reconcile_shipment_workflow_tasks(new.shipment_id,true); end if; if tg_op='UPDATE' and old.shipment_id is not null and old.shipment_id is distinct from new.shipment_id then perform public.reconcile_shipment_workflow_tasks(old.shipment_id,true); end if; return new; end; $$;
create or replace function public.workflow_reconcile_purchase_order_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_purchase_order_workflow_tasks(coalesce(new.id,old.id)); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_purchase_receipt_allocation_row() returns trigger language plpgsql set search_path=public as $$ declare v_poi uuid:=coalesce(new.purchase_order_item_id,old.purchase_order_item_id); v_po uuid; r record; begin select purchase_order_id into v_po from public.purchase_order_items where id=v_poi; if v_po is not null then perform public.reconcile_purchase_order_workflow_tasks(v_po); end if; for r in select distinct soi.sales_order_id from public.sales_procurement_allocations spa join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id join public.sales_order_items soi on soi.id=spl.sales_order_item_id where spa.purchase_order_item_id=v_poi loop perform public.reconcile_sales_order_workflow_tasks(r.sales_order_id); end loop; return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_warehouse_receipt_row() returns trigger language plpgsql set search_path=public as $$ declare r record; begin for r in select distinct poi.purchase_order_id,soi.sales_order_id from public.warehouse_receipt_items wri join public.purchase_receipt_allocations pra on pra.receipt_item_id=wri.id join public.purchase_order_items poi on poi.id=pra.purchase_order_item_id left join public.sales_procurement_allocations spa on spa.purchase_order_item_id=poi.id left join public.sales_supply_plan_lines spl on spl.id=spa.supply_plan_line_id left join public.sales_order_items soi on soi.id=spl.sales_order_item_id where wri.receipt_id=coalesce(new.id,old.id) loop perform public.reconcile_purchase_order_workflow_tasks(r.purchase_order_id); if r.sales_order_id is not null then perform public.reconcile_sales_order_workflow_tasks(r.sales_order_id); end if; end loop; return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_shipment_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_shipment_workflow_tasks(coalesce(new.id,old.id),true); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_document_row() returns trigger language plpgsql set search_path=public as $$ begin if new.shipment_id is not null then perform public.reconcile_shipment_workflow_tasks(new.shipment_id,true); end if; if tg_op='DELETE' and old.shipment_id is not null then perform public.reconcile_shipment_workflow_tasks(old.shipment_id,true); elsif tg_op='UPDATE' and old.shipment_id is not null and old.shipment_id is distinct from new.shipment_id then perform public.reconcile_shipment_workflow_tasks(old.shipment_id,true); end if; return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_invoice_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_sales_order_workflow_tasks(coalesce(new.sales_order_id,old.sales_order_id)); perform public.reconcile_invoice_workflow_tasks(coalesce(new.id,old.id)); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_invoice_item_row() returns trigger language plpgsql set search_path=public as $$ declare v_invoice uuid:=coalesce(new.invoice_id,old.invoice_id); v_so uuid; begin select sales_order_id into v_so from public.invoices where id=v_invoice; if v_so is not null then perform public.reconcile_sales_order_workflow_tasks(v_so); end if; perform public.reconcile_invoice_workflow_tasks(v_invoice); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_payment_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_invoice_workflow_tasks(coalesce(new.invoice_id,old.invoice_id)); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_advance_application_row() returns trigger language plpgsql set search_path=public as $$ declare v_invoice uuid:=coalesce(new.invoice_id,old.invoice_id); begin perform public.reconcile_invoice_workflow_tasks(v_invoice); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_supplier_bill_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_supplier_bill_workflow_tasks(coalesce(new.id,old.id)); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_supplier_bill_item_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_supplier_bill_workflow_tasks(coalesce(new.supplier_bill_id,old.supplier_bill_id)); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_supplier_payment_application_row() returns trigger language plpgsql set search_path=public as $$ begin perform public.reconcile_supplier_bill_workflow_tasks(coalesce(new.supplier_bill_id,old.supplier_bill_id)); return coalesce(new,old); end; $$;
create or replace function public.workflow_reconcile_supplier_payment_row() returns trigger language plpgsql set search_path=public as $$ declare r record; begin for r in select distinct supplier_bill_id from public.supplier_payment_applications where supplier_payment_id=coalesce(new.id,old.id) loop perform public.reconcile_supplier_bill_workflow_tasks(r.supplier_bill_id); end loop; return coalesce(new,old); end; $$;

-- AFTER triggers: guards/validations remain owners of domain validity; P5 only reconciles resulting state.
drop trigger if exists workflow_sales_orders_reconcile on public.sales_orders;
create trigger workflow_sales_orders_reconcile after insert or update on public.sales_orders for each row execute function public.workflow_reconcile_sales_order_row();
drop trigger if exists workflow_sales_supply_plan_reconcile on public.sales_supply_plan_lines;
create trigger workflow_sales_supply_plan_reconcile after insert or update or delete on public.sales_supply_plan_lines for each row execute function public.workflow_reconcile_sales_plan_row();
drop trigger if exists workflow_sales_procurement_reconcile on public.sales_procurement_allocations;
create trigger workflow_sales_procurement_reconcile after insert or update or delete on public.sales_procurement_allocations for each row execute function public.workflow_reconcile_procurement_row();
drop trigger if exists workflow_sales_fulfillment_reconcile on public.sales_fulfillment_allocations;
create trigger workflow_sales_fulfillment_reconcile after insert or update or delete on public.sales_fulfillment_allocations for each row execute function public.workflow_reconcile_fulfillment_row();
drop trigger if exists workflow_direct_allocation_reconcile on public.direct_shipment_allocations;
create trigger workflow_direct_allocation_reconcile after insert or update or delete on public.direct_shipment_allocations for each row execute function public.workflow_reconcile_direct_allocation_row();
drop trigger if exists workflow_direct_dispatch_reconcile on public.direct_shipment_dispatches;
create trigger workflow_direct_dispatch_reconcile after insert or update or delete on public.direct_shipment_dispatches for each row execute function public.workflow_reconcile_direct_dispatch_row();
drop trigger if exists workflow_load_reconcile on public.loads;
create trigger workflow_load_reconcile after insert or update of status,shipment_id on public.loads for each row execute function public.workflow_reconcile_load_row();
drop trigger if exists workflow_purchase_order_reconcile on public.purchase_orders;
create trigger workflow_purchase_order_reconcile after insert or update on public.purchase_orders for each row execute function public.workflow_reconcile_purchase_order_row();
drop trigger if exists workflow_purchase_receipt_allocation_reconcile on public.purchase_receipt_allocations;
create trigger workflow_purchase_receipt_allocation_reconcile after insert or update or delete on public.purchase_receipt_allocations for each row execute function public.workflow_reconcile_purchase_receipt_allocation_row();
drop trigger if exists workflow_warehouse_receipt_reconcile on public.warehouse_receipts;
create trigger workflow_warehouse_receipt_reconcile after update of status on public.warehouse_receipts for each row execute function public.workflow_reconcile_warehouse_receipt_row();
drop trigger if exists workflow_shipment_reconcile on public.shipments;
create trigger workflow_shipment_reconcile after insert or update of active,departure_date,delivered_at,operational_status,last_status on public.shipments for each row execute function public.workflow_reconcile_shipment_row();
drop trigger if exists workflow_document_reconcile on public.documents;
create trigger workflow_document_reconcile after insert or update or delete on public.documents for each row execute function public.workflow_reconcile_document_row();
drop trigger if exists workflow_invoice_reconcile on public.invoices;
create trigger workflow_invoice_reconcile after insert or update on public.invoices for each row execute function public.workflow_reconcile_invoice_row();
drop trigger if exists workflow_invoice_item_reconcile on public.invoice_items;
create trigger workflow_invoice_item_reconcile after insert or update or delete on public.invoice_items for each row execute function public.workflow_reconcile_invoice_item_row();
drop trigger if exists workflow_payment_reconcile on public.payments;
create trigger workflow_payment_reconcile after insert or update or delete on public.payments for each row execute function public.workflow_reconcile_payment_row();
drop trigger if exists workflow_advance_application_reconcile on public.customer_advance_applications;
create trigger workflow_advance_application_reconcile after insert or update or delete on public.customer_advance_applications for each row execute function public.workflow_reconcile_advance_application_row();
drop trigger if exists workflow_supplier_bill_reconcile on public.supplier_bills;
create trigger workflow_supplier_bill_reconcile after insert or update on public.supplier_bills for each row execute function public.workflow_reconcile_supplier_bill_row();
drop trigger if exists workflow_supplier_bill_item_reconcile on public.supplier_bill_items;
create trigger workflow_supplier_bill_item_reconcile after insert or update or delete on public.supplier_bill_items for each row execute function public.workflow_reconcile_supplier_bill_item_row();
drop trigger if exists workflow_supplier_payment_application_reconcile on public.supplier_payment_applications;
create trigger workflow_supplier_payment_application_reconcile after insert or update or delete on public.supplier_payment_applications for each row execute function public.workflow_reconcile_supplier_payment_application_row();
drop trigger if exists workflow_supplier_payment_reconcile on public.supplier_payments;
create trigger workflow_supplier_payment_reconcile after insert or update or delete on public.supplier_payments for each row execute function public.workflow_reconcile_supplier_payment_row();

create or replace function public.reconcile_current_workflow_tasks()
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  r record;
  v_sales integer:=0;
  v_purchase integer:=0;
  v_shipments integer:=0;
  v_invoices integer:=0;
  v_bills integer:=0;
begin
  for r in select id from public.sales_orders where status in ('confirmed','closed') loop perform public.reconcile_sales_order_workflow_tasks(r.id); v_sales:=v_sales+1; end loop;
  for r in select id from public.purchase_orders where status='confirmed' loop perform public.reconcile_purchase_order_workflow_tasks(r.id); v_purchase:=v_purchase+1; end loop;
  for r in select id from public.shipments where active=true loop perform public.reconcile_shipment_workflow_tasks(r.id,false); v_shipments:=v_shipments+1; end loop;
  for r in select id from public.invoices where status in ('draft','issued') loop perform public.reconcile_invoice_workflow_tasks(r.id); v_invoices:=v_invoices+1; end loop;
  for r in select id from public.supplier_bills where status='posted' loop perform public.reconcile_supplier_bill_workflow_tasks(r.id); v_bills:=v_bills+1; end loop;
  return jsonb_build_object('sales_orders',v_sales,'purchase_orders',v_purchase,'active_shipments',v_shipments,'invoices',v_invoices,'supplier_bills',v_bills);
end;
$$;

revoke execute on function public.reconcile_sales_order_workflow_tasks(uuid) from public,anon,authenticated;
revoke execute on function public.reconcile_purchase_order_workflow_tasks(uuid) from public,anon,authenticated;
revoke execute on function public.reconcile_shipment_workflow_tasks(uuid,boolean) from public,anon,authenticated;
revoke execute on function public.reconcile_invoice_workflow_tasks(uuid) from public,anon,authenticated;
revoke execute on function public.reconcile_supplier_bill_workflow_tasks(uuid) from public,anon,authenticated;
revoke execute on function public.reconcile_current_workflow_tasks() from public,anon,authenticated;
grant execute on function public.reconcile_sales_order_workflow_tasks(uuid) to service_role;
grant execute on function public.reconcile_purchase_order_workflow_tasks(uuid) to service_role;
grant execute on function public.reconcile_shipment_workflow_tasks(uuid,boolean) to service_role;
grant execute on function public.reconcile_invoice_workflow_tasks(uuid) to service_role;
grant execute on function public.reconcile_supplier_bill_workflow_tasks(uuid) to service_role;
grant execute on function public.reconcile_current_workflow_tasks() to service_role;
