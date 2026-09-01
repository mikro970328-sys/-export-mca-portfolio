-- UX-5 · Supplier AP capability views are read-only service-role boundaries.

revoke all on public.supplier_bill_action_capabilities from service_role;
revoke all on public.supplier_payment_action_capabilities from service_role;

grant select on public.supplier_bill_action_capabilities to service_role;
grant select on public.supplier_payment_action_capabilities to service_role;
