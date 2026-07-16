-- Per-customer default for missing-info / approval / ready-to-ship notifications.
-- SMS is the product default; fall back to the other channel when contact is missing.
alter table public.customers
  add column if not exists preferred_channel text not null default 'sms'
  check (preferred_channel in ('sms', 'email'));
