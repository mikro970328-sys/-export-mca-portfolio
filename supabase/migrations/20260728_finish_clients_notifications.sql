-- Export MCA: finish clients and notifications module
-- Adds compatibility fields used by welcome, tracking, release, delivery and retry flows.

alter table public.notifications
  add column if not exists event_type text,
  add column if not exists channel text not null default 'whatsapp',
  add column if not exists recipient text,
  add column if not exists status text,
  add column if not exists provider_message_id text,
  add column if not exists template_sid text,
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists error_message text,
  add column if not exists sent_at timestamptz,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists last_attempt_at timestamptz;

create index if not exists idx_notifications_client_created
  on public.notifications(client_id, created_at desc);

create index if not exists idx_notifications_shipment_created
  on public.notifications(shipment_id, created_at desc);

create index if not exists idx_notifications_status_created
  on public.notifications(status, created_at desc);

create unique index if not exists idx_notifications_provider_message_unique
  on public.notifications(provider_message_id)
  where provider_message_id is not null;

-- Backfill modern fields from the legacy tracking columns where possible.
update public.notifications
set
  event_type = coalesce(event_type, event_status, 'tracking'),
  recipient = coalesce(recipient, recipient_phone),
  status = coalesce(status, delivery_status, 'pending'),
  provider_message_id = coalesce(provider_message_id, twilio_message_sid),
  sent_at = coalesce(sent_at, created_at),
  attempt_count = case when attempt_count = 0 then 1 else attempt_count end,
  last_attempt_at = coalesce(last_attempt_at, created_at)
where
  event_type is null
  or recipient is null
  or status is null
  or provider_message_id is null
  or sent_at is null
  or attempt_count = 0
  or last_attempt_at is null;
