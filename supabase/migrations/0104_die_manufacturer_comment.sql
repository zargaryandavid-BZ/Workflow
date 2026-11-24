-- Free-text comment per die manufacturer (internal notes: pricing, lead time, who to ask…).

alter table public.die_manufacturers
  add column if not exists comment text;
