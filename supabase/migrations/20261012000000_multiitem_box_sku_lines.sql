-- Persist the selected Final Production PDF SKU/page breakdown for each order
-- added to a multi-item box.
alter table public.multiitem_box_orders
  add column if not exists sku_lines jsonb not null default '[]'::jsonb;

alter table public.multiitem_box_orders
  drop constraint if exists multiitem_box_orders_sku_lines_array;

alter table public.multiitem_box_orders
  add constraint multiitem_box_orders_sku_lines_array
  check (jsonb_typeof(sku_lines) = 'array');
