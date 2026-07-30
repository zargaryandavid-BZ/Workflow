-- Migration: performance indexes recommended by Supabase Index Advisor
-- Applied: 2026-07-30
-- Note: CONCURRENTLY omitted — Supabase runs migrations in a transaction,
-- and CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

-- 1. order_sku_images: sort by position (23.55% query cost reduction)
CREATE INDEX IF NOT EXISTS idx_order_sku_images_position
  ON public.order_sku_images USING btree ("position");

-- 2. job_notifications: sort/filter by created_at (45.34% query cost reduction)
--    (Table already has job_notifications_order_idx on order_id; this is additive)
CREATE INDEX IF NOT EXISTS idx_job_notifications_created_at
  ON public.job_notifications USING btree (created_at);

-- 3. assets: sort/filter by created_at (62.57% query cost reduction)
--    (Table already has assets_order_idx on order_id; this is additive)
CREATE INDEX IF NOT EXISTS idx_assets_created_at
  ON public.assets USING btree (created_at);

-- 4. custom_fields: sort by position (65.77% query cost reduction)
--    (No existing index on this column — biggest single win)
CREATE INDEX IF NOT EXISTS idx_custom_fields_position
  ON public.custom_fields USING btree ("position");

-- 5. board_columns: sort by position (30.63% query cost reduction)
--    (Table already has board_columns_tenant_position_idx on tenant_id+position;
--     this standalone position index helps queries that don't filter by tenant)
CREATE INDEX IF NOT EXISTS idx_board_columns_position
  ON public.board_columns USING btree ("position");
