alter table public.webhook_configs
  add column if not exists excluded_products text[] not null default '{}'::text[];
