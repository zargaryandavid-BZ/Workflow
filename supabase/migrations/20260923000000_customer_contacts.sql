-- Extra people at the same company (review/approval + missing-info notify).
-- The customers row stays the primary contact; these are additional members.

create table if not exists public.customer_contacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,
  name text not null default '',
  email text,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customer_contacts_email_or_phone check (
    (email is not null and length(btrim(email)) > 0)
    or (phone is not null and length(btrim(phone)) > 0)
  )
);

create index if not exists customer_contacts_customer_idx
  on public.customer_contacts (customer_id, created_at);

create unique index if not exists customer_contacts_email_uidx
  on public.customer_contacts (customer_id, lower(btrim(email)))
  where email is not null and length(btrim(email)) > 0;

alter table public.customer_contacts enable row level security;

drop policy if exists "customer_contacts_member_all" on public.customer_contacts;
create policy "customer_contacts_member_all" on public.customer_contacts
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

drop trigger if exists customer_contacts_set_updated_at on public.customer_contacts;
create trigger customer_contacts_set_updated_at
  before update on public.customer_contacts
  for each row execute function public.set_updated_at();

comment on table public.customer_contacts is
  'Additional company members (email/SMS) for review and approval requests.';
