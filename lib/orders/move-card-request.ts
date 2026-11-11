/**
 * Pure helpers for POST /api/export/move-card (Pulse "Approve to Production" / "Bring back to Prepress").
 * Kept free of I/O so the rules are unit-testable.
 */

import { isHoldColumn } from "../hold-column.ts";

export const MOVE_CARD_FROM_COLUMN = "Prepress";
export const MOVE_CARD_TO_COLUMN = "In Production";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Optional note posted to the card's Internal notes when it is parked on Hold (Pulse "Send Back"). */
export type MoveCardNote = { text: string; author: string; date?: string };

export type MoveCardRequest = { orderId: string; toColumn: string; note?: MoveCardNote };

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
  const note = parseMoveCardNote(b.note);
  return { ok: true, value: { orderId, toColumn, ...(note ? { note } : {}) } };
}

/** Text is capped; an unparseable date is dropped so the note is stamped "now". */
export function parseMoveCardNote(raw: unknown): MoveCardNote | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const text = typeof n.text === "string" ? n.text.trim().slice(0, 1000) : "";
  if (!text) return null;
  const author = typeof n.author === "string" ? n.author.trim().slice(0, 120) : "";
  const parsedDate =
    typeof n.date === "string" && !Number.isNaN(Date.parse(n.date))
      ? new Date(n.date).toISOString()
      : undefined;
  return { text, author: author || "Pulse", ...(parsedDate ? { date: parsedDate } : {}) };
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
 * The integration may only make the moves Pulse makes:
 *   - "Approve to Production":     Prepress → In Production
 *   - "Bring back to Prepress":    In Production → Prepress
 *   - "Send Back" (with a reason): Prepress → Hold
 * (The tenant secret can already read the whole board; it must not be able to shuffle cards anywhere.)
 */
export function decideIntegrationMove(
  fromName: string,
  toName: string
): IntegrationMoveDecision {
  const from = normalizeColumnName(fromName);
  const to = normalizeColumnName(toName);
  const prepress = normalizeColumnName(MOVE_CARD_FROM_COLUMN);
  const production = normalizeColumnName(MOVE_CARD_TO_COLUMN);
  const toHold = isHoldColumn({ name: toName });
  if (to !== production && to !== prepress && !toHold) {
    return {
      allowed: false,
      status: 403,
      error: `Only moves between "${MOVE_CARD_FROM_COLUMN}", "${MOVE_CARD_TO_COLUMN}" and Hold are allowed for this integration`,
    };
  }
  if (from === to) return { allowed: true, already: true };
  const expectedFrom = to === production || toHold ? prepress : production;
  if (from !== expectedFrom) {
    const expectedName = expectedFrom === prepress ? MOVE_CARD_FROM_COLUMN : MOVE_CARD_TO_COLUMN;
    return {
      allowed: false,
      status: 409,
      error: `Card is in "${fromName}" — only cards in "${expectedName}" can be moved to "${toName}"`,
    };
  }
  return { allowed: true, already: false };
}
