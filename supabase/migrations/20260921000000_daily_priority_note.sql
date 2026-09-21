alter table public.orders
  add column if not exists daily_priority_note text;
