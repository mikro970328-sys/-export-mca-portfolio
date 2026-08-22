-- B4.1 forward · Facturación backend-only.
-- La policy legacy autenticada ya no corresponde al modelo nuevo.

drop policy if exists authenticated_access_invoices on public.invoices;

revoke all on table public.invoices from anon, authenticated;
revoke all on table public.invoice_items from anon, authenticated;

grant select on table public.invoices to service_role;
grant select on table public.invoice_items to service_role;
