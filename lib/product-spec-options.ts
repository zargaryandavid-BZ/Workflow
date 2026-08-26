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
