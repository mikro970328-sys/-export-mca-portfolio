create or replace view public.shipment_customs_document_readiness as
with load_state as (
  select
    shipment_id,
    bool_or(status = 'dispatched') as has_dispatched_load
  from public.loads
  where shipment_id is not null
  group by shipment_id
),
document_state as (
  select
    shipment_id,
    bool_or(generated = false and lower(btrim(document_type)) = 'packing list cuba') as has_packing_list_cuba,
    bool_or(generated = false and lower(btrim(document_type)) in ('commercial invoice cuba','factura comercial cuba')) as has_commercial_invoice_cuba,
    count(*) filter (where generated = false) as manual_document_count
  from public.documents
  where shipment_id is not null
  group by shipment_id
),
base as (
  select
    s.id as shipment_id,
    s.container_number,
    s.client_id,
    s.active,
    s.operational_status,
    s.last_status,
    s.departure_date,
    s.delivered_at,
    coalesce(ls.has_dispatched_load,false)
      or s.departure_date is not null
      or s.delivered_at is not null
      or s.active = false as documentation_required,
    coalesce(ds.has_packing_list_cuba,false) as has_packing_list_cuba,
    coalesce(ds.has_commercial_invoice_cuba,false) as has_commercial_invoice_cuba,
    coalesce(ds.manual_document_count,0)::bigint as manual_document_count
  from public.shipments s
  left join load_state ls on ls.shipment_id = s.id
  left join document_state ds on ds.shipment_id = s.id
)
select
  base.*,
  case
    when not documentation_required then 'not_required'
    when has_packing_list_cuba and has_commercial_invoice_cuba then 'ready'
    else 'pending'
  end as document_status,
  case
    when not documentation_required then array[]::text[]
    else array_remove(array[
      case when not has_packing_list_cuba then 'Packing List Cuba' end,
      case when not has_commercial_invoice_cuba then 'Commercial Invoice Cuba' end
    ], null)
  end as missing_documents
from base;

create or replace function public.transition_invoice(p_invoice_id uuid, p_action text)
returns public.invoices
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_invoice public.invoices;
  v_action text := lower(btrim(coalesce(p_action,'')));
  v_target text;
begin
  select * into v_invoice from public.invoices where id = p_invoice_id for update;
  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;

  if v_action = 'issue' then
    if v_invoice.status <> 'draft' then raise exception 'INVOICE_NOT_DRAFT'; end if;
    v_target := 'issued';
  elsif v_action = 'void' then
    if v_invoice.status not in ('draft','issued') then raise exception 'INVOICE_CANNOT_VOID'; end if;
    v_target := 'void';
  else
    raise exception 'INVOICE_ACTION_INVALID';
  end if;

  update public.invoices set status = v_target, updated_at = now() where id = p_invoice_id;
  select * into v_invoice from public.invoices where id = p_invoice_id;
  return v_invoice;
end;
$function$;

comment on view public.shipment_customs_document_readiness is 'Derived Cuba customs-document readiness per shipment. No manual readiness flag: READY requires manual Packing List Cuba and Commercial Invoice Cuba once shipment is sent/dispatched/delivered.';
