-- Die requests: optional third dimension (Z) and product name from the board order.

alter table public.die_requests
  add column if not exists depth numeric;

alter table public.die_requests
  add column if not exists product_name text;
