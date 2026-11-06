-- Where the die is kept (shelf / bin), so people can find it.
alter table public.dies
  add column if not exists location text;
