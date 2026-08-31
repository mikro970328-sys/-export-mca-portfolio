-- P18 · Cover the provider observation FK used by shipment snapshots.

create index if not exists shipments_tracking_provider_observation_idx
  on public.shipments(tracking_provider_observation_id)
  where tracking_provider_observation_id is not null;
