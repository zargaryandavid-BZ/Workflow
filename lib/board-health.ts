/**
 * Board health (0–5) from late / due-today / warning / stuck job counts.
 *
 * Scope: configurable through-column (default: Ready to Ship).
 * Late / Due today use Due quick-filter column ranges when set.
 * Warnings use Card Warnings rules; Stuck uses Emergency idle conditions.
 */

import {
  daysInCurrentColumn,
  getActiveWarning,
  hoursInCurrentColumn,
  type ActiveWarning,
} from "@/lib/card-warning-rules";
import { calendarDaysUntilDue } from "@/lib/board-due-date";
import { isRushOrder } from "@/lib/order-rush";
import { businessDateString } from "@/lib/board-order-filters";
import {
  DEFAULT_EMERGENCY_BALANCE,
  type EmergencyBalanceConfig,
  type EmergencyCondition,
} from "@/lib/emergency-balance";
import { evaluateEmergency } from "@/lib/emergency-view";
import { stageKey } from "@/lib/stage-groups";
import type { CardWarningRule } from "@/lib/types";

export type BoardHealthLevel = 0 | 1 | 2 | 3 | 4 | 5;

export interface BoardHealthCounts {
  open: number;
  late: number;
  dueToday: number;
  warnings: number;
  stuck: number;
  /** Unique jobs in any of the problem buckets. */
  attention: number;
}

/** Active Start / In Progress load — same (cards)/SKUs as assign designer. */
export interface BoardHealthDesignerLoad {
  id: string;
  name: string;
  load: number;
  skuCount: number;
}

export interface BoardHealthResult {
  level: BoardHealthLevel;
  label: string;
  summary: string;
  counts: BoardHealthCounts;
  /** When false, the top-bar button should not render. */
  visible: boolean;
  /** Which metric rows to show in the popover. */
  show: {
    late: boolean;
    dueToday: boolean;
    warnings: boolean;
    stuck: boolean;
  };
  /** Label for the open-jobs footer (e.g. Ready to Ship). */
  throughLabel: string;
  /** Designer load in Start + In Progress, same math as the assign menu. */
  designers: BoardHealthDesignerLoad[];
}

export const BOARD_HEALTH_META: Record<
  BoardHealthLevel,
  { label: string; color: string; iconClass: string; summary: string }
> = {
  0: {
    label: "Crisis",
    color: "#b91c1c",
    iconClass: "text-red-700",
    summary: "Too many late or stuck jobs.",
  },
  1: {
    label: "Critical",
    color: "#ef4444",
    iconClass: "text-red-500",
    summary: "Board is under heavy pressure.",
  },
  2: {
    label: "Poor",
    color: "#f97316",
    iconClass: "text-orange-500",
    summary: "Many jobs are slipping.",
  },
  3: {
    label: "Fair",
    color: "#f59e0b",
    iconClass: "text-amber-500",
    summary: "Several jobs need attention.",
  },
  4: {
    label: "Good",
    color: "#84cc16",
    iconClass: "text-lime-500",
    summary: "A few jobs still need attention.",
  },
  5: {
    label: "Healthy",
    color: "#10b981",
    iconClass: "text-emerald-500",
    summary: "No late, stuck, or warning jobs.",
  },
};

/** Default idle (working days) when a column has no Emergency idle rule. */
const FALLBACK_STUCK_WORKING_DAYS = 4;

export interface HealthColumn {
  id: string;
  name: string;
  kind?: string;
}

export interface HealthOrder {
  id: string;
  column_id: string;
  due_date: string | null;
  last_moved_at: string | null;
  specs?: unknown;
  tag?: { name?: string | null } | null;
}

/**
 * Last column included in board health: Boyd Ready to Ship.
 * Prefer `kind: ready_to_ship`, then name match.
 */
export function isBoardHealthCutoffColumn(col: HealthColumn): boolean {
  if (col.kind === "ready_to_ship") return true;
  const key = stageKey(col.name);
  return key.includes("ready to ship");
}

