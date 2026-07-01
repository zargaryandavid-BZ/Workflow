-- Internal notes field on orders (visible only to team, never sent to customers)
alter table public.orders
  add column if not exists internal_note text;
