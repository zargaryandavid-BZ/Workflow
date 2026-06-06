-- Normalize customer contacts and merge duplicate rows per tenant.

create or replace function public.normalize_customer_phone(raw text)
returns text
language plpgsql
immutable
as $$
declare
  digits text;
begin
  if raw is null or trim(raw) = '' then
    return null;
  end if;

  digits := regexp_replace(raw, '[^0-9]', '', 'g');

  if length(digits) = 10 then
    return '+1' || digits;
  end if;

  if length(digits) = 11 and left(digits, 1) = '1' then
    return '+' || digits;
  end if;

  if left(trim(raw), 1) = '+' then
    return '+' || digits;
  end if;

  return '+' || digits;
end;
$$;

-- Lowercase emails.
update public.customers
set email = lower(trim(email))
where email is not null
  and email <> lower(trim(email));

-- Normalize phones to E.164-style values.
update public.customers
set phone = public.normalize_customer_phone(phone)
where phone is not null
  and phone <> public.normalize_customer_phone(phone);

-- Merge duplicate emails within each tenant.
with ranked as (
  select
    c.id,
    c.tenant_id,
    c.email,
    row_number() over (
      partition by c.tenant_id, c.email
      order by
        (select count(*) from public.orders o where o.customer_id = c.id) desc,
        c.created_at asc
    ) as rn
  from public.customers c
  where c.email is not null
),
canonical as (
  select id as canonical_id, tenant_id, email
  from ranked
  where rn = 1
),
dupes as (
  select r.id as dupe_id, can.canonical_id
  from ranked r
  join canonical can
    on can.tenant_id = r.tenant_id
   and can.email = r.email
  where r.rn > 1
)
update public.orders o
set customer_id = d.canonical_id
from dupes d
where o.customer_id = d.dupe_id;

with ranked as (
  select
    c.id,
    c.tenant_id,
    c.email,
    row_number() over (
      partition by c.tenant_id, c.email
      order by
        (select count(*) from public.orders o where o.customer_id = c.id) desc,
        c.created_at asc
    ) as rn
  from public.customers c
  where c.email is not null
)
delete from public.customers c
using ranked r
where c.id = r.id
  and r.rn > 1;

-- Merge duplicate phones within each tenant.
with ranked as (
  select
    c.id,
    c.tenant_id,
    c.phone,
    row_number() over (
      partition by c.tenant_id, c.phone
      order by
        (select count(*) from public.orders o where o.customer_id = c.id) desc,
        c.created_at asc
    ) as rn
  from public.customers c
  where c.phone is not null
),
canonical as (
  select id as canonical_id, tenant_id, phone
  from ranked
  where rn = 1
),
dupes as (
  select r.id as dupe_id, can.canonical_id
  from ranked r
  join canonical can
    on can.tenant_id = r.tenant_id
   and can.phone = r.phone
  where r.rn > 1
)
update public.orders o
set customer_id = d.canonical_id
from dupes d
where o.customer_id = d.dupe_id;

with ranked as (
  select
    c.id,
    c.tenant_id,
    c.phone,
    row_number() over (
      partition by c.tenant_id, c.phone
      order by
        (select count(*) from public.orders o where o.customer_id = c.id) desc,
        c.created_at asc
    ) as rn
  from public.customers c
  where c.phone is not null
)
delete from public.customers c
using ranked r
where c.id = r.id
  and r.rn > 1;

create unique index if not exists customers_tenant_email_unique
  on public.customers (tenant_id, email)
  where email is not null;

create unique index if not exists customers_tenant_phone_unique
  on public.customers (tenant_id, phone)
  where phone is not null;
