-- Multi-item box slips (separate from fulfillment_boxes)

create table if not exists public.multiitem_boxes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  box_name text not null,
  box_number int not null,
  box_date date not null,
  po_number text,
  size_label text,
  weight_lbs numeric(6,2),
  customer_id uuid references public.customers(id) on delete set null,
  customer_name text,
  customer_email text,
  customer_phone text,
  status text not null default 'open' check (status in ('open', 'saved')),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  saved_at timestamptz,
  unique (tenant_id, box_date, box_number)
);

-- Keep this migration safe to re-run in local databases where the tables were
-- created before box-level customer information was added.
alter table public.multiitem_boxes
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text;

create table if not exists public.multiitem_box_orders (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  box_id uuid not null references public.multiitem_boxes(id) on delete cascade,
  order_id uuid not null references public.orders(id) on delete cascade,
  order_title text not null,
  item_title text,
  customer_name text,
  quantity int not null default 1 check (quantity >= 1),
  added_at timestamptz not null default now(),
  unique (box_id, order_id)
);

create index if not exists multiitem_boxes_tenant_open_idx
  on public.multiitem_boxes (tenant_id, status, box_date desc);

create index if not exists multiitem_box_orders_box_idx
  on public.multiitem_box_orders (box_id, added_at);

alter table public.multiitem_boxes enable row level security;
alter table public.multiitem_box_orders enable row level security;

drop policy if exists "tenant members can manage multiitem boxes"
  on public.multiitem_boxes;
create policy "tenant members can manage multiitem boxes"
  on public.multiitem_boxes
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );

drop policy if exists "tenant members can manage multiitem box orders"
  on public.multiitem_box_orders;
create policy "tenant members can manage multiitem box orders"
  on public.multiitem_box_orders
  for all
  using (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  )
  with check (
    tenant_id in (
      select tenant_id from public.memberships where user_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.multiitem_boxes to authenticated;
grant select, insert, update, delete on public.multiitem_box_orders to authenticated;
