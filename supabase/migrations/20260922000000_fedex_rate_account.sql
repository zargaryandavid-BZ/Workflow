-- Quote (Rate API) account can differ from the Ship / label account.
alter table public.shipping_settings
  add column if not exists fedex_rate_account_number text;

comment on column public.shipping_settings.fedex_rate_account_number is
  'FedEx account used for Rate API delivery quotes. Labels still use fedex_account_number.';
