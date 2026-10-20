/**
 * Free-form SKU list ("SKU registration" paste box) → SKU rows.
 *
 * Same parsing rule as the CRM Bazaar builder (david-bazaar-crm
 * lib/bazaar/design-list.ts) and the broker portal (bazaar-website
 * packages/api/src/services/designList.ts — portal-design-list.tsx imports
 * it): one SKU per line, the quantity is a trailing number that is its OWN
 * token (preceded by line start, whitespace, comma or semicolon), with
 * optional thousands separators and an optional unit word. Lines with no
 * trailing quantity are name-only rows (qty stays blank).
 *
 * Workflow extras on top of that rule (a line the shared parser already reads
 * gives the same result here; these only rescue lines it would read as
 * name-only or with a junk name):
 *  - "Lemon x 500" / "Lemon x500" / "Lemon × 500" / "Lemon = 500" /
 *    "Lemon (500)" / "Lemon qty: 500" — separator before the qty.
 *  - Tab-separated cells pasted from Excel / Sheets: the last cell that is a
 *    pure number is the qty (qty may also be the first column), other cells
 *    form the name.
 *  - CSV quotes ("Mango, Ripe",1200) are stripped from the name.
 *  - Leading bullets / numbering ("- ", "• ", "1. ", "2) ") are dropped.
 *  - A header row ("SKU<TAB>Qty", "Name, Quantity", "Flavor qty") is skipped.
 *
 * Pure helpers only (no React / Supabase) so node:test can load them.
 */

/** Trailing-quantity rule — byte-identical to the CRM + portal parser. */
const TRAILING_QTY =
  /(^|[\s,;])(\d{1,3}(?:[,.   ]\d{3})+|\d+)(?:\s*(?:pcs?|pieces?|labels?|units?|ea|qty)\.?)?\s*$/i;

/** Same as the CRM / portal `parseDesignLine` (one parser everywhere). */
export function parseDesignLine(raw: string): { name: string; qty: string } {
  const line = (raw ?? "").trim();
  if (!line) return { name: "", qty: "" };
  const m = line.match(TRAILING_QTY);
  let name = line;
  let qty = "";
  if (m && m.index != null) {
    const digits = (m[2] ?? "").replace(/[^0-9]/g, "");
    if (digits) {
      qty = digits;
      name = line.slice(0, m.index + (m[1] ?? "").length);
    }
  }
  name = name.replace(/[\s,;:·–—-]+$/u, "").trim();
  return { name, qty };
}

/** A cell that is only a quantity ("1200", "1,200", "1 200 pcs"). */
const QTY_CELL =
  /^(\d{1,3}(?:[,.   ]\d{3})+|\d+)(?:\s*(?:pcs?|pieces?|labels?|units?|ea|qty)\.?)?$/i;

const HEADER_LINE =
  /^(?:sku|skus|name|names|sku name|design|designs|flavou?rs?|items?|products?|variants?|versions?)\s*[\t,;:|-]?\s*(?:qty|quantity|quantities|count|amount|pcs)\.?$/i;

export type SkuPasteStatus =
  /** name + quantity */
  | "ok"
  /** name only — applied with a blank quantity */
  | "no_qty"
  /** no name could be read (e.g. a bare number) — not applied */
  | "no_name"
  /** column header row — skipped */
  | "header";

export type SkuPasteLine = {
  /** 1-based line number in the pasted text (blank lines count). */
  lineNo: number;
  raw: string;
  name: string;
  /** null when the line has no quantity. */
  qty: number | null;
  status: SkuPasteStatus;
};

