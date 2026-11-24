/**
 * Pure helpers for the single-card approval page (/respond/[token]) showing
 * every line item of the same order (Hayk 2026-11-23: MJ Pak 15809-1/-2/-3
 * got three separate links and each only showed its own item).
 *
 * Kept import-free so it runs under `node --test`.
 */

export type SiblingCandidate = {
  id: string;
  title: string;
  tenant_id: string;
  removed_at?: string | null;
  specs?: Record<string, unknown> | null;
};

export type SiblingApprovalRow = {
  id: string;
  token: string;
  status: string;
  customer_response: string | null;
  token_expires_at: string | null;
};

export type SiblingItemStatus = "waiting" | "pending" | "approved" | "rejected";

/** `specs.webhook_order_number` trimmed, or null. */
export function webhookOrderKey(
  specs: Record<string, unknown> | null | undefined
): string | null {
  const raw = specs?.webhook_order_number;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key ? key : null;
}

/** "15809-2" → "15809"; titles without a "-N" suffix → null. */
export function titleOrderBase(title: string): string | null {
  const match = title.trim().match(/^(.+)-(\d+)$/);
  return match ? match[1]!.trim() || null : null;
}

/**
 * Line items of the same order as `seed`, seed included, sorted by title
 * (15809-1, 15809-2, …). A candidate qualifies only when it is in the same
 * tenant, not removed, and either shares the seed's webhook order number or
 * shares its "NNNN-" title base without carrying a *different* webhook order
 * number (that would be another customer's order that happens to collide).
 */
export function selectOrderSiblings<T extends SiblingCandidate>(
  seed: T,
  candidates: T[]
): T[] {
  const seedWebhook = webhookOrderKey(seed.specs);
  const seedBase = titleOrderBase(seed.title);
  const byId = new Map<string, T>();
  byId.set(seed.id, seed);

  for (const c of candidates) {
    if (!c || c.id === seed.id) continue;
    if (c.tenant_id !== seed.tenant_id) continue;
    if (c.removed_at) continue;
    const cWebhook = webhookOrderKey(c.specs);
    const sameWebhook = seedWebhook != null && cWebhook === seedWebhook;
    const conflictingWebhook =
      seedWebhook != null && cWebhook != null && cWebhook !== seedWebhook;
    const sameBase =
      seedBase != null && titleOrderBase(c.title) === seedBase;
    if (sameWebhook || (sameBase && !conflictingWebhook)) {
      byId.set(c.id, c);
    }
  }

  return [...byId.values()].sort((a, b) =>
    a.title.localeCompare(b.title, undefined, { numeric: true })
  );
}

/** Open (pending/sent) and not past its expiry. */
export function isLiveApprovalRow(
  row: Pick<SiblingApprovalRow, "status" | "token_expires_at"> | null | undefined,
  nowMs: number
): boolean {
  if (!row) return false;
  if (row.status !== "pending" && row.status !== "sent") return false;
  if (row.token_expires_at == null) return true;
  const exp = new Date(row.token_expires_at).getTime();
  return Number.isFinite(exp) ? exp > nowMs : true;
}

/**
 * Latest round → list status + which token (if any) the page may hand to the
 * browser. Only a live request (actionable) or a decided round (to show the
 * result) exposes its token; no round / expired round → "pending" (Not ready
 * yet) with no token.
 */
export function siblingApprovalState(
  row: SiblingApprovalRow | null | undefined,
  nowMs: number
): { status: SiblingItemStatus; token: string | null } {
  if (!row) return { status: "pending", token: null };
  if (isLiveApprovalRow(row, nowMs)) {
    return { status: "waiting", token: row.token };
  }
  if (row.status === "responded") {
    if (row.customer_response === "approved") {
      return { status: "approved", token: row.token };
    }
    if (row.customer_response === "changes_requested") {
      return { status: "rejected", token: row.token };
    }
  }
  return { status: "pending", token: null };
}

/** Latest row per order id from rows already sorted newest-first. */
export function latestRowPerOrder<R extends { order_id: string }>(
  rowsNewestFirst: R[]
): Map<string, R> {
  const map = new Map<string, R>();
  for (const row of rowsNewestFirst) {
    if (!map.has(row.order_id)) map.set(row.order_id, row);
  }
  return map;
}
