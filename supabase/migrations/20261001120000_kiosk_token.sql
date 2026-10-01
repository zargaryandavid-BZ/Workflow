-- Add kiosk_token to fulfillment_settings.
-- Each tenant gets a unique, unguessable UUID that acts as a public scan URL token.
-- Workers bookmark /kiosk/<token> and can use it without a Supabase account.

alter table public.fulfillment_settings
  add column if not exists kiosk_token uuid default gen_random_uuid();

-- Backfill any existing rows that got NULL (shouldn't happen with DEFAULT, but be safe)
update public.fulfillment_settings
set kiosk_token = gen_random_uuid()
where kiosk_token is null;

alter table public.fulfillment_settings
  alter column kiosk_token set not null;

create unique index if not exists fulfillment_settings_kiosk_token_key
  on public.fulfillment_settings (kiosk_token);
