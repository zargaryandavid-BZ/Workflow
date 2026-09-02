import { findMatchingOption, normalizeOptionKey } from "./field-links.ts";

export type SpecSelectOption = { value: string; label: string };

export function isSetSizeKey(key: string): boolean {
  const norm = key.replace(/[\s-]+/g, "_").toUpperCase();
  if (norm === "FONT_SIZE") return false;
  // SET_SIZE / SET_SIZE_3 plus catalog size dropdowns (LABEL_SIZE, SHEET_SIZE…).
  return (
    norm === "SET_SIZE" ||
    norm === "SET_SIZE_3" ||
    norm === "SIZE" ||
    /_SIZE$/.test(norm)
  );
}

function dimensionToken(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return "";
  const m = value.trim().replace(/["']/g, "").match(/^([\d.]+)/);
  return m ? m[1]! : "";
}

export function formatSetSizeValue(
  width: unknown,
  height: unknown,
  depth?: unknown
): string {
  const w = dimensionToken(width);
  const h = dimensionToken(height);
  const d = dimensionToken(depth);
  if (w && h && d) return `${w}x${h}x${d}`;
  if (!w || !h) return "";
  return `${w}x${h}`;
}

export function parseSetSizeValue(
  raw: string
): { width: string; height: string; depth?: string } | null {
  const m = raw
    .trim()
    .replace(/["']/g, "")
    .replace(/\s*(in(?:ches?)?|mm|cm)\s*$/i, "")
    .match(/^([\d.]+)\s*[x×]\s*([\d.]+)(?:\s*[x×]\s*([\d.]+))?$/i);
  if (!m) return null;
  if (m[3]) return { width: m[1], height: m[2], depth: m[3] };
  return { width: m[1], height: m[2] };
}

function stringish(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function optionFromUnknown(raw: unknown): SpecSelectOption | null {
  if (typeof raw === "string") {
    const value = raw.trim();
    return value ? { value, label: value } : null;
  }
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const value = String(raw);
    return { value, label: value };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const rec = raw as Record<string, unknown>;
  const nested =
    rec.option && typeof rec.option === "object" && !Array.isArray(rec.option)
      ? (rec.option as Record<string, unknown>)
      : rec;
  const label =
    stringish(nested.label) ??
    stringish(nested.name) ??
    stringish(nested.value);
  const value =
    stringish(nested.value) ??
    stringish(nested.option_id) ??
    stringish(nested.id) ??
    label;
  if (!value) return null;
  return { value, label: label ?? value };
}

/** CRM field_options values may be arrays of objects, strings, or missing. */
export function normalizeSpecSelectOptions(raw: unknown): SpecSelectOption[] {
  if (!Array.isArray(raw)) return [];
  const out: SpecSelectOption[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const opt = optionFromUnknown(item);
    if (!opt || seen.has(opt.value)) continue;
    seen.add(opt.value);
    out.push(opt);
  }
  return out;
}

function sameNumber(a: string, b: string): boolean {
  const na = Number(a);
  const nb = Number(b);
  return Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

export function sameSetSizeValue(a: string, b: string): boolean {
  if (a === b) return true;
  const pa = parseSetSizeValue(a);
  const pb = parseSetSizeValue(b);
  if (!pa || !pb) return false;
  if (!sameNumber(pa.width, pb.width) || !sameNumber(pa.height, pb.height)) {
    return false;
  }
  if (pa.depth || pb.depth) {
    if (!pa.depth || !pb.depth) return false;
    return sameNumber(pa.depth, pb.depth);
  }
  return true;
}

/** Pick the catalog option whose value/label matches a stored or WxH size. */
export function findMatchingSetSizeOption(
  options: SpecSelectOption[],
  current: string
): SpecSelectOption | null {
  const needle = current.trim();
  if (!needle || options.length === 0) return null;
  const exact = options.find((o) => o.value === needle || o.label === needle);
  if (exact) return exact;
  return (
    options.find(
      (o) => sameSetSizeValue(o.value, needle) || sameSetSizeValue(o.label, needle)
    ) ?? null
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function nestedFieldOptions(
  product: Record<string, unknown> | null | undefined
): Record<string, unknown> | null {
  if (!product) return null;
  if (isRecord(product.field_options) && Object.keys(product.field_options).length) {
    return product.field_options;
  }
  if (isRecord(product.options) && isRecord(product.options.field_options)) {
    const fo = product.options.field_options;
    return Object.keys(fo).length ? fo : null;
  }
  return null;
}

function normalizeProductKey(name: string): string {
  return normalizeOptionKey(name).replace(/['’]/g, "").replace(/\s+/g, " ");
}

/** Workflow "Labels (Roll)" ↔ CRM "Roll Labels". */
export function productCatalogAliases(name: string): string[] {
  const n = normalizeProductKey(name);
  if (!n) return [];
  const out = [n];
  const wrapped = n.match(/^labels\s*\(([^)]+)\)$/);
  if (wrapped) out.push(`${wrapped[1]!.trim()} labels`);
  const suffix = n.match(/^(.+?)\s+labels$/);
  if (suffix && !suffix[1]!.includes("(")) {
    out.push(`labels (${suffix[1]!.trim()})`);
  }
  return out;
}

/**
 * CRM spec keys that duplicate Workflow print custom fields on the same card
 * (e.g. Roll Labels COLOR_MODE vs the Color Mode dropdown).
 */
const SPEC_KEY_CUSTOM_FIELDS: Record<string, string[]> = {
  COLOR_MODE: ["Color Mode", "Color"],
  COLOR: ["Color Mode", "Color"],
  ROLL_DIRECTION: ["Roll Direction"],
  SET_SIZE: ["Width", "Height", "Finished Size"],
  SET_SIZE_3: ["Width", "Height", "Finished Size"],
  LABEL_SIZE: ["Width", "Height", "Finished Size"],
  MATERIALS: ["Materials"],
  FINISHING: ["Finishing"],
  SIDES: ["Sides"],
  DIE_METHOD: ["Die"],
  DIE_NAME: ["Die"],
  CUTTING_TYPE: ["Die"],
  CUTTING: ["Die"],
};

export function specKeyCoveredByCustomFields(
  specKey: string,
  customFieldNames: string[]
): boolean {
  const aliases = SPEC_KEY_CUSTOM_FIELDS[specKey.replace(/[\s-]+/g, "_").toUpperCase()];
  if (!aliases?.length || customFieldNames.length === 0) return false;
  const names = new Set(customFieldNames.map((n) => n.trim().toLowerCase()));
  if (isSetSizeKey(specKey)) {
    const hasFinished = names.has("finished size");
    const hasWxH = names.has("width") && names.has("height");
    return hasFinished || hasWxH;
  }
  return aliases.some((a) => names.has(a.toLowerCase()));
}

/** Catalog option checkboxes. Hide-empty cards omit toggles that were not selected. */
export function visibleCatalogToggles(
  toggles: { key: string; label: string }[] | null | undefined,
  selectedOptions: string[],
  hideEmpty: boolean,
  opts?: { customFieldNames?: string[]; hideCovered?: boolean }
): { key: string; label: string }[] {
  let list = (toggles ?? []).filter((t) => t.key !== "DESIGN_SERVICE");
  if (opts?.hideCovered && (opts.customFieldNames?.length ?? 0) > 0) {
    list = list.filter(
      (t) => !specKeyCoveredByCustomFields(t.key, opts.customFieldNames ?? [])
    );
  }
  if (!hideEmpty) return list;
  return list.filter((t) =>
    selectedOptions.some((o) => o.toLowerCase() === t.label.toLowerCase())
  );
}

/** When hide-empty is on, catalog dropdowns with no CRM value stay off the card. */
export function catalogSpecHasDisplayValue(value: string): boolean {
  return value.trim() !== "";
}

/** Mapper-only ids — stay on spec_selections, never on the floor form. */
const HIDDEN_FLOOR_SPEC_KEYS = new Set(["BAZAAR_ITEM_ID", "BAZAAR_DIE_ID"]);

/** Already shown as Product / Die / Materials / Finished Size (Q12). */
const SPEC_DISPLAY_COVERED_KEYS = new Set([
  "SET_SIZE",
  "DIE_NAME",
  "SIZE",
  "DIE",
]);

function normalizeSpecKey(key: string): string {
  return key.replace(/[\s-]+/g, "_").toUpperCase();
}

export function isHiddenFloorSpecKey(key: string): boolean {
  return HIDDEN_FLOOR_SPEC_KEYS.has(normalizeSpecKey(key));
}

export function isSpecDisplayCoveredByCustomFields(key: string): boolean {
  return SPEC_DISPLAY_COVERED_KEYS.has(normalizeSpecKey(key));
}

export type SpecDisplayRow = { key: string; label: string; value: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Admin Order Sync floor rows: `{ key, label, value }`. No Admin/CRM lookup. */
export function parseSpecDisplay(raw: unknown): SpecDisplayRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: SpecDisplayRow[] = [];
  for (const item of raw) {
    const rec = asRecord(item);
    if (!rec) continue;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    if (key && isHiddenFloorSpecKey(key)) continue;
    const value =
      rec.value == null || rec.value === ""
        ? ""
        : String(rec.value).trim();
    if (!value) continue;
    const labelRaw = typeof rec.label === "string" ? rec.label.trim() : "";
    const label = labelRaw || (key ? sentenceCaseSpecLabel(key) : value);
    rows.push({ key, label, value });
  }
  return rows;
}

/**
 * spec_display from the line, or from a flat / single-item body.
 * Multi-item carts do not inherit a sibling's display rows.
 */
export function resolveLineSpecDisplay(
  item: unknown,
  body?: unknown
): SpecDisplayRow[] | null {
  const fromItem = parseSpecDisplay(asRecord(item)?.spec_display);
  if (fromItem.length > 0) return fromItem;
  const items = asRecord(body)?.items;
  if (Array.isArray(items) && items.length > 1) return null;
  const fromBody = parseSpecDisplay(asRecord(body)?.spec_display);
  return fromBody.length > 0 ? fromBody : null;
}

/** Floor rows after Q12: drop Size / Die already on custom fields. */
export function floorSpecDisplayRows(raw: unknown): SpecDisplayRow[] {
  return parseSpecDisplay(raw).filter(
    (row) => !row.key || !isSpecDisplayCoveredByCustomFields(row.key)
  );
}

/** "APPAREL_CLIENT_PROVIDED" → "Apparel client provided" (Product-label style). */
export function sentenceCaseSpecLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  if (!words) return "";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function lookupCatalogMap<T>(
  map: Record<string, T> | undefined,
  productName: string
): T | null {
  if (!map || !productName.trim()) return null;
  if (map[productName] != null) return map[productName];
  // Same matching as linked Product/Materials (emoji prefix, case).
  const linked = findMatchingOption(Object.keys(map), productName);
  if (linked && map[linked] != null) return map[linked];
  const aliases = new Set(productCatalogAliases(productName));
  for (const k of Object.keys(map)) {
    if (aliases.has(normalizeProductKey(k))) return map[k];
  }
  return null;
}

/**
 * Canonical linked-catalog product name. Prefer "Roll Labels" over the
 * legacy Workflow spelling "Labels (Roll)" when both exist.
 */
export function preferLinkedCatalogName(
  stored: string,
  names: string[]
): string | null {
  if (!stored.trim() || names.length === 0) return null;
  const aliases = new Set(productCatalogAliases(stored));
  const hits = names.filter((n) => aliases.has(normalizeProductKey(n)));
  const suffixForm = hits.find((n) => {
    const k = normalizeProductKey(n);
    return /^.+\s+labels$/.test(k) && !k.includes("(");
  });
  if (suffixForm) return suffixForm;
  if (hits.length === 1) return hits[0]!;
  return findMatchingOption(names, stored) ?? null;
}
