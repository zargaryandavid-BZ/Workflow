/**
 * Pure builder for the status callback Bazaar expects at
 * POST {bazaar_api_url}/api/v1/production/status.
 *
 * Verified Bazaar contract body:
 *   { order_number, column_name, moved_at, approval_url? }
 *   (moved_at = ISO move time; approval_url = customer proof-approval page)
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

export type BazaarPortalStatusPayload = {
  event: "job_status_update";
  order_number: string;
  column_name: string;
  moved_at: string;
  approval_url?: string;
};

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
}): BazaarPortalStatusPayload {
  const payload: BazaarPortalStatusPayload = {
    event: "job_status_update",
    order_number: args.orderNumber,
    column_name: args.columnName,
    moved_at: args.movedAt ?? new Date().toISOString(),
  };
  const approvalUrl = sanitizeApprovalUrl(args.approvalUrl);
  if (approvalUrl) payload.approval_url = approvalUrl;
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
 */
export function pickActiveApprovalToken(
  rows: ApprovalNotificationRow[],
  nowMs: number = Date.now()
): string | null {
  const sorted = [...rows].sort((a, b) => {
    const ta = a.created_at ? Date.parse(a.created_at) : 0;
    const tb = b.created_at ? Date.parse(b.created_at) : 0;
    return tb - ta;
  });
  for (const row of sorted) {
    if (!row.token) continue;
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
