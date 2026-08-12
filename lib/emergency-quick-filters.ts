/**
 * Helpers for Emergency due quick-filter chips (1 day left / Due today / Late).
 */

import {
  type ColumnRef,
  type EmergencyBalanceConfig,
  type EmergencyDueQuickFilterKey,
  type EmergencyQuickFilterButtonConfig,
  DEFAULT_QUICK_FILTER_BUTTON,
} from "@/lib/emergency-balance";
import { columnsIncludedInBoardHealth } from "@/lib/board-health";

export type QuickFilterColumn = {
  id: string;
  name: string;
  kind?: string | null;
};

/**
 * Columns from the start of the board through `throughColumnId` (inclusive).
 * When throughColumnId is null/missing, uses Board health cutoff (Ready to Ship).
 */
export function columnsForQuickFilter(
  columns: QuickFilterColumn[],
  throughColumnId: string | null | undefined
): QuickFilterColumn[] {
  if (throughColumnId) {
    const idx = columns.findIndex((c) => c.id === throughColumnId);
    if (idx >= 0) return columns.slice(0, idx + 1);
  }
  return columnsIncludedInBoardHealth(
    columns.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind ?? undefined,
    }))
  );
}

export function columnIdsForQuickFilter(
  columns: QuickFilterColumn[],
  throughColumnId: string | null | undefined
): Set<string> {
  return new Set(columnsForQuickFilter(columns, throughColumnId).map((c) => c.id));
}

export function quickFilterButtonConfig(
  config: EmergencyBalanceConfig,
  key: EmergencyDueQuickFilterKey
): EmergencyQuickFilterButtonConfig {
  return config.quick_filters?.[key] ?? { ...DEFAULT_QUICK_FILTER_BUTTON };
}

export function isQuickFilterVisible(
  config: EmergencyBalanceConfig,
  key: EmergencyDueQuickFilterKey
): boolean {
  return quickFilterButtonConfig(config, key).visible !== false;
}

/** Resolve through-column select value for settings UI (null → sentinel). */
export const QUICK_FILTER_THROUGH_DEFAULT = "__board_health__";

export function throughColumnSelectValue(
  cfg: EmergencyQuickFilterButtonConfig
): string {
  return cfg.through_column_id ?? QUICK_FILTER_THROUGH_DEFAULT;
}

export function throughColumnIdFromSelect(
  value: string
): string | null {
  if (!value || value === QUICK_FILTER_THROUGH_DEFAULT) return null;
  return value;
}

export function formatThroughColumnLabel(
  columns: ColumnRef[],
  throughColumnId: string | null
): string {
  if (!throughColumnId) return "Ready to Ship (Board health default)";
  const col = columns.find((c) => c.id === throughColumnId);
  return col?.name ?? "Unknown column";
}