function unquote(value: string): string {
  let v = value.trim();
  if (v.length >= 2 && /^["'“”‘’]/.test(v) && /["'“”‘’]$/.test(v)) {
    v = v.slice(1, -1).trim();
  }
  return v.replace(/""/g, '"');
}

function toQty(digits: string): number | null {
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function stripBullet(line: string): string {
  return line.replace(/^(?:[-*•·▪◦]\s+|\d{1,3}[.)]\s+)/u, "");
}

/** Rescue "x 500" / "× 500" / "= 500" / "(500)" / "qty: 500" endings. */
function normalizeQtySeparators(line: string): string {
  return line
    .replace(/\(\s*(\d[\d,.   ]*)\s*\)\s*$/u, " $1")
    .replace(/\s+[x×]\s*(\d[\d,.   ]*)$/iu, " $1")
    .replace(/\s*=\s*(\d[\d,.   ]*)$/u, " $1")
    .replace(/[\s,;:-]*\b(?:qty|quantity)\s*[:=#]?\s*(\d[\d,.   ]*)$/iu, " $1");
}

function parseTabLine(line: string): { name: string; qty: string } | null {
  if (!line.includes("\t")) return null;
  const cells = line
    .split("\t")
    .map(unquote)
    .filter((c) => c.length > 0);
  if (cells.length < 2) return null;
  let qtyIdx = -1;
  for (let i = cells.length - 1; i >= 0; i--) {
    if (QTY_CELL.test(cells[i]!)) {
      qtyIdx = i;
      break;
    }
  }
  if (qtyIdx < 0) return { name: cells.join(" "), qty: "" };
  const qty = (cells[qtyIdx]!.match(QTY_CELL)?.[1] ?? "").replace(/[^0-9]/g, "");
  const name = cells.filter((_, i) => i !== qtyIdx).join(" ");
  return { name, qty };
}

/** Parse one pasted line. */
export function parseSkuPasteLine(raw: string): Omit<SkuPasteLine, "lineNo"> {
  const original = raw ?? "";
  const trimmed = original.trim();
  if (!trimmed) return { raw: original, name: "", qty: null, status: "no_name" };

  const line = stripBullet(trimmed);
  if (HEADER_LINE.test(line.replace(/\t+/g, " ").replace(/\s+/g, " ").trim())) {
    return { raw: original, name: "", qty: null, status: "header" };
  }

  const tab = parseTabLine(line);
  let { name, qty } = tab ?? parseDesignLine(normalizeQtySeparators(line));
  name = unquote(name.replace(/[\s,;:·–—-]+$/u, "")).trim();
  // "Lemon x" can be left when "x" was the separator and the shared rule
  // already took the number.
  name = name.replace(/\s+[x×=]$/iu, "").trim();

  const qtyNum = toQty(qty);
  if (!name) {
    return { raw: original, name: "", qty: qtyNum, status: "no_name" };
  }
  return {
    raw: original,
    name,
    qty: qtyNum,
    status: qtyNum == null ? "no_qty" : "ok",
  };
}

/** Whole pasted block → one result per non-blank line. */
export function parseSkuPasteText(text: string | null | undefined): SkuPasteLine[] {
  const lines = (typeof text === "string" ? text : "").split(/\r\n|\r|\n/);
  const out: SkuPasteLine[] = [];
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    out.push({ lineNo: i + 1, ...parseSkuPasteLine(raw) });
  });
  return out;
}

/** True when the line becomes a SKU row on Apply. */
export function isApplicablePasteLine(line: SkuPasteLine): boolean {
  return line.status === "ok" || line.status === "no_qty";
}

export type PasteSummary = {
  rows: number;
  withQty: number;
  missingQty: number;
  unparsed: number;
  headers: number;
  total: number;
};

export function summarizeSkuPaste(lines: readonly SkuPasteLine[]): PasteSummary {
  let rows = 0;
  let withQty = 0;
  let missingQty = 0;
  let unparsed = 0;
  let headers = 0;
  let total = 0;
  for (const l of lines) {
    if (l.status === "header") headers += 1;
    else if (l.status === "no_name") unparsed += 1;
    else {
      rows += 1;
      if (l.qty != null) {
        withQty += 1;
        total += l.qty;
      } else missingQty += 1;
    }
  }
  return { rows, withQty, missingQty, unparsed, headers, total };
}

type RowLike = { id: string; name: string; qty: number | null };

/** Rows → "Name Qty" lines (same text format as the CRM / portal box). */
export function serializeSkuRows(rows: readonly { name: string; qty: number | null }[]): string {
  return rows
    .map((r) => {
      const name = (r.name ?? "").trim();
      const qty =
        typeof r.qty === "number" && Number.isFinite(r.qty) && r.qty > 0
          ? String(Math.floor(r.qty))
          : "";
      if (!name && !qty) return "";
      return qty ? `${name} ${qty}`.trim() : name;
    })
    .filter((l) => l.length > 0)
    .join("\n");
}

function contentKey(rows: readonly { name: string; qty: number | null }[]): string {
  return JSON.stringify(
    rows
      .map((r) => [
        (r.name ?? "").trim(),
        typeof r.qty === "number" && Number.isFinite(r.qty) && r.qty > 0 ? r.qty : null,
      ])
      .filter(([n, q]) => n !== "" || q !== null)
  );
}

/**
 * True when the text box and the rows say the same thing (every applicable
 * line, in order, equals the rows' names + quantities). Blank text never
 * "matches" a non-empty row list.
 */
export function skuTextMatchesRows(
  text: string | null | undefined,
  rows: readonly { name: string; qty: number | null }[]
): boolean {
  const parsed = parseSkuPasteText(text).filter(isApplicablePasteLine);
  return contentKey(parsed) === contentKey(rows);
}

/**
 * Apply parsed lines to the current rows.
 *  - mode "replace": the list becomes exactly the parsed lines; existing row
 *    ids are reused (same name first, then same position) so per-SKU artwork
 *    stays attached.
 *  - mode "append": parsed lines are added after the current rows (blank
 *    current rows are dropped first).
 * `skip` = line numbers the user unticked in the preview.
 */
export function applySkuPaste<T extends RowLike>(
  current: readonly T[],
  lines: readonly SkuPasteLine[],
  opts: {
    mode: "replace" | "append";
    skip?: ReadonlySet<number>;
    newId: () => string;
  }
): RowLike[] {
  const picked = lines.filter(
    (l) => isApplicablePasteLine(l) && !(opts.skip?.has(l.lineNo) ?? false)
  );
  if (opts.mode === "append") {
    const kept = current
      .filter((r) => r.name.trim() || r.qty != null)
      .map((r) => ({ id: r.id, name: r.name, qty: r.qty }));
    return [
      ...kept,
      ...picked.map((l) => ({ id: opts.newId(), name: l.name, qty: l.qty })),
    ];
  }

  const used = new Set<string>();
  const result: RowLike[] = picked.map((l) => ({ id: "", name: l.name, qty: l.qty }));
  // Same name (case-insensitive) first.
  result.forEach((r) => {
    const key = r.name.trim().toLowerCase();
    const hit = current.find(
      (c) => !used.has(c.id) && c.name.trim().toLowerCase() === key && key !== ""
    );
    if (hit) {
      used.add(hit.id);
      r.id = hit.id;
    }
  });
  // Then same position.
  result.forEach((r, i) => {
    if (r.id) return;
    const byPos = current[i];
    if (byPos && !used.has(byPos.id)) {
      used.add(byPos.id);
      r.id = byPos.id;
    } else {
      r.id = opts.newId();
    }
  });
  return result;
}

/** Max stored length of the raw free-form SKU text (specs.skus_text). */
export const SKU_TEXT_MAX_LENGTH = 20000;

/** Spec key for the raw free-form SKU text staff typed / pasted. */
export const SKU_TEXT_SPEC_KEY = "skus_text";

/** Normalize a client-sent skus_text value (string, trimmed end, capped). */
export function sanitizeSkuText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const v = value.replace(/\s+$/u, "");
  if (!v.trim()) return null;
  return v.slice(0, SKU_TEXT_MAX_LENGTH);
}
