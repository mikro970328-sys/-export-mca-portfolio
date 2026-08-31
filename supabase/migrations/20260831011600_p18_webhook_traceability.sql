-- P18 · Webhook receipt traceability. Attempts may repeat; provider observation identity is unique elsewhere.

alter table public.webhook_events
  add column if not exists provider text,
  add column if not exists provider_event_key text,
  add column if not exists observation_id uuid;

alter table public.webhook_events drop constraint if exists webhook_events_observation_id_fkey;
alter table public.webhook_events
  add constraint webhook_events_observation_id_fkey
  foreign key (observation_id)
  references public.external_tracking_observations(id)
  on delete set null
  not valid;
alter table public.webhook_events validate constraint webhook_events_observation_id_fkey;

create index if not exists webhook_events_provider_event_idx
  on public.webhook_events(provider,provider_event_key,created_at desc)
  where provider_event_key is not null;
create index if not exists webhook_events_observation_idx
  on public.webhook_events(observation_id)
  where observation_id is not null;
