/**
 * One display filter for product-spec rows on the card and the job ticket.
 *
 * Hayk 2026-11-26: zero pricing inside cards, each product shows only its
 * relevant parameters, same labels everywhere. This is DISPLAY ONLY — stored
 * card data (orders.specs, custom_field_values) is never rewritten; old cards
 * are cleaned up at render time by running their rows through here.
 *
 * Pure module (no imports) so it is safe on the client, the server and in
 * `node --test`.
 */

export type ProductFamily =
  | "roll_label"
  | "sheet_label"
  | "pouch"
  | "box"
  | "combo"
  | "marketing"
  | "packaging_resale"
  | "apparel"
  | "unknown";

export type SpecRowInput = {
  /** Machine key (SET_SIZE, pricePerSheet, custom field name…). */
  key?: string | null;
  /** Label already prepared for display (spec_display label, field label). */
  label?: string | null;
  value: unknown;
};

export type CleanSpecRow = { key: string; label: string; value: string };

export type SpecRowContext = { family?: ProductFamily | null };

/** "pricePerSheet" / "PRICE_PER_SHEET" / "Price per sheet" → "pricepersheet". */
export function compactSpecKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function keyTokens(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// ── Product family ──────────────────────────────────────────────────────────

/** First match wins. Order matters: combo before bag, tape/gift bags before pouch. */
const PRODUCT_FAMILY_RULES: [ProductFamily, RegExp][] = [
  ["combo", /\bcombo\b/],
  ["packaging_resale", /\b(tape|tissue|wrapping|gift bags?)\b/],
  ["roll_label", /\broll labels?\b|\blabels? \(roll\)/],
  ["pouch", /\b(pouch(es)?|mylar|bags?)\b/],
  ["box", /\b(box(es)?|cartons?|sleeves?)\b/],
  ["sheet_label", /\b(stickers?|sheet labels?|label sheets?)\b/],
  ["apparel", /\b(apparel|t-?shirts?|tees?|hoodies?|shirts?)\b/],
  ["marketing", /\b(cards?|flyers?|postcards?|menus?|brochures?|booklets?)\b/],
];

/** Category alone is only trusted when it cannot be a roll label. */
const CATEGORY_FAMILY_RULES: [ProductFamily, RegExp][] = [
  ["box", /\b(box(es)?|cartons?)\b/],
  ["pouch", /\b(bags?|pouch(es)?|flexible)\b/],
  ["apparel", /\bapparel\b/],
  ["marketing", /\b(marketing|cards?)\b/],
];

function familyText(raw: unknown): string {
  return typeof raw === "string"
    ? raw.toLowerCase().replace(/[-_]+/g, " ").trim()
    : "";
}

export function productFamily(input: {
  product?: unknown;
  category?: unknown;
}): ProductFamily {
  const product = familyText(input.product);
  if (product) {
    for (const [family, re] of PRODUCT_FAMILY_RULES) {
      if (re.test(product)) return family;
    }
  }
  const category = familyText(input.category);
  if (category) {
    for (const [family, re] of CATEGORY_FAMILY_RULES) {
      if (re.test(category)) return family;
    }
  }
  return "unknown";
}

/** Rows that only make sense on a roll label (roll direction, per-roll, core). */
const ROLL_ONLY_KEYS = new Set([
  "rolldirection",
  "qtyperroll",
  "qtyperrollmode",
  "labelsperroll",
  "labelsperrollrule",
  "minlabelsperroll",
  "maxlabelsperroll",
  "core",
  "coresize",
  "rollcore",
  "unwind",
]);

/** Products that are bought/converted, not printed on a side: no "Sides" row. */
const NO_SIDES_FAMILIES = new Set<ProductFamily>(["packaging_resale"]);

/** Is a row with this key relevant for the product family? Unknown → keep. */
export function isSpecKeyRelevant(
  key: string,
  family: ProductFamily | null | undefined,
): boolean {
  if (!family || family === "unknown") return true;
  const k = compactSpecKey(key);
  if (ROLL_ONLY_KEYS.has(k)) return family === "roll_label";
  if (k === "sides") return !NO_SIDES_FAMILIES.has(family);
  return true;
}

// ── Pricing / internal keys ─────────────────────────────────────────────────

/** Any of these words in a key means money or bookkeeping, never a spec. */
const BLOCKED_KEY_TOKENS = new Set([
  "price",
  "prices",
  "pricing",
  "fee",
  "fees",
  "cost",
  "costs",
  "total",
  "subtotal",
  "breakdown",
  "billed",
  "billing",
  "markup",
  "discount",
  "url",
  "urls",
  "link",
  "links",
  "folder",
  "approval",
  "webhook",
  "token",
  "fingerprint",
  "id",
  "ids",
  "uuid",
]);

/** Keys that arrive glued together ("Linetotal", "Pricepersheet") or are echoes. */
const BLOCKED_COMPACT_KEYS = [
  "linetotal",
  "pricepersheet",
  "diefee",
  "billedsheets",
  "enteredquantity",
  "unitprice",
  "approvalurl",
  "approvaldecision",
  "approvaldecidedat",
  "designerfolderurl",
  "breakdown",
  "fingerprint",
  "webhook",
  "markup",
  "discount",
];

/** Whole-key matches: CRM write-back echoes and lists already shown elsewhere. */
const BLOCKED_EXACT_KEYS = new Set([
  "notes",
  "productionnotes",
  "customernote",
  "customerfacingnote",
  "designlist",
  "designerqueuepos",
  "requestownername",
  "requestowneremail",
  "requestownerphone",
]);

export function isPricingOrInternalSpecKey(key: string): boolean {
  const compact = compactSpecKey(key);
  if (!compact) return false;
  if (compact.startsWith("crm")) return true;
  if (BLOCKED_EXACT_KEYS.has(compact)) return true;
  if (BLOCKED_COMPACT_KEYS.some((k) => compact.includes(k))) return true;
  return keyTokens(key).some((t) => BLOCKED_KEY_TOKENS.has(t));
}

// ── Values ──────────────────────────────────────────────────────────────────

const EMPTY_VALUES = new Set([
  "",
  "none",
  "n/a",
  "na",
  "null",
  "undefined",
  "-",
  "—",
  "no",
  "false",
]);

/** "None", "N/A", "0", "0x0", "", "No"/"false" (checkbox off) → hidden. */
export function isEmptySpecValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (EMPTY_VALUES.has(v)) return true;
  if (/^0+(\.0+)?$/.test(v)) return true;
  if (/^0+(\.0+)?\s*[x×]\s*0+(\.0+)?$/.test(v)) return true;
  return false;
}

