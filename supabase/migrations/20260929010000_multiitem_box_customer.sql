-- Persist the selected customer independently from the box's item rows.
-- Existing boxes continue to display the first item's customer until updated.

alter table public.multiitem_boxes
  add column if not exists customer_id uuid references public.customers(id) on delete set null,
  add column if not exists customer_name text,
  add column if not exists customer_email text,
  add column if not exists customer_phone text;
