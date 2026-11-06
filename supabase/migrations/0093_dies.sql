-- Die library: every die the shop has (or is getting). "+ Add Die" on the
-- Die Order page saves here; a quote request to a manufacturer can be sent
-- from any die (die_requests.die_id).

create table if not exists public.dies (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  die_type text not null default 'other'
    check (die_type in ('label', 'paper', 'box', 'other')),
  order_id uuid references public.orders (id) on delete set null,
  pacdora_template_name text,
  pacdora_link text,
  -- Unique code made by the app (DIE-00001), printed as a QR code.
  template_code text not null,
  length numeric,
  width numeric,
  height numeric,
  shape text not null default 'square'
    check (shape in ('square', 'round', 'custom')),
  rounded_corner boolean not null default false,
  perforation boolean not null default false,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, template_code)
);

create index if not exists dies_tenant_idx on public.dies (tenant_id);
create index if not exists dies_order_idx on public.dies (order_id);

alter table public.dies enable row level security;

drop policy if exists "dies_member_all" on public.dies;
create policy "dies_member_all" on public.dies
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

alter table public.die_requests
  add column if not exists die_id uuid references public.dies (id) on delete set null;

create index if not exists die_requests_die_idx on public.die_requests (die_id);
