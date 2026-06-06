alter table public.assets
  add column if not exists sku_key text;

create index if not exists assets_order_sku_idx
  on public.assets (order_id, sku_key)
  where sku_key is not null;
