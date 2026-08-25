-- Die manufacturers (Settings) + optional manufacturer/comment on die requests.

create table if not exists public.die_manufacturers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  full_name text not null,
  contact_name text,
  email text not null,
  phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists die_manufacturers_tenant_idx
  on public.die_manufacturers (tenant_id);

alter table public.die_manufacturers enable row level security;

drop policy if exists "die_manufacturers_member_all" on public.die_manufacturers;
create policy "die_manufacturers_member_all" on public.die_manufacturers
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

alter table public.die_requests
  add column if not exists manufacturer_id uuid
    references public.die_manufacturers (id) on delete set null,
  add column if not exists comment text;

create index if not exists die_requests_manufacturer_idx
  on public.die_requests (manufacturer_id);
