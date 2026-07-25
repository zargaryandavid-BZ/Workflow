/**
 * CRM / Workflow due-date helpers.
 *
 * BazaarPrinting CRM modes:
 * - fixed: absolute YYYY-MM-DD calendar due
 * - after_approval: N working days (Mon–Fri) after confirm/production;
 *   calendar due may be empty until CRM materializes it
 */

export type DueDateMode = "fixed" | "after_approval";
export type DueDateStatus = "set" | "pending_approval" | "none";

export interface WebhookDueFields {
  due_date?: string | null;
  due_date_mode?: string | null;
  due_processing_days?: number | string | null;
  due_anchor_at?: string | null;
  due_date_label?: string | null;
  due_date_status?: string | null;
}

/** Stored on `orders.specs` for relative / CRM due metadata. */
export interface OrderDueSpecs {
  due_date_mode?: DueDateMode | null;
  due_processing_days?: number | null;
  due_anchor_at?: string | null;
  due_date_label?: string | null;
  due_date_status?: DueDateStatus | null;
}

export interface ResolvedWebhookDue {
  /** Absolute production due (`orders.due_date`), or null when not materialized. */
  dueDate: string | null;
  specs: OrderDueSpecs;
}

export const DEFAULT_PROCESSING_DAYS = 5;

/** Local calendar YYYY-MM-DD for an instant (server/local timezone). */
export function localYmdFromInstant(at: Date | string = new Date()): string {
  const date = typeof at === "string" ? new Date(at) : at;
  if (Number.isNaN(date.getTime())) {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function afterApprovalLabel(days: number): string {
  return `${days} working day${days === 1 ? "" : "s"} after approval`;
}

export interface MaterializedDue {
  dueDate: string;
  specs: OrderDueSpecs;
}

/**
 * When mode is after_approval and still pending, compute the calendar due from
 * the approval (or production) local day + N working days.
 */
export function materializeAfterApprovalDue(
  specs: unknown,
  currentDueDate?: string | null,
  anchorAt: Date | string = new Date()
): MaterializedDue | null {
  const due = readOrderDueSpecs(specs);
  if (due.due_date_mode !== "after_approval") return null;
  // Already has a calendar due — do not overwrite (CRM or prior materialize).
  if (currentDueDate?.trim()) return null;

  const days = due.due_processing_days ?? DEFAULT_PROCESSING_DAYS;
  if (days < 1) return null;

  const anchorIso =
    typeof anchorAt === "string" ? anchorAt : anchorAt.toISOString();
  const anchorYmd = localYmdFromInstant(anchorAt);
  const dueDate = addWorkingDays(anchorYmd, days);

  return {
    dueDate,
    specs: {
      ...due,
      due_date_mode: "after_approval",
      due_processing_days: days,
      due_anchor_at: anchorIso,
      due_date_status: "set",
      due_date_label: afterApprovalLabel(days),
    },
  };
}

/**
 * After materialization, changing N recomputes from the same anchor day.
 * If still pending, only updates the relative fields (no calendar date).
 */
export function recomputeDueFromProcessingDays(
  specs: unknown,
  currentDueDate: string | null | undefined,
  nextDays: number
): { dueDate: string | null; specs: OrderDueSpecs } | null {
  const days = Math.floor(nextDays);
  if (!Number.isFinite(days) || days < 1) return null;

  const due = readOrderDueSpecs(specs);
  const mode = due.due_date_mode ?? "after_approval";
  if (mode !== "after_approval") return null;

  const label = afterApprovalLabel(days);

  if (due.due_date_status === "set" || Boolean(currentDueDate?.trim())) {
    const anchorYmd = due.due_anchor_at
      ? localYmdFromInstant(due.due_anchor_at)
      : localYmdFromInstant();
    return {
      dueDate: addWorkingDays(anchorYmd, days),
      specs: {
        ...due,
        due_date_mode: "after_approval",
        due_processing_days: days,
        due_date_status: "set",
        due_date_label: label,
        due_anchor_at: due.due_anchor_at ?? new Date().toISOString(),
      },
    };
  }

  return {
    dueDate: null,
    specs: {
      ...due,
      due_date_mode: "after_approval",
      due_processing_days: days,
      due_date_status: "pending_approval",
      due_date_label: label,
    },
  };
}

/** Build specs for staff create/edit of due mode. */
export function buildStaffDueSpecs(input: {
  mode: DueDateMode;
  dueDate?: string | null;
  processingDays?: number | null;
  previousSpecs?: unknown;
}): { dueDate: string | null; specs: OrderDueSpecs } {
  const previous = readOrderDueSpecs(input.previousSpecs);

  if (input.mode === "fixed") {
    const dueDate = parseAbsoluteDue(input.dueDate);
    return {
      dueDate,
      specs: {
        due_date_mode: "fixed",
        due_processing_days: null,
        due_anchor_at: null,
        due_date_label: null,
        due_date_status: dueDate ? "set" : "none",
      },
    };
  }

  const days =
    normalizeDueProcessingDays(input.processingDays) ??
    previous.due_processing_days ??
    DEFAULT_PROCESSING_DAYS;
  const safeDays = Math.max(1, days);

  const existingAbsolute = parseAbsoluteDue(input.dueDate);
  if (previous.due_date_status === "set" || existingAbsolute) {
    // Days unchanged + existing calendar date → keep date (avoid shifting on save).
    if (
      existingAbsolute &&
      previous.due_processing_days === safeDays &&
      previous.due_date_status === "set"
    ) {
      return {
        dueDate: existingAbsolute,
        specs: {
          ...previous,
          due_date_mode: "after_approval",
          due_processing_days: safeDays,
          due_date_status: "set",
          due_date_label: afterApprovalLabel(safeDays),
        },
      };
    }
    const recomputed = recomputeDueFromProcessingDays(
      {
        ...previous,
        due_date_mode: "after_approval",
        due_date_status: "set",
      },
      input.dueDate,
      safeDays
    );
    if (recomputed) return recomputed;
  }

  return {
    dueDate: null,
    specs: {
      due_date_mode: "after_approval",
      due_processing_days: safeDays,
      due_anchor_at: null,
      due_date_label: afterApprovalLabel(safeDays),
      due_date_status: "pending_approval",
    },
  };
}

/** Merge due specs into order.specs without dropping other keys. */
export function mergeDueSpecsIntoOrderSpecs(
  existingSpecs: unknown,
  dueSpecs: OrderDueSpecs
): Record<string, unknown> {
  const base =
    existingSpecs && typeof existingSpecs === "object"
      ? { ...(existingSpecs as Record<string, unknown>) }
      : {};
  for (const key of [
    "due_date_mode",
    "due_processing_days",
    "due_anchor_at",
    "due_date_label",
    "due_date_status",
  ] as const) {
    const value = dueSpecs[key];
    if (value === null) {
      delete base[key];
    } else if (value !== undefined) {
      base[key] = value;
    }
  }
  return base;
}

export function normalizeDueDateMode(
  raw: unknown,
  hasAbsoluteDue: boolean
): DueDateMode | null {
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "fixed" || v === "after_approval") return v;
  }
  // Backward compat: absolute date only → fixed; empty → unknown/none
  if (hasAbsoluteDue) return "fixed";
  return null;
}

