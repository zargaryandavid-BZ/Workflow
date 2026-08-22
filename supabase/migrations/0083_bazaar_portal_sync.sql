-- Bazaar portal Order Sync: status callbacks from Workflow → Bazaar
-- Additive only. Sync stays off until enabled in Settings → Integrations.

alter table public.webhook_configs
  add column if not exists bazaar_api_url text,
  add column if not exists bazaar_portal_inbound_keys jsonb not null default '{}'::jsonb,
  add column if not exists bazaar_portal_sync_enabled boolean not null default false;

comment on column public.webhook_configs.bazaar_api_url is
  'Bazaar API base URL for portal status callbacks, e.g. https://api.bazaarprinting.com or http://localhost:3002';
comment on column public.webhook_configs.bazaar_portal_inbound_keys is
  'Map of Bazaar brokerId -> osk_ string (legacy) or { osk, label } for portal status callbacks';
comment on column public.webhook_configs.bazaar_portal_sync_enabled is
  'When false (default), Workflow never POSTs portal status to Bazaar';

-- Seed Portal source label when missing (do not overwrite existing portal entry)
update public.webhook_configs
set source_styles = jsonb_set(
  coalesce(source_styles, '{"sources":[],"other":{"label":"Webhook","color":"#64748b"}}'::jsonb),
  '{sources}',
  coalesce(source_styles->'sources', '[]'::jsonb) ||
    '[{"key":"portal","label":"Portal","color":"#0d9488"}]'::jsonb
)
where not (
  coalesce(source_styles->'sources', '[]'::jsonb) @> '[{"key":"portal"}]'::jsonb
);
