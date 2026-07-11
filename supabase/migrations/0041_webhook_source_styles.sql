-- Persist webhook origin on orders (null = created manually in the app).
alter table public.orders
  add column if not exists webhook_source text;

comment on column public.orders.webhook_source is
  'Webhook payload source key when created via inbound webhook; null for manually created cards';

-- Tenant-configurable source labels + free hex colors for board cards.
alter table public.webhook_configs
  add column if not exists source_styles jsonb not null default '{
    "sources": [],
    "other": { "label": "Webhook", "color": "#64748b" }
  }'::jsonb;

comment on column public.webhook_configs.source_styles is
  'Map of webhook source keys to display label + hex color; other is the fallback style';
