import type { ApprovalStatus, CustomerResponse } from "@/lib/types";

/** Customer “request changes” is the same board move as rejection. */
export function isApprovalRejection(result: string | null | undefined): boolean {
  return result === "rejected" || result === "changes_requested";
}

export function customerResponseToApprovalResult(
  response: CustomerResponse
): ApprovalStatus | null {
  if (response === "approved") return "approved";
  if (response === "changes_requested") return "rejected";
  return null;
}

/**
 * Target column from the Waiting Approval notify rule, or `undefined` to
 * fall through to global `on_approval_result` rules.
 */
export function notifyRuleApprovalTarget(
  notifyRule: {
    to_column?: string | null;
    config?: {
      rejected_to_column?: string | null;
    } | null;
  } | null
  | undefined,
  result: ApprovalStatus | "changes_requested"
): string | undefined {
  if (!notifyRule) return undefined;
  if (result === "approved" && notifyRule.to_column) {
    return notifyRule.to_column;
  }
  const rejectedTo = notifyRule.config?.rejected_to_column;
  if (isApprovalRejection(result) && rejectedTo) {
    return rejectedTo;
  }
  return undefined;
}
