-- Contenedores / Tracking · Fase 2
-- Applied to production Supabase before application deployment.

alter table public.shipments
  alter column client_id drop not null;

alter table public.shipments
  add column if not exists quantity numeric null,
  add column if not exists quantity_unit text null,
  add column if not exists departure_date date null;

comment on column public.shipments.client_id is
  'Optional buyer/client. NULL means the container is not assigned to a customer yet.';
comment on column public.shipments.quantity is
  'Commercial/logistics quantity loaded in the container.';
comment on column public.shipments.quantity_unit is
  'Unit associated with quantity, for example panels, cases, gallons, units.';
comment on column public.shipments.departure_date is
  'Single departure date entered manually by Export MCA.';

alter table public.notifications
  alter column client_id drop not null;

comment on column public.notifications.client_id is
  'Optional for internal operational alerts. Customer messaging rows require a real client in application logic.';
