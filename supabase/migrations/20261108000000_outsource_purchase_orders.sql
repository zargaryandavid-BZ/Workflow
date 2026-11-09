-- Outsource vendors + purchase orders (Hayk #14, 2026-11-08). Additive only.

create table if not exists public.outsource_vendors (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null,
  contact_name text,
  email text not null,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists outsource_vendors_tenant_idx
  on public.outsource_vendors (tenant_id);
alter table public.outsource_vendors enable row level security;
drop policy if exists "outsource_vendors_member_all" on public.outsource_vendors;
create policy "outsource_vendors_member_all" on public.outsource_vendors
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));

create table if not exists public.purchase_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  order_id uuid not null references public.orders (id) on delete cascade,
  vendor_id uuid references public.outsource_vendors (id) on delete set null,
  token uuid not null unique default gen_random_uuid(),
  po_number text not null,
  status text not null default 'draft'
    check (status in ('draft', 'sent', 'update_requested', 'confirmed', 'shipped', 'received', 'cancelled')),
  items jsonb not null default '[]'::jsonb,
  ship_to text,
  due_date date,
  notes text,
  folder_url text,
  total numeric,
  sent_at timestamptz,
  update_requested_at timestamptz,
  vendor_status text,
  vendor_note text,
  vendor_tracking text,
  vendor_updated_at timestamptz,
  history jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists purchase_orders_tenant_idx on public.purchase_orders (tenant_id);
create index if not exists purchase_orders_order_idx on public.purchase_orders (order_id);
alter table public.purchase_orders enable row level security;
drop policy if exists "purchase_orders_member_all" on public.purchase_orders;
create policy "purchase_orders_member_all" on public.purchase_orders
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
