/**
 * Business-hours ("open hours") elapsed in a column — NOT wall-clock.
 *
 * A card can show 16h wall-clock overnight even though the shop was closed most
 * of it. This counts only the time inside the relevant team's open hours, so
 * "how long has this really been sitting" is honest.
 *
 * Calendars (Bazaar, local/Pacific time):
 *   - Boyd / general:  Mon–Sat, 9:30am–5:30pm.
 *   - Prepress (Hrach): Mon–Fri, 8:00am–4:00pm (8h/day).
 *
 * The existing wall-clock chips are unchanged; this is an additional read.
 */

import { stageKey } from "@/lib/stage-groups";

interface OpenCalendar {
  /** Open weekdays, Date.getDay() numbering (0=Sun … 6=Sat). */
  days: number[];
  /** Open time in decimal hours (9.5 = 9:30am). */
  open: number;
  /** Close time in decimal hours (17.5 = 5:30pm). */
  close: number;
}

const BOYD: OpenCalendar = { days: [1, 2, 3, 4, 5, 6], open: 9.5, close: 17.5 };
const PREPRESS: OpenCalendar = { days: [1, 2, 3, 4, 5], open: 8, close: 16 };

function calendarForColumn(columnName: string | null | undefined): OpenCalendar {
  if (columnName && stageKey(columnName) === stageKey("Hrach")) return PREPRESS;
  return BOYD;
}

function atHour(base: Date, decimalHour: number): number {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    Math.floor(decimalHour),
    Math.round((decimalHour % 1) * 60)
  ).getTime();
}

/** Elapsed OPEN hours (per `cal`) between two instants. */
export function workingHoursBetween(
  fromMs: number,
  toMs: number,
  cal: OpenCalendar
): number {
  if (toMs <= fromMs) return 0;
  let total = 0;
  const start = new Date(fromMs);
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  let guard = 0;
  while (cursor.getTime() <= toMs && guard < 500) {
    guard++;
    if (cal.days.includes(cursor.getDay())) {
      const lo = Math.max(atHour(cursor, cal.open), fromMs);
      const hi = Math.min(atHour(cursor, cal.close), toMs);
      if (hi > lo) total += (hi - lo) / 3_600_000;
    }
    cursor = new Date(
      cursor.getFullYear(),
      cursor.getMonth(),
      cursor.getDate() + 1
    );
  }
  return total;
}

/** Open-hours the card has sat in its current column, or null. */
export function workingHoursInColumn(
  lastMovedAt: string | null | undefined,
  nowMs: number,
  columnName: string | null | undefined
): number | null {
  if (!lastMovedAt) return null;
  const from = new Date(lastMovedAt).getTime();
  if (Number.isNaN(from)) return null;
  return workingHoursBetween(from, nowMs, calendarForColumn(columnName));
}

/**
 * Short label for the extra "open hours" chip, e.g. "6h open" or "1.5d open"
 * (a day = the calendar's 8 open hours).
 */
export function formatWorkingHours(
  lastMovedAt: string | null | undefined,
  nowMs: number,
  columnName: string | null | undefined
): { label: string; title: string } | null {
  const h = workingHoursInColumn(lastMovedAt, nowMs, columnName);
  if (h == null) return null;
  const cal = calendarForColumn(columnName);
  const dayHours = cal.close - cal.open || 8;
  if (h < dayHours * 1.5) {
    const hr = Math.round(h * 10) / 10;
    return {
      label: `${hr}h open`,
      title: `${hr} open-hours in this column (business hours only)`,
    };
  }
  const d = Math.round((h / dayHours) * 10) / 10;
  return {
    label: `${d}d open`,
    title: `${d} open-days in this column (business hours only)`,
  };
}
