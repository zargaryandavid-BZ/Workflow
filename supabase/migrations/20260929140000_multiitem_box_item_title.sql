alter table public.multiitem_box_orders
  add column if not exists item_title text;
