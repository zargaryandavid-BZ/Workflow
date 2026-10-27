import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { isDesignerQueueColumnName } from "@/lib/designer-queue-columns";
import {
  countDesignerLoads,
  pickLeastLoadedDesigner,
  type DesignerLoadStats,
} from "@/lib/designer-load";

/**
 * Tenant config for automatic designer assignment, stored as columns on
 * `tenants` (same pattern as emergency_balance / warning_* settings). Editable
 * in Settings → Designers. Defaults are inert (disabled, empty pool, no stale
 * timer) so nothing changes until an admin turns it on.
 */
export type DesignerAssignmentSettings = {
  /** Auto-assign the least-busy pool designer to incoming orders with no designer. */
  enabled: boolean;
  /** Designer user ids that participate (e.g. Marianna, Har). */
  pool: string[];
  /** Business-hours a card may sit with one designer before it auto-transfers to
   *  the next-least-busy pool designer. 0 = stale transfer off. */
  staleHours: number;
  /** Working days counted for the stale timer (0=Sun … 6=Sat). */
  workingDays: number[];
};

export const DEFAULT_DESIGNER_ASSIGNMENT: DesignerAssignmentSettings = {
  enabled: false,
  pool: [],
  staleHours: 0,
  workingDays: [1, 2, 3, 4, 5],
};

/** Shape raw tenant columns into settings (tolerant of missing migration). */
export function normalizeDesignerAssignment(
  row: Record<string, unknown> | null | undefined
): DesignerAssignmentSettings {
  if (!row) return { ...DEFAULT_DESIGNER_ASSIGNMENT };
  const poolRaw = row.designer_pool;
  const pool = Array.isArray(poolRaw)
    ? [...new Set(poolRaw.filter((x): x is string => typeof x === "string" && x.trim() !== ""))]
    : [];
  const wdRaw = row.designer_working_days;
  const workingDays = Array.isArray(wdRaw)
    ? [
        ...new Set(
          wdRaw
            .map((n) => Math.round(Number(n)))
            .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
        ),
      ].sort((a, b) => a - b)
    : [];
  const staleRaw = Number(row.designer_stale_hours);
  const staleHours = Number.isFinite(staleRaw) ? Math.max(0, Math.round(staleRaw)) : 0;
  return {
    enabled: row.designer_autoassign_enabled === true,
    pool,
    staleHours,
    workingDays: workingDays.length ? workingDays : DEFAULT_DESIGNER_ASSIGNMENT.workingDays,
  };
}

export async function getDesignerAssignmentSettings(
  client: SupabaseClient,
  tenantId: string
): Promise<DesignerAssignmentSettings> {
  const { data } = await client
    .from("tenants")
    .select(
      "designer_autoassign_enabled, designer_pool, designer_stale_hours, designer_working_days"
    )
    .eq("id", tenantId)
    .maybeSingle();
  return normalizeDesignerAssignment(data as Record<string, unknown> | null);
}

/** IDs of the Start / In Progress columns — where a designer's open work lives. */
async function designerQueueColumnIds(
  client: SupabaseClient,
  tenantId: string
): Promise<string[]> {
  const { data: cols } = await client
    .from("board_columns")
    .select("id, name")
    .eq("tenant_id", tenantId);
  return ((cols ?? []) as { id: string; name: string | null }[])
    .filter((c) => isDesignerQueueColumnName(c.name))
    .map((c) => c.id);
}

/** Open (Start / In Progress) cards + SKU rows per pool designer. */
async function openQueueLoads(
  client: SupabaseClient,
  tenantId: string,
  columnIds: string[],
  pool: string[]
): Promise<Map<string, DesignerLoadStats>> {
  if (columnIds.length === 0) return countDesignerLoads(pool, [], []);
  const { data, error } = await client
    .from("orders")
    .select("column_id, designer_id:specs->>designer_id, skus:specs->skus")
    .eq("tenant_id", tenantId)
    .in("specs->>designer_id", pool)
    .in("column_id", columnIds)
    .is("removed_at", null);
  if (error) throw error;
  const rows = (data ?? []) as {
    column_id: string;
    designer_id: string | null;
    skus: unknown;
  }[];
  return countDesignerLoads(
    pool,
    rows.map((row) => ({
      column_id: row.column_id,
      specs: { designer_id: row.designer_id, skus: row.skus },
    })),
    columnIds
  );
}

/**
 * The most available pool designer: fewest open Start/In-Progress cards, then
 * fewest SKU rows on those cards, then pool order (stable). `excludeId` lets the
 * stale-transfer skip the current designer. Returns null when the pool is empty.
 */
export async function pickLeastBusyDesigner(
  client: SupabaseClient,
  tenantId: string,
  settings: DesignerAssignmentSettings,
  opts?: { excludeId?: string | null }
): Promise<string | null> {
  const pool = settings.pool.filter((id) => id && id !== opts?.excludeId);
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0] ?? null;

  const columnIds = await designerQueueColumnIds(client, tenantId);
  const loads = await openQueueLoads(client, tenantId, columnIds, pool);
  return pickLeastLoadedDesigner(pool, loads);
}
