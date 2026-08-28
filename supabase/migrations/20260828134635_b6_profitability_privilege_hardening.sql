-- B6.5 · Privilege hardening
-- Read models de rentabilidad/trazabilidad: service_role solo necesita SELECT.

revoke all on public.sales_order_profitability from service_role;
revoke all on public.issued_invoice_profitability from service_role;
revoke all on public.load_profitability from service_role;
revoke all on public.operation_descendant_direct_costs from service_role;
revoke all on public.operation_profitability from service_role;
revoke all on public.sales_order_cost_traceability from service_role;
revoke all on public.issued_invoice_cost_traceability from service_role;
revoke all on public.posted_cost_charge_traceability from service_role;

grant select on public.sales_order_profitability to service_role;
grant select on public.issued_invoice_profitability to service_role;
grant select on public.load_profitability to service_role;
grant select on public.operation_descendant_direct_costs to service_role;
grant select on public.operation_profitability to service_role;
grant select on public.sales_order_cost_traceability to service_role;
grant select on public.issued_invoice_cost_traceability to service_role;
grant select on public.posted_cost_charge_traceability to service_role;
