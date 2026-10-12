/**
 * Pure builder for the status callback Bazaar expects at
 * POST {bazaar_api_url}/api/v1/production/status.
 *
 * Verified Bazaar contract body:
 *   { order_number, column_name, moved_at, approval_url?, approval_status? }
 *   (moved_at = ISO move time; approval_url = customer proof-approval page;
 *    approval_status = outcome of the customer's proof round)
 *
 * `event` is kept for parity with the disconnect/test-connection calls that
 * already POST this endpoint; Bazaar ignores unknown fields.
 *
 * `approval_url` is OPTIONAL and ADDITIVE: the key is only present when a
 * valid absolute http(s) URL is supplied, so payloads without an approval
 * link are byte-for-byte what they were before.
 *
 * Kept dependency-free so it can be unit-tested under the node test runner.
 */

/**
 * Outcome of the customer's proof-approval round, as the portal shows it:
 *   - "approved" / "rejected": the customer (or staff, for a manual approve)
 *     decided; "rejected" covers "Not approved" / "changes requested".
 *   - "pending": a NEW round just opened (link created/sent), so any earlier
 *     decision on the portal is stale and should be cleared.
 */
export type BazaarPortalApprovalStatus = "approved" | "rejected" | "pending";

export type BazaarPortalStatusPayload = {
  event: "job_status_update";
  order_number: string;
  column_name: string;
  moved_at: string;
  approval_url?: string;
  approval_status?: BazaarPortalApprovalStatus;
};

/**
 * Normalizes an approval outcome to what Bazaar accepts. Accepts the Workflow's
 * own vocabulary too: the customer response "changes_requested" (Not approved)
 * is a rejection. Anything else -> null (the key is then omitted).
 */
export function sanitizeApprovalStatus(
  raw: unknown
): BazaarPortalApprovalStatus | null {
  if (typeof raw !== "string") return null;
  const key = raw.trim().toLowerCase();
  if (key === "approved") return "approved";
  if (key === "rejected" || key === "changes_requested") return "rejected";
  if (key === "pending") return "pending";
  return null;
}

/**
 * Bazaar only persists an absolute http(s) URL (javascript:, data:, relative
 * and junk are rejected there). Mirror that here so we never send a value that
 * will be thrown away. Returns the trimmed URL or null.
 */
export function sanitizeApprovalUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return trimmed;
}

export function buildBazaarPortalStatusPayload(args: {
  orderNumber: string;
  columnName: string;
  movedAt?: string;
  /** Customer proof-approval page for this card, when one exists. */
  approvalUrl?: string | null;
  /** Outcome of the customer's proof round, when this callback carries one. */
  approvalStatus?: string | null;
}): BazaarPortalStatusPayload {
  const payload: BazaarPortalStatusPayload = {
    event: "job_status_update",
    order_number: args.orderNumber,
    column_name: args.columnName,
    moved_at: args.movedAt ?? new Date().toISOString(),
  };
  const approvalUrl = sanitizeApprovalUrl(args.approvalUrl);
  if (approvalUrl) payload.approval_url = approvalUrl;
  const approvalStatus = sanitizeApprovalStatus(args.approvalStatus);
  if (approvalStatus) payload.approval_status = approvalStatus;
  return payload;
}

/** Row shape read from job_notifications to find a live approval round. */
export type ApprovalNotificationRow = {
  token: string;
  status: string | null;
  channel: string | null;
  token_expires_at: string | null;
  created_at: string | null;
};

/**
 * Picks the customer-approval round whose link is actually live:
 *   - `sent`                         -> the link went out to the customer
 *   - `pending` + channel `manual`   -> staff will hand the link over themselves
 * `pending` + email/sms/both means the send is queued or failed (the proof gate
 * is still holding it) and `pending` + none means staff skipped it, so those
 * are NOT live. Expired / responded rounds are never live. Newest round wins.
 *
 * `includeResponded` (used only when reporting a DECISION back to the portal):
 * a `responded` round also counts, and is never treated as expired - the
 * /respond page keeps showing the customer's recorded decision for it, which is
 * exactly the page the broker wants to re-open after the decision.
 */
export function pickActiveApprovalToken(
  rows: ApprovalNotificationRow[],
  nowMs: number = Date.now(),
  opts: { includeResponded?: boolean } = {}
): string | null {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
  for (const row of sorted) {
    if (!row.token) continue;
    if (opts.includeResponded && row.status === "responded") return row.token;
    const live =
      row.status === "sent" ||
      (row.status === "pending" && row.channel === "manual");
    if (!live) continue;
    if (row.token_expires_at) {
      const exp = Date.parse(row.token_expires_at);
      if (!Number.isNaN(exp) && exp <= nowMs) continue;
    }
    return row.token;
  }
  return null;
}
