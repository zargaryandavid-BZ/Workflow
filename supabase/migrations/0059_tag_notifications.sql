-- Per-tag email/SMS notifications when an order's tag is set or changed.

alter table public.tags
  add column if not exists notify_enabled boolean not null default false,
  add column if not exists notify_send_email boolean not null default false,
  add column if not exists notify_send_sms boolean not null default false,
  add column if not exists notify_recipients text[] not null default '{}'::text[],
  add column if not exists notify_custom_email text,
  add column if not exists notify_custom_phone text,
  add column if not exists notify_email_subject text,
  add column if not exists notify_email_body text,
  add column if not exists notify_sms_body text;

comment on column public.tags.notify_recipients is
  'Subset of: customer, designer, owner, custom';