/** A $ amount, a URL, or an ISO timestamp is never a production spec. */
export function isJunkSpecValue(value: string): boolean {
  const v = value.trim();
  if (/\$\s*\d/.test(v)) return true;
  if (/https?:\/\//i.test(v) || /^www\./i.test(v)) return true;
  if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(v)) return true;
  return false;
}

function valueToText(raw: unknown): string {
  if (raw == null) return "";
  if (typeof raw === "boolean") return raw ? "Yes" : "No";
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : "";
  if (Array.isArray(raw)) {
    return raw
      .map(valueToText)
      .filter((v) => v && !isEmptySpecValue(v))
      .join(", ");
  }
  if (typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    return (
      valueToText(rec.label) || valueToText(rec.name) || valueToText(rec.value)
    );
  }
  return String(raw).trim();
}

/**
 * Per-key value rewrites so the same fact reads the same everywhere.
 * Returns "" when the row should be hidden.
 */
function normalizeSpecValue(compactKey: string, value: string): string {
  let v = value.trim();

  // "6 extra designs × $5 = $30.00 (first 2 included)" → "8 designs".
  if (compactKey === "filesetup") {
    const both = v.match(
      /(\d+)\s+extra designs?[\s\S]*?first\s+(\d+)\s+included/i,
    );
    if (both) return `${Number(both[1]) + Number(both[2])} designs`;
    const extra = v.match(/(\d+)\s+extra designs?/i);
    if (extra) return `${extra[1]} extra designs`;
  }

  // Old "Rounded Corners: Yes" → "Corners: Rounded".
  if (compactKey === "roundedcorners") {
    return /^(yes|true|1)$/i.test(v) ? "Rounded" : "";
  }

  // Sheet-service price multipliers ("Lamination 1.2") are not finishes.
  if (/lamination$/.test(compactKey) && /^\d+(\.\d+)?$/.test(v)) return "";

  // Finishing wording: "Soft Touch" / "Gloss" / "Matte" → "… Lamination".
  if (compactKey === "finishing" || compactKey === "lamination") {
    const m = v.match(/^(gloss|matte|soft[\s-]?touch)(\s+matte)?$/i);
    if (m) {
      const base = m[1]!.toLowerCase();
      v =
        base === "gloss"
          ? "Gloss Lamination"
          : base === "matte"
            ? "Matte Lamination"
            : "Soft Touch Lamination";
    }
  }

  // Sheet services send press codes: "44" = 4/4, "40" = 4/0.
  if (compactKey === "sides") {
    const code = v.match(/^([1-4])([0-4])$/);
    if (code) {
      return code[2] === "0"
        ? `Single-sided (${code[1]}/0)`
        : `Double-sided (${code[1]}/${code[2]})`;
    }
  }

  // Only a non-standard turnaround is worth a row.
  if (compactKey === "turnaround" && /^standard$/i.test(v)) return "";

  // Category slugs ("bags-flexible-packaging") read as words.
  if (compactKey === "category" && /^[a-z0-9]+(-[a-z0-9]+)+$/.test(v)) {
    const words = v.replace(/-/g, " ");
    v = words.charAt(0).toUpperCase() + words.slice(1);
  }

  return v.replace(/\bworking days\b/gi, "business days");
}

