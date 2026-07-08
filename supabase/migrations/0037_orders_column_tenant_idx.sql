-- Composite index to speed up per-column paginated queries on the board.
-- The existing single-column orders_tenant_idx and orders_column_idx are
-- replaced by a single covering index so the DB can satisfy the common
-- board fetch (tenant_id = X AND column_id = Y ORDER BY position) with
-- one index scan instead of a bitmap-AND of two separate indexes.
create index if not exists orders_column_tenant_position_idx
  on public.orders (tenant_id, column_id, position)
  where removed_at is null;
