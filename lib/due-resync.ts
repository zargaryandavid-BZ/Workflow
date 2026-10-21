/**
 * Staff due-date edits vs. CRM / website / portal re-syncs.
 *
 * The CRM and the Bazaar website re-fire the order webhook whenever an order is
 * edited upstream (`updateExistingOrdersDue` / `refreshPortalOrdersFromWebhook`
 * in lib/webhook-order.ts, and the CRM v2 path in lib/webhook-v2.ts). Those
 * re-fires used to write the inbound `due_date` straight onto the card — so a
 * re-fire that carried NO date (portal Order Sync never sends one; CRM
 * after-approval re-fires send none) cleared a date staff had set, and a re-fire
 * with a date replaced it. (BZ-418 / BZ-420, 2026-10-21: staff set Fri Oct 23,
 * an admin edit on the website re-synced and the card lost its due date.)
 *
 * Rule (bookkeeping lives inside `specs` — no migration):
 * - When staff set a due date in Workflow, `specs.due_staff_edited_at`
 *   (+ `due_staff_edited_by`) is stamped. Clearing the date removes the stamp
 *   (so the source's date can flow in again).
 * - A re-sync NEVER clears an existing due date: inbound "no date" keeps the
 *   card's current date + due_* specs (whoever set it — staff, an approval move,
 *   or the source earlier).
 * - A re-sync NEVER replaces a staff-set due date. Staff value wins. Cards set
 *   by staff before this rule existed have no stamp; for those the caller passes
 *   `legacyStaffSet` (activity log shows a person set the current value).
 * - Otherwise (card has no date, or the date came from the source) the inbound
 *   date is applied, exactly as before.
 *
 * Pure helpers only (no Supabase / Next imports) so node:test can load them.
 */

export const DUE_STAFF_EDITED_AT_KEY = "due_staff_edited_at";
export const DUE_STAFF_EDITED_BY_KEY = "due_staff_edited_by";

/** Server-owned spec keys a client save must never overwrite. */
export const DUE_SYNC_SPEC_KEYS = [
  DUE_STAFF_EDITED_AT_KEY,
  DUE_STAFF_EDITED_BY_KEY,
] as const;

function ymd(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const t = value.trim();
  return t ? t.slice(0, 10) : null;
}

/** True when the card's due date was stamped as a staff edit. */
export function hasStaffDueStamp(specs: Record<string, unknown> | null | undefined): boolean {
  const v = specs?.[DUE_STAFF_EDITED_AT_KEY];
  return typeof v === "string" && v.trim().length > 0;
}

export type DueResyncDecision =
  | { action: "apply"; dueDate: string | null }
  | { action: "keep"; reason: "inbound_empty" | "staff_set"; dueDate: string };

/**
 * Decide what a re-sync does to an existing card's due date.
 * `inboundDueDate` is what the source sent (after after-approval recompute).
 */
export function resolveInboundDueResync(params: {
  existingDueDate: string | null | undefined;
  existingSpecs: Record<string, unknown> | null | undefined;
  inboundDueDate: string | null | undefined;
  /** Activity log shows a person set the CURRENT value (pre-stamp cards). */
  legacyStaffSet?: boolean;
}): DueResyncDecision {
  const existing = ymd(params.existingDueDate);
  const inbound = ymd(params.inboundDueDate);
  if (!existing) return { action: "apply", dueDate: inbound };
  if (!inbound) return { action: "keep", reason: "inbound_empty", dueDate: existing };
  if (inbound === existing) return { action: "apply", dueDate: inbound };
  if (hasStaffDueStamp(params.existingSpecs) || params.legacyStaffSet === true) {
    return { action: "keep", reason: "staff_set", dueDate: existing };
  }
  return { action: "apply", dueDate: inbound };
}

/**
 * True when we need the activity-log lookup to know whether staff set the
 * current value (no stamp, and the inbound date would replace it).
 */
export function needsLegacyStaffCheck(params: {
  existingDueDate: string | null | undefined;
  existingSpecs: Record<string, unknown> | null | undefined;
  inboundDueDate: string | null | undefined;
}): boolean {
  const existing = ymd(params.existingDueDate);
  const inbound = ymd(params.inboundDueDate);
  return (
    !!existing &&
    !!inbound &&
    existing !== inbound &&
    !hasStaffDueStamp(params.existingSpecs)
  );
}

/**
 * Given the card's activity rows (newest first), true when the most recent
 * "Due date" change was made by a person and set the current value.
 */
export function activityShowsStaffDue(
  rows: readonly { actor: string | null; metadata: unknown }[],
  currentDueDate: string | null | undefined
): boolean {
  const current = ymd(currentDueDate);
  if (!current) return false;
  for (const row of rows) {
    const changes = (row.metadata as { changes?: unknown } | null)?.changes;
    if (!Array.isArray(changes)) continue;
    const due = changes.find(
      (c) => (c as { field?: unknown } | null)?.field === "Due date"
    ) as { to?: unknown } | undefined;
    if (!due) continue;
    return !!row.actor && ymd(due.to) === current;
  }
  return false;
}

/**
 * Stamp / clear the staff due-date marker for a staff save. Call only when the
 * due date actually changed. Returns a new specs object.
 */
export function applyStaffDueEdit(
  specs: Record<string, unknown>,
  nextDueDate: string | null | undefined,
  opts: { userId: string | null; now?: Date }
): Record<string, unknown> {
  const out = { ...specs };
  if (ymd(nextDueDate)) {
    out[DUE_STAFF_EDITED_AT_KEY] = (opts.now ?? new Date()).toISOString();
    if (opts.userId) out[DUE_STAFF_EDITED_BY_KEY] = opts.userId;
    else delete out[DUE_STAFF_EDITED_BY_KEY];
  } else {
    delete out[DUE_STAFF_EDITED_AT_KEY];
    delete out[DUE_STAFF_EDITED_BY_KEY];
  }
  return out;
}

/** Keep server-owned due bookkeeping from the stored specs (ignore client values). */
export function preserveDueSyncKeys(
  existingSpecs: Record<string, unknown>,
  nextSpecs: Record<string, unknown>
): Record<string, unknown> {
  const out = { ...nextSpecs };
  for (const k of DUE_SYNC_SPEC_KEYS) {
    if (k in existingSpecs) out[k] = existingSpecs[k];
    else delete out[k];
  }
  return out;
}
