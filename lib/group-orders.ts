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

const GROUP_DRAG_PREFIX = "group:";

/** Drop extra copies of the same order (page refresh + Load more can race). */
export function uniqueOrdersById<T extends { id: string }>(orders: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const order of orders) {
    if (seen.has(order.id)) continue;
    seen.add(order.id);
    out.push(order);
  }
  return out;
}

/** Stable dnd-kit id for a same-column group card. */
export function groupDragId(columnId: string, key: string): string {
  return `${GROUP_DRAG_PREFIX}${columnId}:${key}`;
}

/** Parse a group drag id; returns null for order/column ids. */
export function parseGroupDragId(
  id: string
): { columnId: string; key: string } | null {
  if (!id.startsWith(GROUP_DRAG_PREFIX)) return null;
  const rest = id.slice(GROUP_DRAG_PREFIX.length);
  const sep = rest.indexOf(":");
  if (sep <= 0 || sep === rest.length - 1) return null;
  return { columnId: rest.slice(0, sep), key: rest.slice(sep + 1) };
}

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
  const unique = uniqueOrdersById(orders);
  const keyCount = new Map<string, number>();
  for (const order of unique) {
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

  for (const order of unique) {
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
    webhook_source?: string | null;
    specs?: Record<string, unknown> | null;
  }
): string | null {
  const specs = order.specs ?? null;
  // Portal cards: show partner/broker name after "Portal |"
  if (
    (order.webhook_source ?? "").trim().toLowerCase() === "portal" ||
    (typeof order.specs?.bazaar_broker_id === "string" &&
      order.specs.bazaar_broker_id.trim())
  ) {
    const company = specs?.company_name;
    if (typeof company === "string" && company.trim()) return company.trim();
  }
  const t = specs?.webhook_order_title;
  if (typeof t !== "string") return null;
  const title = t.trim();
  if (!title) return null;
  // Legacy backfill stored ORD-YYYY-#### here — hide those from the label.
  if (/^ord-\d{4}-\S+$/i.test(title)) return null;
  // Hide BZ-* refs from the source label (card title already shows the ref).
  if (/^bz-\d+/i.test(title)) return null;
  // "[Partner] BZ-123" → Partner
  const bracket = title.match(/^\[([^\]]+)\]/);
  if (bracket?.[1]?.trim()) return bracket[1].trim();
  return title;
}

/**
 * Title shown on an individual PART card (the `CRM | …` label on OrderCard /
 * board-table rows / the card detail header).
 *
 * A multi-item order is split into one card per line item; each line carries
 * its OWN title in `specs.webhook_item_title` (stamped by the order webhook).
 * That per-line title is what distinguishes the parts, so it wins here. When a
 * multi-item part has no own title, fall back to its product — never the
 * shared order title, which is identical on every sibling and hides which part
 * is which. Single-item orders have no per-line title, so their card legitimately
 * shows the order-level title ({@link sharedOrderTitle}).
 */
export function partCardTitle(
  order: {
    title?: string;
    webhook_source?: string | null;
    specs?: Record<string, unknown> | null;
  },
  productFallback?: string | null
): string | null {
  const specs = order.specs ?? null;
  const itemTitle =
    typeof specs?.webhook_item_title === "string"
      ? specs.webhook_item_title.trim()
      : "";
  if (itemTitle) return itemTitle;

  // Multi-item part (stamped with an item index) but no own title → product,
  // so each part stays distinguishable rather than repeating the order title.
  if (typeof specs?.webhook_item_index === "number") {
    const product =
      typeof productFallback === "string" ? productFallback.trim() : "";
    return product || null;
  }

  // Single-item order: the order-level title is this card's title.
  const shared = sharedOrderTitle(order);
  if (shared) return shared;
  // Manual card (no webhook origin) has no webhook_order_title, so it would
  // otherwise render blank and fall back to the customer name. Show the
  // staff-typed order title instead. CRM/webhook cards are untouched.
  if (!order.webhook_source) {
    const typed = typeof order.title === "string" ? order.title.trim() : "";
    if (typed && !/^ord-\d{4}-\S+$/i.test(typed)) return typed;
  }
  return null;
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

const MAX_SIBLING_KEYS = 40;

/**
 * Keys used to pull same-column group siblings that pagination would omit.
 * Webhook numbers and title prefixes are listed separately for PostgREST filters.
 */
export function groupingKeysForSiblingFetch(
  orders: Array<{
    title: string;
    specs?: Record<string, unknown> | null;
  }>
): { webhookKeys: string[]; titlePrefixes: string[] } {
  const webhookKeys: string[] = [];
  const titlePrefixes: string[] = [];
  const seenWebhook = new Set<string>();
  const seenTitle = new Set<string>();

  for (const order of orders) {
    const webhookKey =
      typeof order.specs?.webhook_order_number === "string"
        ? order.specs.webhook_order_number.trim()
        : "";
    if (webhookKey) {
      if (!seenWebhook.has(webhookKey) && webhookKeys.length < MAX_SIBLING_KEYS) {
        seenWebhook.add(webhookKey);
        webhookKeys.push(webhookKey);
      }
      continue;
    }
    const match = order.title.match(/^(.+)-(\d+)$/);
    if (!match) continue;
    const prefix = match[1];
    if (!seenTitle.has(prefix) && titlePrefixes.length < MAX_SIBLING_KEYS) {
      seenTitle.add(prefix);
      titlePrefixes.push(prefix);
    }
  }

  return { webhookKeys, titlePrefixes };
}
