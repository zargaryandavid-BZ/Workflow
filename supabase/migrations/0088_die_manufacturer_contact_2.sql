-- Second manufacturer contact (email + SMS) on die requests.

alter table public.die_manufacturers
  add column if not exists contact_name_2 text,
  add column if not exists email_2 text,
  add column if not exists phone_2 text;
