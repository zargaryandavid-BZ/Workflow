-- Migration: FK covering indexes recommended by Supabase Performance Advisor
-- Applied: 2026-07-30
-- Note: CONCURRENTLY omitted — Supabase runs migrations in a transaction,
-- and CREATE INDEX CONCURRENTLY cannot run inside a transaction block.
-- For zero-downtime on a live DB, run these CREATE INDEX CONCURRENTLY
-- statements manually in the SQL editor outside a transaction instead.

-- orders.customer_id — every board query joins orders → customers
CREATE INDEX IF NOT EXISTS idx_orders_customer_id
  ON public.orders USING btree (customer_id);

-- orders.created_by — used in owner filter queries
CREATE INDEX IF NOT EXISTS idx_orders_created_by
  ON public.orders USING btree (created_by);

-- orders.tag_id — used in tag filter queries (column renamed from category_id)
CREATE INDEX IF NOT EXISTS idx_orders_tag_id
  ON public.orders USING btree (tag_id);

-- custom_field_values.custom_field_id — used in every custom field value lookup
CREATE INDEX IF NOT EXISTS idx_custom_field_values_field_id
  ON public.custom_field_values USING btree (custom_field_id);

-- webhook_history.webhook_config_id — used in webhook history queries
CREATE INDEX IF NOT EXISTS idx_webhook_history_config_id
  ON public.webhook_history USING btree (webhook_config_id);

-- assets.tenant_id — used in tenant-scoped asset queries
CREATE INDEX IF NOT EXISTS idx_assets_tenant_id
  ON public.assets USING btree (tenant_id);

-- job_notifications.created_by — used in notification queries
CREATE INDEX IF NOT EXISTS idx_job_notifications_created_by
  ON public.job_notifications USING btree (created_by);

-- time_entries.user_id — used in time tracking queries
CREATE INDEX IF NOT EXISTS idx_time_entries_user_id
  ON public.time_entries USING btree (user_id);
