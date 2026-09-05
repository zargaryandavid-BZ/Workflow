-- Speed tenant-wide and per-column order lists (PostgREST board / search / analytics).
-- CONCURRENTLY omitted: Supabase migrations run in a transaction.
-- Indexes that already exist from 0001 / 0037 / 20260730211910 are not duplicated.

-- Matches: WHERE tenant_id = $1 AND removed_at IS NULL ORDER BY created_at DESC
create index if not exists orders_tenant_created_idx
  on public.orders (tenant_id, created_at desc)
  where removed_at is null;

-- Board column sort: Created new/old
create index if not exists orders_tenant_column_created_idx
  on public.orders (tenant_id, column_id, created_at desc)
  where removed_at is null;

-- Board default sort: Moved new/old (falls back to created_at)
create index if not exists orders_tenant_column_moved_idx
  on public.orders (tenant_id, column_id, last_moved_at desc nulls last, created_at desc)
  where removed_at is null;

-- Board due-date sorts
create index if not exists orders_tenant_column_due_idx
  on public.orders (tenant_id, column_id, due_date)
  where removed_at is null;

-- Timeline / activity per card (covers order_id lookups; replaces sequential scan on created_at)
create index if not exists activity_log_order_created_idx
  on public.activity_log (order_id, created_at desc);

-- Removed-orders settings list
create index if not exists orders_tenant_removed_idx
  on public.orders (tenant_id, removed_at desc)
  where removed_at is not null;
