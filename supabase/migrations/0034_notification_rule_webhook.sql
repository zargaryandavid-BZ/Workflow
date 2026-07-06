-- Add webhook channel columns to notification_rules -------------------------

alter table public.notification_rules
  add column if not exists send_webhook          boolean not null default false,
  add column if not exists webhook_url           text    not null default '',
  add column if not exists webhook_body_template text    not null default '',
  add column if not exists webhook_headers       jsonb   not null default '{}';
