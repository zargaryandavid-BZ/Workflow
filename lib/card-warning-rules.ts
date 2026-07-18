import type { CardWarningColor, CardWarningRule } from "./types";

export const CARD_WARNING_COLORS: CardWarningColor[] = [
  "amber",
  "orange",
  "red",
  "purple",
  "blue",
  "pink",
];

export const CARD_WARNING_COLOR_LABELS: Record<CardWarningColor, string> = {
  amber: "Amber",
  orange: "Orange",
  red: "Red",
  purple: "Purple",
  blue: "Blue",
  pink: "Pink",
};

export const CARD_WARNING_BORDER_COLORS: Record<CardWarningColor, string> = {
  amber: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#a855f7",
  blue: "#3b82f6",
  pink: "#ec4899",
};

export const CARD_WARNING_COLOR_SWATCHES: Record<CardWarningColor, string> = {
  amber: "#f59e0b",
  orange: "#f97316",
  red: "#ef4444",
  purple: "#a855f7",
  blue: "#3b82f6",
  pink: "#ec4899",
};

export function isCardWarningColor(v: unknown): v is CardWarningColor {
  return CARD_WARNING_COLORS.includes(v as CardWarningColor);
}

export interface ActiveWarning {
  rule: CardWarningRule;
  daysSinceMoved: number;
}

/** Counts working days (Mon–Fri) between two timestamps. */
export function workingDaysBetween(fromMs: number, toMs: number): number {
  if (toMs <= fromMs) return 0;
  let count = 0;
  // Walk day by day from start to end
  const msPerDay = 1000 * 60 * 60 * 24;
  let cursor = new Date(fromMs);
  // Advance to the start of the next day so we only count full elapsed days
  cursor = new Date(
    cursor.getFullYear(),
    cursor.getMonth(),
    cursor.getDate() + 1
  );
  const end = new Date(toMs);
  while (cursor <= end) {
    const day = cursor.getDay(); // 0 = Sun, 6 = Sat
    if (day !== 0 && day !== 6) count++;
    cursor = new Date(cursor.getTime() + msPerDay);
  }
  return count;
}

/** Working days since the card last changed columns (`last_moved_at`). */
export function daysInCurrentColumn(
  lastMovedAt: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (!lastMovedAt) return null;
  const movedAt = new Date(lastMovedAt).getTime();
  if (Number.isNaN(movedAt)) return null;
  return Math.floor(workingDaysBetween(movedAt, nowMs));
}

export function getActiveWarning(
  order: { last_moved_at: string | null; column_id: string },
  rules: CardWarningRule[]
): ActiveWarning | null {
  if (!order.last_moved_at) return null;

  const movedAt = new Date(order.last_moved_at).getTime();
  if (Number.isNaN(movedAt)) return null;

  const now = Date.now();
  // Threshold still counts Mon–Fri only; display/evaluate every day including weekends.
  const daysSinceMoved = workingDaysBetween(movedAt, now);

  const applicable = rules.filter((rule) => {
    if (!rule.enabled) return false;
    if (rule.apply_to_columns.length === 0) return true;
    return rule.apply_to_columns.includes(order.column_id);
  });

  const triggered = applicable.filter(
    (rule) => daysSinceMoved >= rule.threshold_days
  );

  if (triggered.length === 0) return null;

  const worst = triggered.reduce((w, rule) =>
    rule.threshold_days > w.threshold_days ? rule : w
  );

  return { rule: worst, daysSinceMoved: Math.floor(daysSinceMoved) };
}
