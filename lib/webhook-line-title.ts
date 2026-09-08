/** CRM line names look like `PO #117686 - 4 (…)` or `PO #117686-1- 2 skus…`. */

export function parseCrmPoLineNumber(title: string | null | undefined): number | null {
  const t = (title ?? "").trim();
  if (!t) return null;
  const spaced = t.match(/PO\s*#?\s*\d+\s+[-–]\s*(\d+)\b/i);
  if (spaced) {
    const n = Number(spaced[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  const glued = t.match(/PO\s*#?\s*\d+-(\d+)\s*[-–]/i);
  if (glued) {
    const n = Number(glued[1]);
    return Number.isInteger(n) && n > 0 ? n : null;
  }
  return null;
}

/** 1-based part number for a board card (`15137-4` or `webhook_item_index` + 1). */
export function cardPartNumber(order: {
  title?: string | null;
  specs?: Record<string, unknown> | null;
}): number | null {
  const specs = order.specs ?? null;
  const idx = specs?.webhook_item_index;
  if (typeof idx === "number" && Number.isInteger(idx) && idx >= 0) {
    return idx + 1;
  }
  const title = typeof order.title === "string" ? order.title.trim() : "";
  const m = title.match(/-(\d+)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function webhookItemDisplayTitle(item: {
  title?: string | null;
  [key: string]: unknown;
}): string {
  const rec = item as Record<string, unknown>;
  const candidates = [
    item.title,
    rec.name,
    rec.line_title,
    rec.item_title,
    rec.line_item_name,
  ];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return "";
}
