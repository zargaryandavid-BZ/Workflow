-- Multiple ship-from / pickup addresses. One row per tenant may be the FedEx origin.

create table if not exists public.shipping_pickup_locations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null default 'Shop',
  street text not null default '',
  city text not null default '',
  state text not null default '',
  zip text not null default '',
  country text not null default 'US',
  hours_note text,
  use_for_fedex boolean not null default false,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists shipping_pickup_locations_tenant_idx
  on public.shipping_pickup_locations (tenant_id, position);

create unique index if not exists shipping_pickup_locations_one_fedex
  on public.shipping_pickup_locations (tenant_id)
  where use_for_fedex;

alter table public.shipping_pickup_locations enable row level security;

drop policy if exists "shipping_pickup_locations_member_all"
  on public.shipping_pickup_locations;
create policy "shipping_pickup_locations_member_all"
  on public.shipping_pickup_locations
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

insert into public.shipping_pickup_locations (
  tenant_id,
  name,
  street,
  city,
  state,
  zip,
  country,
  hours_note,
  use_for_fedex,
  position
)
select
  s.tenant_id,
  coalesce(nullif(btrim(s.shipper_street), ''), 'Shop'),
  coalesce(s.shipper_street, ''),
  coalesce(s.shipper_city, ''),
  coalesce(s.shipper_state, ''),
  coalesce(s.shipper_zip, ''),
  coalesce(s.shipper_country, 'US'),
  s.pickup_hours_note,
  true,
  0
from public.shipping_settings s
where not exists (
  select 1
  from public.shipping_pickup_locations l
  where l.tenant_id = s.tenant_id
);
