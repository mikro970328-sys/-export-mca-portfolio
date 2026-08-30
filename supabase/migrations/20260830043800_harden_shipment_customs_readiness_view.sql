alter view public.shipment_customs_document_readiness set (security_invoker=true);

revoke all on table public.shipment_customs_document_readiness from anon,authenticated;
grant select on table public.shipment_customs_document_readiness to service_role;

comment on view public.shipment_customs_document_readiness is
  'Derived Cuba customs-document readiness per shipment. Backend-only view using caller permissions; READY requires manual Packing List Cuba and Commercial Invoice Cuba once shipment is sent/dispatched/delivered.';
