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
