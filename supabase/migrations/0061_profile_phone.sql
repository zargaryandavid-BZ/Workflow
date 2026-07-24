-- Staff phone numbers on profiles (team settings + designer/owner SMS).
alter table public.profiles
  add column if not exists phone text;
