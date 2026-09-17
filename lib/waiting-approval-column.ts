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
