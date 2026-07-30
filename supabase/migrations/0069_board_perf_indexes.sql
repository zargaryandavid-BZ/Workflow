-- Board column list is ordered by position within a tenant.
create index if not exists board_columns_tenant_position_idx
  on public.board_columns (tenant_id, position);

-- Profiles PK already covers id lookups; no secondary index needed.
-- orders (tenant_id, column_id, position) WHERE removed_at IS NULL — 0037
-- time_entries running partial index — 0055
-- feedback (tenant_id, …) — 0063
