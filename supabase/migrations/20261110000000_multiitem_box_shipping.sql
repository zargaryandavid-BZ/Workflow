-- Shipping info on a packed multi-item box: carrier, tracking number, and
-- when it left the shop.
alter table public.multiitem_boxes
  add column if not exists carrier text,
  add column if not exists tracking_number text,
  add column if not exists shipped_at timestamptz;

-- "Which box is this order in?" (Scan page badge).
create index if not exists multiitem_box_orders_order_idx
  on public.multiitem_box_orders (order_id);
