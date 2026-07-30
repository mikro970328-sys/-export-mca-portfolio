-- Export MCA ERP
-- Logistics alerts phase 3.1
-- Adds the operational data required by booking, Draft B/L, B/L and ETA alerts.

alter table public.shipments
  add column if not exists draft_bol_number text,
  add column if not exists eta timestamptz;

create index if not exists idx_shipments_active_eta
  on public.shipments(active, eta)
  where active = true;

comment on column public.shipments.draft_bol_number is
  'Draft Bill of Lading reference received before the final B/L.';

comment on column public.shipments.eta is
  'Current estimated arrival timestamp used by the operational alert engine.';
