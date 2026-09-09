-- Bazaar CRM customer id on the directory row (not only order specs).
alter table public.customers
  add column if not exists crm_customer_id text;

create index if not exists idx_customers_crm_customer_id
  on public.customers (tenant_id, crm_customer_id)
  where crm_customer_id is not null;

comment on column public.customers.crm_customer_id is
  'Bazaar CRM customer id; stamped from webhooks so staff contact edits can sync back.';

update public.customers c
set crm_customer_id = sub.crm_customer_id
from (
  select distinct on (customer_id)
    customer_id,
    specs->>'crm_customer_id' as crm_customer_id
  from public.orders
  where specs->>'crm_customer_id' is not null
    and customer_id is not null
    and removed_at is null
  order by customer_id, created_at desc
) sub
where c.id = sub.customer_id
  and sub.crm_customer_id is not null
  and c.crm_customer_id is null;
