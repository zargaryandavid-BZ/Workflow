export type DieRequestStatus = "sent" | "quoted" | "ordered";

export type DieAlertLevel =
  | "overdue"
  | "due_today"
  | "after_required"
  | "due_soon";

export type DieAlert = {
  level: DieAlertLevel;
  label: string;
  confirmedDueDate: string;
};

export type DieRequestFile = {
  path: string;
  name: string;
  mime: string | null;
};

export const DIE_MAX_FILES = 5;

export interface DieRequest {
  id: string;
  tenant_id: string;
  order_id: string;
  token: string;
  width: number | null;
  height: number | null;
  depth: number | null;
  product_name: string | null;
  required_date: string;
  allow_own_date: boolean;
  to_email: string;
  manufacturer_id: string | null;
  manufacturer_name: string | null;
  comment: string | null;
  files: DieRequestFile[];
  file_path: string | null;
  file_name: string | null;
  file_mime: string | null;
  status: DieRequestStatus;
  quoted_price: number | null;
  time_estimate: string | null;
  confirmed_due_date: string | null;
  client_note: string | null;
  sent_at: string;
  quoted_at: string | null;
  ordered_at: string | null;
  created_at: string;
  order_title: string | null;
  order_due_date: string | null;
  customer_name: string | null;
}

const ALERT_RANK: Record<DieAlertLevel, number> = {
  overdue: 4,
  due_today: 3,
  after_required: 2,
  due_soon: 1,
};

export function ymdDate(value: string | Date): string {
  if (typeof value === "string") return value.slice(0, 10);
  const y = value.getFullYear();
  const m = String(value.getMonth() + 1).padStart(2, "0");
  const d = String(value.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseYmdLocal(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim().slice(0, 10));
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Working (Mon–Fri) / calendar days from today to `toYmd` (exclusive start, inclusive end). */
export function dieDaysToDeliver(
  toYmd: string,
  fromYmd: string = ymdDate(new Date())
): { calendar: number; working: number } {
  const from = parseYmdLocal(fromYmd);
  const to = parseYmdLocal(toYmd);
  if (!from || !to) return { calendar: 0, working: 0 };
  const calendar = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  let working = 0;
  const step = calendar >= 0 ? 1 : -1;
  const cur = new Date(from);
  for (let i = 0; i < Math.abs(calendar); i++) {
    cur.setDate(cur.getDate() + step);
    const day = cur.getDay();
    if (day !== 0 && day !== 6) working += step;
  }
  return { calendar, working };
}

export function formatDieDaysToDeliver(span: {
  calendar: number;
  working: number;
}): string {
  const w = Math.abs(span.working);
  const c = Math.abs(span.calendar);
  if (span.calendar === 0) return "Today";
  const label = `${w}/${c}`;
  if (span.calendar < 0) return `${label} overdue`;
  return `${label} working/calendar`;
}

export function formatDieSize(
  width: number | string | null | undefined,
  height: number | string | null | undefined,
  depth?: number | string | null | undefined
): string {
  const parts = [width, height, depth]
    .map((v) => (v == null || v === "" ? "" : String(v).trim()))
    .filter(Boolean);
  return parts.length > 0 ? parts.join(" × ") : "—";
}

export function parseOptionalDieDim(
  raw: string
): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n <= 0) return { ok: false };
  return { ok: true, value: n };
}

export function formatDieQuotedPrice(price: number | null): string {
  if (price == null || !Number.isFinite(price)) return "$—";
  if (Number.isInteger(price)) return `$${price}`;
  return `$${price.toFixed(2).replace(/\.00$/, "")}`;
}

export function dieDateMovedDays(
  requiredYmd: string,
  confirmedYmd: string
): number {
  return dieDaysToDeliver(confirmedYmd, requiredYmd).calendar;
}

export function formatDieDateMoved(days: number): string {
  if (days === 0) return "same day";
  if (days === 1) return "1 day moved";
  if (days === -1) return "1 day earlier";
  if (days > 1) return `${days} days moved`;
  return `${Math.abs(days)} days earlier`;
}

function addCalendarDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1);
  dt.setDate(dt.getDate() + days);
  return ymdDate(dt);
}

export function dieAlertLabel(level: DieAlertLevel): string {
  switch (level) {
    case "overdue":
      return "Die overdue";
    case "due_today":
      return "Die due today";
    case "after_required":
      return "Die after required date";
    case "due_soon":
      return "Die due soon";
  }
}