export function normalizeDueProcessingDays(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

export function normalizeDueDateStatus(
  raw: unknown,
  opts: {
    dueDate: string | null;
    mode: DueDateMode | null;
    processingDays: number | null;
  }
): DueDateStatus {
  if (typeof raw === "string") {
    const v = raw.trim().toLowerCase();
    if (v === "set" || v === "pending_approval" || v === "none") return v;
  }
  if (opts.dueDate) return "set";
  if (opts.mode === "after_approval" || opts.processingDays != null) {
    return "pending_approval";
  }
  return "none";
}

function parseAbsoluteDue(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

/**
 * Map CRM webhook due fields → Workflow due_date + specs.
 * Does not invent a calendar date when CRM sends an empty due_date.
 */
export function resolveWebhookDue(body: WebhookDueFields): ResolvedWebhookDue {
  const dueDate = parseAbsoluteDue(body.due_date);
  const mode = normalizeDueDateMode(body.due_date_mode, Boolean(dueDate));
  const processingDays = normalizeDueProcessingDays(body.due_processing_days);
  const status = normalizeDueDateStatus(body.due_date_status, {
    dueDate,
    mode,
    processingDays,
  });

  const label =
    typeof body.due_date_label === "string" && body.due_date_label.trim()
      ? body.due_date_label.trim()
      : null;

  const anchor =
    typeof body.due_anchor_at === "string" && body.due_anchor_at.trim()
      ? body.due_anchor_at.trim()
      : null;

  const specs: OrderDueSpecs = {};

  if (status === "set" || dueDate) {
    specs.due_date_status = "set";
    if (mode) specs.due_date_mode = mode;
    if (processingDays != null) specs.due_processing_days = processingDays;
    if (anchor) specs.due_anchor_at = anchor;
    if (label) specs.due_date_label = label;
    return { dueDate, specs };
  }

  if (mode === "after_approval" || status === "pending_approval") {
    const days = processingDays ?? DEFAULT_PROCESSING_DAYS;
    specs.due_date_mode = "after_approval";
    specs.due_processing_days = days;
    specs.due_date_status = "pending_approval";
    specs.due_date_label =
      label ?? `${days} working day${days === 1 ? "" : "s"} after approval`;
    if (anchor) specs.due_anchor_at = anchor;
    return { dueDate: null, specs };
  }

  if (mode === "fixed" && !dueDate) {
    specs.due_date_mode = "fixed";
    specs.due_date_status = "none";
    if (label) specs.due_date_label = label;
    return { dueDate: null, specs };
  }

  specs.due_date_status = "none";
  return { dueDate: null, specs };
}

/** Mon–Fri only. Start from the anchor's local calendar day, then add N weekdays. */
export function addWorkingDays(
  startDateYmd: string,
  workingDays: number
): string {
  const y = Number(startDateYmd.slice(0, 4));
  const m = Number(startDateYmd.slice(5, 7)) - 1;
  const d = Number(startDateYmd.slice(8, 10));
  const date = new Date(y, m, d);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date: ${startDateYmd}`);
  }

  let remaining = Math.max(0, Math.floor(workingDays));
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay(); // 0 Sun … 6 Sat
    if (day !== 0 && day !== 6) remaining -= 1;
  }

  const yy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function readOrderDueSpecs(specs: unknown): OrderDueSpecs {
  if (!specs || typeof specs !== "object") return {};
  const s = specs as Record<string, unknown>;
  const mode = normalizeDueDateMode(s.due_date_mode, false);
  const processingDays = normalizeDueProcessingDays(s.due_processing_days);
  const status =
    typeof s.due_date_status === "string"
      ? normalizeDueDateStatus(s.due_date_status, {
          dueDate: null,
          mode,
          processingDays,
        })
      : null;
  const label =
    typeof s.due_date_label === "string" && s.due_date_label.trim()
      ? s.due_date_label.trim()
      : null;
  const anchor =
    typeof s.due_anchor_at === "string" && s.due_anchor_at.trim()
      ? s.due_anchor_at.trim()
      : null;

  return {
    ...(mode ? { due_date_mode: mode } : {}),
    ...(processingDays != null ? { due_processing_days: processingDays } : {}),
    ...(status ? { due_date_status: status } : {}),
    ...(label ? { due_date_label: label } : {}),
    ...(anchor ? { due_anchor_at: anchor } : {}),
  };
}

/** Human label for board / PDF / emails. Prefer absolute date when set. */
export function formatOrderDueDisplay(
  dueDate: string | null | undefined,
  specs: unknown,
  formatAbsolute: (ymd: string) => string
): string {
  if (dueDate?.trim()) return formatAbsolute(dueDate.trim().slice(0, 10));
  const due = readOrderDueSpecs(specs);
  if (due.due_date_label) return due.due_date_label;
  if (
    due.due_date_status === "pending_approval" ||
    due.due_date_mode === "after_approval"
  ) {
    const days = due.due_processing_days ?? DEFAULT_PROCESSING_DAYS;
    return `${days} working day${days === 1 ? "" : "s"} after approval`;
  }
  return "—";
}

export function isPendingAfterApprovalDue(
  dueDate: string | null | undefined,
  specs: unknown
): boolean {
  if (dueDate?.trim()) return false;
  const due = readOrderDueSpecs(specs);
  return (
    due.due_date_status === "pending_approval" ||
    due.due_date_mode === "after_approval"
  );
}

/** Short chip text for board cards. */
export function formatPendingDueChipLabel(specs: unknown): string {
  const due = readOrderDueSpecs(specs);
  if (due.due_date_label) {
    // Prefer a compact form when the CRM label is long.
    const days = due.due_processing_days;
    if (days != null && /working day/i.test(due.due_date_label)) {
      return `${days} wd after approval`;
    }
    if (due.due_date_label.length <= 28) return due.due_date_label;
  }
  const days = due.due_processing_days ?? DEFAULT_PROCESSING_DAYS;
  return `${days} wd after approval`;
}