// ── Labels ──────────────────────────────────────────────────────────────────

/** One label per fact, keyed by compact key (or compact label). */
const SPEC_LABELS: Record<string, string> = {
  setsize: "Size",
  size: "Size",
  labelcorners: "Corners",
  corners: "Corners",
  roundedcorners: "Corners",
  rolldirection: "Roll Direction",
  qtyperroll: "Labels per roll",
  labelsperroll: "Labels per roll",
  qtyperrollmode: "Labels per roll rule",
  minlabelsperroll: "Min labels per roll",
  maxlabelsperroll: "Max labels per roll",
  containername: "Container",
  custombox: "Box size (L×W×H)",
  colormode: "Color Mode",
  color: "Color",
  handlecolor: "Handle color",
  lamination: "Finishing",
  finishing: "Finishing",
  specialeffects: "Special effects",
  cutting: "Cutting",
  cuttingtype: "Cutting",
  filesetup: "Designs",
  turnaround: "Turnaround",
  sides: "Sides",
  zipper: "Zipper",
  sealsides: "Seal sides",
  gusset: "Gusset",
  gussetsize: "Gusset size",
  tearnotch: "Tear notch",
  hanghole: "Hang hole",
  board: "Board",
  paper: "Paper",
};

/** "pricePerSheet" → "Price per sheet"; "LABEL_CORNERS" → "Corners". */
export function humanSpecLabel(key: string, label?: string | null): string {
  const fromKey = SPEC_LABELS[compactSpecKey(key)];
  if (fromKey) return fromKey;
  const provided = (label ?? "").trim();
  if (provided) return SPEC_LABELS[compactSpecKey(provided)] ?? provided;
  const words = keyTokens(key).join(" ");
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

// ── Row filter ──────────────────────────────────────────────────────────────

/**
 * Clean one row for display. Returns null when the row must not be shown
 * (pricing, internal bookkeeping, empty, or irrelevant for the product).
 */
export function cleanSpecRow(
  row: SpecRowInput,
  ctx?: SpecRowContext,
): CleanSpecRow | null {
  const key = (row.key ?? "").trim();
  const providedLabel = (row.label ?? "").trim();
  const idKey = key || providedLabel;
  if (!idKey) return null;
  if (isPricingOrInternalSpecKey(idKey)) return null;
  if (providedLabel && isPricingOrInternalSpecKey(providedLabel)) return null;
  if (!isSpecKeyRelevant(idKey, ctx?.family)) return null;
  if (providedLabel && !isSpecKeyRelevant(providedLabel, ctx?.family))
    return null;

  const raw = valueToText(row.value);
  if (isEmptySpecValue(raw)) return null;
  const value = normalizeSpecValue(compactSpecKey(idKey), raw);
  if (isEmptySpecValue(value) || isJunkSpecValue(value)) return null;

  const label = humanSpecLabel(key, providedLabel);
  if (!label) return null;
  return { key: idKey, label, value };
}

function labelKey(label: string): string {
  return label
    .replace(/[\s-]+/g, " ")
    .trim()
    .toLowerCase();
}

/** Clean a list and keep the first row per label. */
export function cleanSpecRows(
  rows: SpecRowInput[],
  ctx?: SpecRowContext,
): CleanSpecRow[] {
  const out: CleanSpecRow[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const clean = cleanSpecRow(row, ctx);
    if (!clean) continue;
    const k = labelKey(clean.label);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(clean);
  }
  return out;
}

/**
 * Custom-field visibility helper for the card editor: false when the field
 * holds nothing meaningful ("None", 0) or does not apply to the product
 * (Roll Direction on a box, Sides on tape). Editor code may call this.
 */
export function isCustomFieldRelevant(
  fieldName: string,
  value: unknown,
  family: ProductFamily | null | undefined,
): boolean {
  return cleanSpecRow({ key: fieldName, value }, { family }) !== null;
}
