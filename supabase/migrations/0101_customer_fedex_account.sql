-- Client FedEx account numbers (third-party / customer-owned).
-- Staff attach a number in Settings → Shipping; board cards show a FedEx chip.

alter table public.customers
  add column if not exists fedex_account_number text;

create unique index if not exists customers_tenant_fedex_account_unique
  on public.customers (tenant_id, fedex_account_number)
  where fedex_account_number is not null;
