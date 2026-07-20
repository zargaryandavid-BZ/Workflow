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

/** Date.getDay() values: 0 = Sunday … 6 = Saturday. Default Mon–Fri. */
export const DEFAULT_WARNING_WORKING_DAYS: number[] = [1, 2, 3, 4, 5];

export const WEEKDAY_OPTIONS: { day: number; label: string; short: string }[] =
  [
    { day: 1, label: "Monday", short: "Mon" },
    { day: 2, label: "Tuesday", short: "Tue" },
    { day: 3, label: "Wednesday", short: "Wed" },
    { day: 4, label: "Thursday", short: "Thu" },
    { day: 5, label: "Friday", short: "Fri" },
    { day: 6, label: "Saturday", short: "Sat" },
    { day: 0, label: "Sunday", short: "Sun" },
  ];

export function isCardWarningColor(v: unknown): v is CardWarningColor {
  return CARD_WARNING_COLORS.includes(v as CardWarningColor);
}

/** Keep unique 0–6 values; fall back to Mon–Fri if empty/invalid. */
export function normalizeWorkingDays(
  days: number[] | null | undefined
): number[] {
  const valid = (days ?? []).filter(
    (d) => Number.isInteger(d) && d >= 0 && d <= 6
  );
  const unique = [...new Set(valid)].sort((a, b) => a - b);
  return unique.length > 0 ? unique : [...DEFAULT_WARNING_WORKING_DAYS];
}

export interface ActiveWarning {
  rule: CardWarningRule;
  daysSinceMoved: number;
}

/**
 * Counts configured working days between two timestamps.
 * `workingDays` uses Date.getDay() numbering (0 = Sun … 6 = Sat).
 */
export function workingDaysBetween(
  fromMs: number,
  toMs: number,
  workingDays: number[] = DEFAULT_WARNING_WORKING_DAYS
): number {
  if (toMs <= fromMs) return 0;
  const daySet = new Set(normalizeWorkingDays(workingDays));
  let count = 0;
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
    if (daySet.has(cursor.getDay())) count++;
    cursor = new Date(cursor.getTime() + msPerDay);
  }
  return count;
}

/** Working days since the card last changed columns (`last_moved_at`). */
export function daysInCurrentColumn(
  lastMovedAt: string | null | undefined,
  nowMs: number = Date.now(),
  workingDays: number[] = DEFAULT_WARNING_WORKING_DAYS
): number | null {
  if (!lastMovedAt) return null;
  const movedAt = new Date(lastMovedAt).getTime();
  if (Number.isNaN(movedAt)) return null;
  return Math.floor(workingDaysBetween(movedAt, nowMs, workingDays));
}

/** Elapsed wall-clock hours since the card last changed columns. */
export function hoursInCurrentColumn(
  lastMovedAt: string | null | undefined,
  nowMs: number = Date.now()
): number | null {
  if (!lastMovedAt) return null;
  const movedAt = new Date(lastMovedAt).getTime();
  if (Number.isNaN(movedAt)) return null;
  return Math.max(0, Math.floor((nowMs - movedAt) / (1000 * 60 * 60)));
}

/**
 * Label for the card timer: hours when ≤1 working day, otherwise working days.
 */
export function formatTimeInColumn(
  lastMovedAt: string | null | undefined,
  nowMs: number = Date.now(),
  workingDays: number[] = DEFAULT_WARNING_WORKING_DAYS
): { label: string; title: string } | null {
  const days = daysInCurrentColumn(lastMovedAt, nowMs, workingDays);
  if (days == null) return null;
  if (days <= 1) {
    const hours = hoursInCurrentColumn(lastMovedAt, nowMs) ?? 0;
    return {
      label: `${hours}h`,
      title: `${hours} hour${hours === 1 ? "" : "s"} in this column`,
    };
  }
  return {
    label: `${days}d`,
    title: `${days} working day${days === 1 ? "" : "s"} in this column`,
  };
}

export function getActiveWarning(
  order: { last_moved_at: string | null; column_id: string },
  rules: CardWarningRule[],
  workingDays: number[] = DEFAULT_WARNING_WORKING_DAYS
): ActiveWarning | null {
  if (!order.last_moved_at) return null;

  const movedAt = new Date(order.last_moved_at).getTime();
  if (Number.isNaN(movedAt)) return null;

  const now = Date.now();
  const daysSinceMoved = workingDaysBetween(movedAt, now, workingDays);

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
