-- Add require_all_group_items to notification_rules ----------------------------
-- When enabled, the rule's SMS/email will only fire when ALL sub-items of a
-- grouped order (same webhook_order_number or title prefix) are in the column.

alter table public.notification_rules
  add column if not exists require_all_group_items boolean not null default false;
