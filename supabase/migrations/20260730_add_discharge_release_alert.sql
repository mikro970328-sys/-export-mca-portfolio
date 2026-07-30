alter table public.shipments
  add column if not exists discharged_at timestamptz;

create index if not exists shipments_discharged_unreleased_idx
  on public.shipments (discharged_at)
  where discharged_at is not null and released_at is null and active = true;

comment on column public.shipments.discharged_at is
  'Fecha y hora en que el contenedor fue descargado. Activa la alerta de liberación pendiente después de 5 días.';
