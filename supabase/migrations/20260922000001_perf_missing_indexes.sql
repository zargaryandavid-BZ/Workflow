-- Performance: two missing indexes identified in board load profiling
-- (1) Functional index on specs->>'designer_id' eliminates full scans when the
--     board filters orders by designer (column-orders route + attachQueueRanks).
-- (2) Composite covering index on job_notifications speeds up the
--     enrichBoardOrders query that filters by order_id + status + created_at.
--
-- CONCURRENTLY omitted — Supabase runs migrations in a transaction,
-- and CREATE INDEX CONCURRENTLY cannot run inside a transaction block.

CREATE INDEX IF NOT EXISTS orders_specs_designer_id_idx
  ON public.orders ((specs->>'designer_id'))
  WHERE removed_at IS NULL;

CREATE INDEX IF NOT EXISTS job_notifications_order_status_created_idx
  ON public.job_notifications (order_id, status, created_at DESC);
