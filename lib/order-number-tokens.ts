/**
 * True when the query looks like an order number (e.g. `213`, `0213-1`),
 * not a name/email/phone search. Short digit strings must not match phone
 * area codes (e.g. `213` → `+1213…`).
 */
export function isOrderNumberQuery(q: string): boolean {
  return /^w?-?0*\d{1,8}(-\d+)?$/i.test(q.trim());
}

/** Same short number shown on board cards (`ORD-2026-0509` → `509`, website → `W509`). */
export function formatShortOrderNumber(title: string) {
  let s = title.trim();
  s = s.replace(/^ORD-\d{4}-/i, "");
  const web = /^w-?/i.test(s);
  if (web) s = s.replace(/^w-?/i, "");
  s = s.replace(/^0+(\d)/, "$1");
  return web ? `W${s}` : s;
}

/** Strip `#`, `W`, `ORD-YYYY-`, and leading zeros so `0467-2`, `W0467-2`, and `467-2` match. */
export function compactOrderNumberToken(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/^#/, "")
    .replace(/^w-?/, "")
    .replace(/^ord-\d{4}-/, "")
    .replace(/^0+(\d)/, "$1");
}

/**
 * Searchable order-number tokens for a card: title, CRM webhook order number,
 * short base (`ORD-2026-0509` → `0509`), and part suffix (`0509-11`).
 * Keeps renamed titles (product names) findable by original order number.
 */
export function orderNumberSearchHaystack(order: {
  title: string;
  specs?: Record<string, unknown> | null;
}): string {
  const parts: string[] = [order.title, formatShortOrderNumber(order.title)];
  const specs = order.specs ?? null;
  const won =
    typeof specs?.webhook_order_number === "string"
      ? specs.webhook_order_number.trim()
      : "";
  if (won) {
    parts.push(won);
    const match = /^ord-\d{4}-(.+)$/i.exec(won);
    const short = match?.[1]?.trim();
    if (short) {
      parts.push(short);
      const idx = specs?.webhook_item_index;
      if (typeof idx === "number" && Number.isFinite(idx)) {
        parts.push(`${short}-${Math.floor(idx) + 1}`);
      }
    }
  }
  const itemTitle =
    typeof specs?.webhook_item_title === "string"
      ? specs.webhook_item_title.trim()
      : "";
  if (itemTitle) parts.push(itemTitle);
  return parts.join(" ").toLowerCase();
}

export function orderMatchesNumberSearch(
  order: { title: string; specs?: Record<string, unknown> | null },
  q: string
): boolean {
  const raw = q.trim().replace(/^#/, "").toLowerCase();
  if (!raw) return false;
  const haystack = orderNumberSearchHaystack(order);
  if (haystack.includes(raw)) return true;
  const compactQ = compactOrderNumberToken(raw);
  if (!compactQ) return false;
  return haystack
    .split(/\s+/)
    .some((token) => compactOrderNumberToken(token).includes(compactQ));
}

/** Lower is a better typeahead hit (exact card #, then prefix, then contains). */
export function dieOrderNumberMatchRank(
  order: { title: string; specs?: Record<string, unknown> | null },
  q: string
): number {
  const compactQ = compactOrderNumberToken(q);
  if (!compactQ) return 99;
  const card = compactOrderNumberToken(formatShortOrderNumber(order.title));
  if (card === compactQ) return 0;
  if (card.startsWith(compactQ)) return 1;
  if (orderMatchesNumberSearch(order, q)) {
    return card.includes(compactQ) ? 2 : 3;
  }
  return 99;
}
