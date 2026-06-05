-- Track when customer records change (used when linking customers from orders).
alter table public.customers
  add column if not exists updated_at timestamptz not null default now();

drop trigger if exists customers_set_updated_at on public.customers;
create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();
