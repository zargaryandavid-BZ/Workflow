import type { OrderWithRelations } from "@/lib/types";

export interface SingleEntry {
  kind: "single";
  order: OrderWithRelations;
}

export interface GroupEntry {
  kind: "group";
  key: string;
  orders: OrderWithRelations[];
}

export type ColumnEntry = SingleEntry | GroupEntry;

/**
 * Returns the grouping key for an order:
 *  1. specs.webhook_order_number  — set by multi-item webhooks
 *  2. Title pattern "PREFIX-N"   — last dash-separated segment is all digits
 *  3. null                        — not part of any group
 */
export function getGroupKey(order: OrderWithRelations): string | null {
  const webhookKey =
    typeof order.specs?.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : null;
  if (webhookKey) return webhookKey;

  // e.g. "ORD-2026-0098-1" → "ORD-2026-0098"
  const match = order.title.match(/^(.+)-(\d+)$/);
  if (match) return match[1];

  return null;
}

/**
 * Groups orders that share the same key within a column.
 * Orders with no matching sibling remain as individual "single" entries.
 * The group key is only applied when ≥2 orders share it.
 */
export function groupOrdersForColumn(orders: OrderWithRelations[]): ColumnEntry[] {
  const keyCount = new Map<string, number>();
  for (const order of orders) {
    const key = getGroupKey(order);
    if (key) keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
  }

  // Only group keys that have 2+ members.
  const activeKeys = new Set<string>(
    [...keyCount.entries()].filter(([, count]) => count >= 2).map(([k]) => k)
  );

  const groups = new Map<string, OrderWithRelations[]>();
  const entries: ColumnEntry[] = [];

  // First pass: preserve original order and slot each order into its bucket.
  // We emit a placeholder for the group at the position of the first member.
  const emittedGroups = new Set<string>();

  for (const order of orders) {
    const key = getGroupKey(order);
    if (key && activeKeys.has(key)) {
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(order);
      if (!emittedGroups.has(key)) {
        emittedGroups.add(key);
        // Placeholder — replaced after collecting all members below.
        entries.push({ kind: "group", key, orders: groups.get(key)! });
      }
    } else {
      entries.push({ kind: "single", order });
    }
  }

  // The group entries already hold live references to the same array pushed
  // into `groups`, so they are already complete after the loop.
  return entries;
}

/**
 * Returns a display label for an individual item inside a group.
 * Prefers specs.webhook_item_title, then falls back to order.title.
 */
export function itemLabel(order: OrderWithRelations): string {
  const t = order.specs?.webhook_item_title;
  return typeof t === "string" && t.trim() ? t.trim() : order.title;
}

/**
 * Human-readable title after the source label (`CRM | …`).
 * Uses `specs.webhook_order_title` from the webhook `title` field.
 * Never shows the order number (ORD-…) — omit/empty leaves the label blank.
 */
export function sharedOrderTitle(
  order: {
    title?: string;
    specs?: Record<string, unknown> | null;
  }
): string | null {
  const t = order.specs?.webhook_order_title;
  if (typeof t !== "string") return null;
  const title = t.trim();
  if (!title) return null;
  // Legacy backfill stored ORD-YYYY-#### here — hide those from the label.
  if (/^ord-\d{4}-\S+$/i.test(title)) return null;
  return title;
}

export interface OrderGroupSearchSuggestion {
  key: string;
  /** e.g. "ORD-2026-0098-(3)" */
  label: string;
  parts: OrderWithRelations[];
}

/**
 * Multi-part order hints for the board filter (e.g. typing "XXX" → "XXX-(3)").
 * Only considers order titles / group keys — not customer name matches.
 */
export function orderGroupSearchSuggestions(
  query: string,
  orders: OrderWithRelations[]
): OrderGroupSearchSuggestion[] {
  const q = query.trim();
  // Ignore 1-char queries — too noisy for group hints.
  if (q.length < 2 || orders.length < 2) return [];

  const ql = q.toLowerCase();
  const byKey = new Map<string, OrderWithRelations[]>();
  for (const order of orders) {
    const key = getGroupKey(order);
    if (!key) continue;
    const list = byKey.get(key);
    if (list) list.push(order);
    else byKey.set(key, [order]);
  }

  const out: OrderGroupSearchSuggestion[] = [];
  for (const [key, parts] of byKey) {
    if (parts.length < 2) continue;
    const kl = key.toLowerCase();
    const titleHit = parts.some((p) => p.title.toLowerCase().includes(ql));
    const keyHit = kl.includes(ql) || ql.startsWith(kl);
    if (!titleHit && !keyHit) continue;

    // User already typed a specific part (XXX-1) and only that title matches — no hint.
    const matchingTitles = parts.filter((p) =>
      p.title.toLowerCase().includes(ql)
    );
    if (matchingTitles.length === 1 && /-\d+$/.test(q)) continue;

    out.push({
      key,
      label: `${key}-(${parts.length})`,
      parts: [...parts].sort((a, b) =>
        a.title.localeCompare(b.title, undefined, { numeric: true })
      ),
    });
  }

  return out.slice(0, 5);
}
