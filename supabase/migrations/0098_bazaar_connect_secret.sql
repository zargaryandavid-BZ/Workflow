-- Optional handshake secret for Bazaar Admin one-click connect.
-- Additive. Paste Order Sync keeps working with this column unset.

alter table public.webhook_configs
  add column if not exists bazaar_connect_secret text;

comment on column public.webhook_configs.bazaar_connect_secret is
  'Optional Admin handshake secret (x-bazaar-connect-secret). Not wh_live_ or osk_.';
