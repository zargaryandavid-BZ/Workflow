-- SKU gallery images (SKUs live in orders.specs.skus JSON; sku_id is that row's id)
create table if not exists public.order_sku_images (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants (id) on delete cascade,
  order_id     uuid not null references public.orders (id) on delete cascade,
  sku_id       uuid not null,
  file_name    text not null,
  file_size    bigint,
  mime_type    text,
  storage_path text not null,
  position     integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists order_sku_images_sku_idx
  on public.order_sku_images (sku_id);
create index if not exists order_sku_images_order_idx
  on public.order_sku_images (order_id);

alter table public.order_sku_images enable row level security;

create policy "order_sku_images_member_all" on public.order_sku_images
  for all using (public.is_tenant_member(tenant_id))
  with check (public.is_tenant_member(tenant_id));
