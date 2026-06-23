-- Add trigger column to notification_rules ---------------------------------
-- Supported values: 'on_enter_column' (default) | 'on_job_created'

alter table public.notification_rules
  add column if not exists trigger text not null default 'on_enter_column'
    check (trigger in ('on_enter_column', 'on_job_created'));
