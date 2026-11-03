/**
 * Pure helpers for POST /api/export/move-card (Pulse "Approve to Production").
 * Kept free of I/O so the rules are unit-testable.
 */

export const MOVE_CARD_FROM_COLUMN = "Prepress";
export const MOVE_CARD_TO_COLUMN = "In Production";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type MoveCardRequest = { orderId: string; toColumn: string };

export type ParsedMoveCardBody =
  | { ok: true; value: MoveCardRequest }
  | { ok: false; error: string };

/** Column names are compared ignoring case and surrounding / repeated spaces ("Pickups " vs "Pickups"). */
export function normalizeColumnName(name: unknown): string {
  return typeof name === "string" ? name.trim().replace(/\s+/g, " ").toLowerCase() : "";
}

export function parseMoveCardBody(body: unknown): ParsedMoveCardBody {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const orderId = typeof b.order_id === "string" ? b.order_id.trim() : "";
  const toColumn = typeof b.to_column === "string" ? b.to_column.trim() : "";
  if (!orderId || !toColumn) {
    return { ok: false, error: "order_id and to_column are required" };
  }
  if (!UUID_RE.test(orderId)) {
    return { ok: false, error: "order_id must be the Workflow card id (uuid)" };
  }
  return { ok: true, value: { orderId, toColumn } };
}

export function findColumnByName<T extends { name: string }>(
  columns: T[],
  name: string
): T | null {
  const want = normalizeColumnName(name);
  if (!want) return null;
  return columns.find((c) => normalizeColumnName(c.name) === want) ?? null;
}

export type IntegrationMoveDecision =
  | { allowed: true; already: false }
  | { allowed: true; already: true }
  | { allowed: false; status: number; error: string };

/**
 * The integration may only release a card from Prepress to In Production — the one move Pulse makes.
 * (The tenant secret can already read the whole board; it must not be able to shuffle cards anywhere.)
 */
export function decideIntegrationMove(
  fromName: string,
  toName: string
): IntegrationMoveDecision {
  const from = normalizeColumnName(fromName);
  const to = normalizeColumnName(toName);
  if (to !== normalizeColumnName(MOVE_CARD_TO_COLUMN)) {
    return {
      allowed: false,
      status: 403,
      error: `Only moves to "${MOVE_CARD_TO_COLUMN}" are allowed for this integration`,
    };
  }
  if (from === to) return { allowed: true, already: true };
  if (from !== normalizeColumnName(MOVE_CARD_FROM_COLUMN)) {
    return {
      allowed: false,
      status: 409,
      error: `Card is in "${fromName}" — only cards in "${MOVE_CARD_FROM_COLUMN}" can be released to "${MOVE_CARD_TO_COLUMN}"`,
    };
  }
  return { allowed: true, already: false };
}
