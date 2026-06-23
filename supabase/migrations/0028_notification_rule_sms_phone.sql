-- Add explicit SMS recipient phone number to notification rules ----------------
alter table public.notification_rules
  add column if not exists sms_to_phone text not null default '';