/**
 * Fallback exclusions when no Ready to Ship column exists on the board.
 * Prefer {@link columnsIncludedInBoardHealth} for the normal cutoff.
 */
export function isHealthExcludedColumn(col: HealthColumn): boolean {
  const key = stageKey(col.name);
  if (key.includes("review request")) return true;
  if (key === "finished" || key.startsWith("finished ")) return true;
  if (key === "shipping" || key.startsWith("shipping ")) return true;
  if (key.includes("shipped customer")) return true;
  return false;
}

/**
 * Columns that feed board health, in board order.
 * Includes everything up through "(Boyd Only) Ready to Ship"; drops later stages.
 */
export function columnsIncludedInBoardHealth(
  columns: HealthColumn[]
): HealthColumn[] {
  const cutoffIdx = columns.findIndex(isBoardHealthCutoffColumn);
  if (cutoffIdx >= 0) return columns.slice(0, cutoffIdx + 1);
  return columns.filter((c) => !isHealthExcludedColumn(c));
}

/**
 * Columns from the start of the board through `throughColumnId` (inclusive).
 * When throughColumnId is null/missing, uses Ready to Ship cutoff.
 */
function columnsThroughEnd(
  columns: HealthColumn[],
  throughColumnId: string | null | undefined
): HealthColumn[] {
  if (throughColumnId) {
    const idx = columns.findIndex((c) => c.id === throughColumnId);
    if (idx >= 0) return columns.slice(0, idx + 1);
  }
  return columnsIncludedInBoardHealth(columns);
}

function columnIdSetThroughEnd(
  columns: HealthColumn[],
  throughColumnId: string | null | undefined
): Set<string> {
  return new Set(columnsThroughEnd(columns, throughColumnId).map((c) => c.id));
}

function hrs(h: number | null): number {
  return h == null ? 0 : h;
}

function wdays(d: number | null): number {
  return d == null ? 0 : d;
}

function isIdleCondition(c: EmergencyCondition): boolean {
  return c.kind === "idle_hours" || c.kind === "idle_working_days";
}

export function isStuckInColumn(
  conditions: EmergencyCondition[],
  hoursHere: number | null,
  workingDaysHere: number | null
): boolean {
  const idle = conditions.filter(isIdleCondition);
  if (idle.length === 0) {
    return wdays(workingDaysHere) > FALLBACK_STUCK_WORKING_DAYS;
  }
  for (const c of idle) {
    if (c.kind === "idle_hours" && hrs(hoursHere) > c.value) return true;
    if (c.kind === "idle_working_days" && wdays(workingDaysHere) > c.value)
      return true;
  }
  return false;
}

/**
 * Score 0–5 from late / due-today / stuck / warning rates.
 * Late and due-today weigh more than stuck; warnings weigh least.
 */
export function scoreBoardHealth(counts: BoardHealthCounts): BoardHealthLevel {
  const open = Math.max(0, counts.open);
  if (open === 0) return 5;

  const lateR = counts.late / open;
  const todayR = counts.dueToday / open;
  const stuckR = counts.stuck / open;
  const warnR = counts.warnings / open;
  const attentionR = counts.attention / open;
  const pressure = lateR * 3 + todayR * 2 + stuckR * 1.5 + warnR * 0.75;

  if (lateR >= 0.45 || pressure >= 1.8) return 0;
  if (lateR >= 0.3 || pressure >= 1.2) return 1;
  if (lateR >= 0.18 || pressure >= 0.75) return 2;
  if (lateR >= 0.08 || pressure >= 0.4) return 3;
  if (attentionR > 0) return 4;
  return 5;
}

export function buildBoardHealthResult(
  counts: BoardHealthCounts,
  opts?: {
    visible?: boolean;
    show?: BoardHealthResult["show"];
    throughLabel?: string;
    designers?: BoardHealthDesignerLoad[];
  }
): BoardHealthResult {
  const level = scoreBoardHealth(counts);
  const meta = BOARD_HEALTH_META[level];
  const summary =
    counts.attention === 0
      ? meta.summary
      : `${counts.attention} job${counts.attention === 1 ? "" : "s"} need attention.`;
  return {
    level,
    label: meta.label,
    summary,
    counts,
    visible: opts?.visible !== false,
    show: opts?.show ?? {
      late: true,
      dueToday: true,
      warnings: true,
      stuck: true,
    },
    throughLabel: opts?.throughLabel ?? "Ready to Ship",
    designers: opts?.designers ?? [],
  };
}

