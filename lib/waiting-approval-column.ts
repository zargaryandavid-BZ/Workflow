/**
 * Waiting Approval column: board kind `approval`, or a name like
 * "Waiting Approval". Used to rasterize proof pictures without a resend.
 */
export function isWaitingApprovalColumn(col: {
  kind?: string | null;
  name?: string | null;
} | null | undefined): boolean {
  if (!col) return false;
  if (col.kind === "approval") return true;
  return /waiting\s*approval/i.test(col.name ?? "");
}

/**
 * Columns where the "N working days after approval" clock has not started yet:
 * Waiting Approval plus the design stages before it (Start / Create Order,
 * Missing Info, Customer Replied). Hold is NOT included — approved jobs get
 * parked there too and must still show Late. Used only for due chips / Late /
 * Due-today counts (Hayk 2026-11-23: an unapproved Start card said "Due today").
 */
export function isApprovalClockColumn(col: {
  kind?: string | null;
  name?: string | null;
} | null | undefined): boolean {
  if (!col) return false;
  if (isWaitingApprovalColumn(col)) return true;
  if (col.kind === "exception") return true;
  return /\bstart\b|create\s*order|customer\s*replied|missing\s*info/i.test(
    col.name ?? ""
  );
}
