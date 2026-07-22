export const ACTIVITY_TYPES = [
  "Design",
  "Revision",
  "Prepress",
  "Proof Review",
  "Client Communication",
  "Admin",
  "Meeting",
  "Other",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export function isActivityType(value: unknown): value is ActivityType {
  return (
    typeof value === "string" &&
    (ACTIVITY_TYPES as readonly string[]).includes(value)
  );
}

export interface TimeEntry {
  id: string;
  tenant_id: string;
  user_id: string;
  order_id: string | null;
  order_title: string | null;
  custom_task_name: string | null;
  activity_type: ActivityType;
  started_at: string;
  ended_at: string | null;
  /** When set, the timer is paused (clock frozen). */
  paused_at: string | null;
  /** Accumulated seconds spent paused across prior pause intervals. */
  paused_seconds: number;
  notes: string | null;
  created_at: string;
  /** Computed server-side at query time */
  duration_seconds: number;
  /** Live order title when join succeeds; falls back to order_title snapshot */
  job_title?: string | null;
  job_number?: string | null;
  customer_name?: string | null;
  user_display_name?: string | null;
}

export interface TimeReportResponse {
  daily_totals: { date: string; seconds: number }[];
  per_job: {
    job_id: string | null;
    job_title: string;
    seconds: number;
  }[];
  per_activity: { activity_type: string; seconds: number }[];
  per_user?: { user_id: string; display_name: string; seconds: number }[];
}

/** HH:MM:SS elapsed display */
export function formatDuration(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Hours with one decimal, e.g. "2.5 hrs" */
export function formatHours(seconds: number): string {
  return `${(Math.max(0, seconds) / 3600).toFixed(1)} hrs`;
}

export function durationSeconds(
  startedAt: string,
  endedAt: string | null,
  nowMs: number = Date.now(),
  opts?: { pausedAt?: string | null; pausedSeconds?: number }
): number {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return 0;
  const pausedSec = Math.max(0, Math.floor(opts?.pausedSeconds ?? 0));
  let endMs: number;
  if (endedAt) {
    endMs = new Date(endedAt).getTime();
  } else if (opts?.pausedAt) {
    endMs = new Date(opts.pausedAt).getTime();
  } else {
    endMs = nowMs;
  }
  if (Number.isNaN(endMs)) return 0;
  return Math.max(0, Math.floor((endMs - start) / 1000) - pausedSec);
}

export function isTimerPaused(entry: {
  ended_at?: string | null;
  paused_at?: string | null;
}): boolean {
  return !entry.ended_at && Boolean(entry.paused_at);
}

export function entrySubjectLabel(entry: {
  custom_task_name?: string | null;
  job_title?: string | null;
  order_title?: string | null;
  job_number?: string | null;
}): string {
  const custom = entry.custom_task_name?.trim();
  if (custom) return custom;
  const live = entry.job_title?.trim();
  if (live) return live;
  const snap = entry.order_title?.trim();
  if (snap) return snap;
  return "Untitled job";
}

/** Local calendar date YYYY-MM-DD */
export function localDateString(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Start of local day as ISO string */
export function localDayStartIso(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0).toISOString();
}

/** End of local day (exclusive next midnight) as ISO string */
export function localDayEndExclusiveIso(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d + 1, 0, 0, 0, 0).toISOString();
}

export function startOfWeekMonday(d: Date = new Date()): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = copy.getDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  return copy;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** Fired in the browser when timers start/stop so the sidebar widget refreshes. */
export const TIME_ENTRIES_CHANGED_EVENT = "ppm:time-entries-changed";

export function notifyTimeEntriesChanged(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(TIME_ENTRIES_CHANGED_EVENT));
}