export function evaluateBoardHealth(opts: {
  columns: HealthColumn[];
  orders: HealthOrder[];
  warningRules: CardWarningRule[];
  warningWorkingDays: number[];
  emergencyBalance?: EmergencyBalanceConfig | null;
  nowMs?: number;
}): BoardHealthResult {
  const nowMs = opts.nowMs ?? Date.now();
  const today = businessDateString(new Date(nowMs));
  const cfg = opts.emergencyBalance ?? DEFAULT_EMERGENCY_BALANCE;
  const bh = cfg.board_health;

  const included = columnsThroughEnd(opts.columns, bh.through_column_id);
  const includedIds = new Set(included.map((c) => c.id));
  const colById = new Map(included.map((c) => [c.id, c]));

  const lateIds = columnIdSetThroughEnd(
    opts.columns,
    cfg.quick_filters.late.through_column_id
  );
  const dueTodayIds = columnIdSetThroughEnd(
    opts.columns,
    cfg.quick_filters.due_today.through_column_id
  );

  const throughCol = included[included.length - 1];
  const throughLabel = throughCol?.name ?? "Ready to Ship";

  let late = 0;
  let dueToday = 0;
  let warnings = 0;
  let stuck = 0;
  let attention = 0;

  const openOrders = opts.orders.filter((o) => includedIds.has(o.column_id));

  for (const order of openOrders) {
    const col = colById.get(order.column_id);
    if (!col) continue;

    const daysToDue = order.due_date
      ? calendarDaysUntilDue(order.due_date, today)
      : null;
    const hoursHere = hoursInCurrentColumn(order.last_moved_at, nowMs);
    const workingDaysHere = daysInCurrentColumn(
      order.last_moved_at,
      nowMs,
      opts.warningWorkingDays
    );
    const conditions = cfg.by_column[order.column_id] ?? [];

    const isLate =
      bh.show_late &&
      lateIds.has(order.column_id) &&
      daysToDue != null &&
      daysToDue < 0;
    const isDueToday =
      bh.show_due_today &&
      dueTodayIds.has(order.column_id) &&
      daysToDue === 0;

    const warning: ActiveWarning | null = bh.show_warnings
      ? getActiveWarning(order, opts.warningRules, opts.warningWorkingDays)
      : null;

    const emergency = evaluateEmergency(
      {
        columnId: col.id,
        columnName: col.name,
        hoursHere,
        workingDaysHere,
        daysToDue,
        isRush: isRushOrder(order),
        hasApplication: Boolean(
          order.specs &&
            typeof order.specs === "object" &&
            (order.specs as { application?: boolean }).application === true
        ),
        priorityScore: null,
        isKeyAccount: false,
      },
      cfg
    );

    const isWarning =
      bh.show_warnings &&
      (Boolean(warning) || emergency.severity === "amber");
    const isStuck =
      bh.show_stuck &&
      isStuckInColumn(conditions, hoursHere, workingDaysHere);

    if (isLate) late += 1;
    if (isDueToday) dueToday += 1;
    if (isWarning) warnings += 1;
    if (isStuck) stuck += 1;
    if (isLate || isDueToday || isWarning || isStuck) attention += 1;
  }

  return buildBoardHealthResult(
    {
      open: openOrders.length,
      late,
      dueToday,
      warnings,
      stuck,
      attention,
    },
    {
      visible: bh.visible !== false,
      show: {
        late: bh.show_late !== false,
        dueToday: bh.show_due_today !== false,
        warnings: bh.show_warnings !== false,
        stuck: bh.show_stuck !== false,
      },
      throughLabel,
    }
  );
}
