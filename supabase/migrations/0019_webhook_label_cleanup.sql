-- Webhook label is stored in webhook_configs.label only (no config JSON column).
-- Export/import no longer duplicates it in integrations[].config.label.
comment on column public.webhook_configs.label is 'Authoritative webhook display name';
