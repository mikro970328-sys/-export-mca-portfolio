-- B6.1 · Privilege hardening
-- Deja las superficies financieras B6 como read-only para service_role.
-- Las mutaciones de B6.2 se harán exclusivamente mediante RPC SECURITY DEFINER.

revoke all on table public.cost_charges from anon, authenticated, service_role;
revoke all on table public.cost_charge_allocations from anon, authenticated, service_role;
revoke all on table public.cost_charge_progress from anon, authenticated, service_role;
revoke all on table public.purchase_order_item_merchandise_cost_basis from anon, authenticated, service_role;
revoke all on table public.warehouse_receipt_item_merchandise_cost from anon, authenticated, service_role;
revoke all on sequence public.cost_charges_cost_serial_seq from anon, authenticated, service_role;

grant select on table public.cost_charges to service_role;
grant select on table public.cost_charge_allocations to service_role;
grant select on table public.cost_charge_progress to service_role;
grant select on table public.purchase_order_item_merchandise_cost_basis to service_role;
grant select on table public.warehouse_receipt_item_merchandise_cost to service_role;