/** Alarm when the client-confirmed die due date is late, today, past required, or within 2 days. */
export function dieRequestAlert(
  req: Pick<
    DieRequest,
    "status" | "confirmed_due_date" | "required_date"
  >,
  today = ymdDate(new Date())
): DieAlert | null {
  if (
    (req.status !== "quoted" && req.status !== "ordered") ||
    !req.confirmed_due_date
  ) {
    return null;
  }
  const confirmed = ymdDate(req.confirmed_due_date);
  const required = ymdDate(req.required_date);

  let level: DieAlertLevel | null = null;
  if (confirmed < today) level = "overdue";
  else if (confirmed === today) level = "due_today";
  else if (confirmed > required) level = "after_required";
  else if (confirmed <= addCalendarDays(today, 2)) level = "due_soon";

  if (!level) return null;
  return {
    level,
    label: dieAlertLabel(level),
    confirmedDueDate: confirmed,
  };
}

export function worstDieAlert(alerts: DieAlert[]): DieAlert | null {
  if (alerts.length === 0) return null;
  return [...alerts].sort(
    (a, b) => ALERT_RANK[b.level] - ALERT_RANK[a.level]
  )[0];
}

export type DieBoardStatus = {
  status: DieRequestStatus;
  label: string;
};

const DIE_STATUS_RANK: Record<DieRequestStatus, number> = {
  sent: 1,
  quoted: 2,
  ordered: 3,
};

/** `2026-08-28` → `28.08` */
export function formatDieDayMonth(ymd: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd ?? "").trim());
  if (!m) return null;
  return `${m[3]}.${m[2]}`;
}

export function dieBoardStatusLabel(
  req: Pick<DieRequest, "status" | "confirmed_due_date">
): string {
  if (req.status === "ordered") {
    const day = formatDieDayMonth(req.confirmed_due_date);
    return day ? `Die ordered - ${day}` : "Die ordered";
  }
  if (req.status === "quoted") return "Die manuf. waiting";
  return "Die requested";
}

export function pickDieBoardStatus(
  rows: Array<Pick<DieRequest, "status" | "confirmed_due_date" | "created_at">>
): DieBoardStatus | null {
  if (rows.length === 0) return null;
  const best = [...rows].sort((a, b) => {
    const rank = DIE_STATUS_RANK[b.status] - DIE_STATUS_RANK[a.status];
    if (rank !== 0) return rank;
    return String(b.created_at).localeCompare(String(a.created_at));
  })[0];
  return { status: best.status, label: dieBoardStatusLabel(best) };
}

export const DIE_BOARD_STATUS_CLASS: Record<DieRequestStatus, string> = {
  sent: "bg-amber-100 text-amber-800",
  quoted: "bg-sky-100 text-sky-800",
  ordered: "bg-blue-100 text-blue-800",
};

export const DIE_ALERT_CLASS: Record<DieAlertLevel, string> = {
  overdue: "bg-red-100 text-red-800",
  due_today: "bg-red-100 text-red-800",
  after_required: "bg-orange-100 text-orange-800",
  due_soon: "bg-amber-100 text-amber-800",
};

export function parseDieRequestFiles(raw: unknown): DieRequestFile[] {
  if (!Array.isArray(raw)) return [];
  const files: DieRequestFile[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const path = String(row.path ?? row.file_path ?? "").trim();
    const name = String(row.name ?? row.file_name ?? "").trim();
    if (!path) continue;
    files.push({
      path,
      name: name || "file",
      mime: row.mime || row.file_mime ? String(row.mime ?? row.file_mime) : null,
    });
    if (files.length >= DIE_MAX_FILES) break;
  }
  return files;
}

export function dieRequestFiles(
  req: Pick<DieRequest, "files" | "file_path" | "file_name" | "file_mime">
): DieRequestFile[] {
  if (req.files && req.files.length > 0) return req.files.slice(0, DIE_MAX_FILES);
  if (req.file_path) {
    return [
      {
        path: req.file_path,
        name: req.file_name || "file",
        mime: req.file_mime,
      },
    ];
  }
  return [];
}

export function collectDieUploadFiles(form: FormData): File[] {
  const out: File[] = [];
  const seen = new Set<File>();
  for (const key of ["files", "file"]) {
    for (const value of form.getAll(key)) {
      if (value instanceof File && value.size > 0 && !seen.has(value)) {
        seen.add(value);
        out.push(value);
      }
    }
  }
  return out;
}

export function isDieFileImage(
  file: Pick<DieRequestFile, "mime" | "name">
): boolean {
  if (file.mime?.toLowerCase().startsWith("image/")) return true;
  return /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(file.name ?? "");
}

export function isDieAttachmentImage(
  req: Pick<DieRequest, "file_mime" | "file_name" | "file_path" | "files">
): boolean {
  return dieRequestFiles(req).some(isDieFileImage);
}
