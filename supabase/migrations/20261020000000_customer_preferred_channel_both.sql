-- Customer notify default: allow "both" (Email + SMS) and remember when staff
-- chose it on purpose. Additive + idempotent; no existing row changes.
--
-- preferred_channel stays NOT NULL DEFAULT 'sms'. Every existing customer keeps
-- its current value. preferred_channel_set_at is NULL until staff save a
-- default, so automatic shipped / picked-up / stage messages keep sending to
-- every contact on file for customers who never chose.

alter table public.customers
  drop constraint if exists customers_preferred_channel_check;

alter table public.customers
  add constraint customers_preferred_channel_check
  check (preferred_channel in ('sms', 'email', 'both'));

alter table public.customers
  add column if not exists preferred_channel_set_at timestamptz;

comment on column public.customers.preferred_channel is
  'Default channel for every customer notification: sms | email | both.';
comment on column public.customers.preferred_channel_set_at is
  'When staff last saved preferred_channel on purpose (NULL = DB default, never chosen).';
