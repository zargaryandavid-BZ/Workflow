-- Customer dedup by contact within a tenant.
alter table public.customers
  add column if not exists updated_at timestamptz not null default now();

create unique index if not exists customers_tenant_email_unique
  on public.customers (tenant_id, email)
  where email is not null;

create unique index if not exists customers_tenant_phone_unique
  on public.customers (tenant_id, phone)
  where phone is not null;
