-- Add 'manual' channel for operator follow-up without sending email/SMS.
do $$ begin
  alter type public.notification_channel add value if not exists 'manual';
exception when duplicate_object then null; end $$;
