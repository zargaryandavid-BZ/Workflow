/**
 * "Labels per roll" on roll-label cards.
 *
 * Same keys + labels the broker portal and the CRM send (bazaar-website
 * packages/api/src/services/orderSyncPortalSpecs.ts, david-bazaar-crm
 * lib/bazaar/quote-builder/roll-options.ts):
 *   specs.spec_selections.QTY_PER_ROLL        "1000"
 *   specs.spec_selections.QTY_PER_ROLL_MODE   "At least" | "Exactly" | "Up to (max)"
 *   specs.spec_selections.MIN_LABELS_PER_ROLL "250"   (optional)
 *   specs.spec_selections.MAX_LABELS_PER_ROLL "500"   (optional)
 * plus matching `specs.spec_display` rows ("Qty Per Roll", "Qty Per Roll Mode",
 * "Min labels per roll", "Max labels per roll") so the floor / job ticket show
 * the same text.
 *
 * Staff edits vs. CRM / portal re-syncs — same rule as SKUs (lib/sku-resync.ts):
 * - Inbound roll values are fingerprinted into `specs.roll_inbound_fingerprint`.
 * - A staff change stamps `specs.roll_staff_edited_at` / `_by`.
 * - On re-sync, a staff-edited set is KEPT while the source keeps sending the
 *   same roll values it sent before; when the source sends different roll
 *   values, the source wins and the staff flag clears.
 *
 * Pure helpers only (no Supabase / Next imports) so node:test can load them.
 */

export const QTY_PER_ROLL_KEY = "QTY_PER_ROLL";
export const QTY_PER_ROLL_MODE_KEY = "QTY_PER_ROLL_MODE";
export const MIN_LABELS_PER_ROLL_KEY = "MIN_LABELS_PER_ROLL";
export const MAX_LABELS_PER_ROLL_KEY = "MAX_LABELS_PER_ROLL";

export const ROLL_KEYS = [
  QTY_PER_ROLL_KEY,
  QTY_PER_ROLL_MODE_KEY,
  MIN_LABELS_PER_ROLL_KEY,
  MAX_LABELS_PER_ROLL_KEY,
] as const;
export type RollKey = (typeof ROLL_KEYS)[number];

/** Card labels — exactly what the portal / CRM send in spec_display. */
export const ROLL_DISPLAY_LABELS: Record<RollKey, string> = {
  QTY_PER_ROLL: "Qty Per Roll",
  QTY_PER_ROLL_MODE: "Qty Per Roll Mode",
  MIN_LABELS_PER_ROLL: "Min labels per roll",
  MAX_LABELS_PER_ROLL: "Max labels per roll",
};

/** Stored production text for each mode (portal qty-per-roll.ts). */
export const QTY_PER_ROLL_MODES = ["At least", "Exactly", "Up to (max)"] as const;
export const DEFAULT_QTY_PER_ROLL_MODE = "At least";

export const ROLL_STAFF_EDITED_AT_KEY = "roll_staff_edited_at";
export const ROLL_STAFF_EDITED_BY_KEY = "roll_staff_edited_by";
export const ROLL_INBOUND_FINGERPRINT_KEY = "roll_inbound_fingerprint";

/** Server-owned spec keys a client save must never overwrite. */
export const ROLL_SYNC_SPEC_KEYS = [
  ROLL_STAFF_EDITED_AT_KEY,
  ROLL_STAFF_EDITED_BY_KEY,
  ROLL_INBOUND_FINGERPRINT_KEY,
] as const;

export type RollValues = Record<RollKey, string>;

type DisplayRow = { key?: unknown; label?: unknown; value?: unknown };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function str(value: unknown): string {
  if (value == null) return "";
  return String(value).trim();
}

function normKey(value: unknown): string {
  return str(value).replace(/[\s-]+/g, "_").toUpperCase();
}

function normLabel(value: unknown): string {
  return str(value).replace(/[\s_-]+/g, " ").toLowerCase();
}

/** True for a spec_display / spec_selections key that is one of the roll keys. */
export function isRollSpecKey(key: unknown): boolean {
  return (ROLL_KEYS as readonly string[]).includes(normKey(key));
}

/** True for a spec_display row (by key or label) that is a roll row. */
export function isRollDisplayRow(row: { key?: unknown; label?: unknown }): boolean {
  if (isRollSpecKey(row.key)) return true;
  const label = normLabel(row.label);
  return ROLL_KEYS.some((k) => normLabel(ROLL_DISPLAY_LABELS[k]) === label);
}

function displayRowKey(row: DisplayRow): RollKey | null {
  const k = normKey(row.key);
  if ((ROLL_KEYS as readonly string[]).includes(k)) return k as RollKey;
  const label = normLabel(row.label);
  return ROLL_KEYS.find((rk) => normLabel(ROLL_DISPLAY_LABELS[rk]) === label) ?? null;
}

function selectionsOf(specs: Record<string, unknown> | null | undefined): Record<string, unknown> {
  return asRecord(specs?.spec_selections) ?? {};
}

function displayOf(specs: Record<string, unknown> | null | undefined): DisplayRow[] {
  const raw = specs?.spec_display;
  return Array.isArray(raw)
    ? (raw.filter((r) => r && typeof r === "object") as DisplayRow[])
    : [];
}

/** Roll values from spec_selections only (what the re-sync rule compares). */
export function rollSelectionValues(selections: unknown): RollValues {
  const sel = asRecord(selections) ?? {};
  const byNorm = new Map<string, unknown>();
  for (const [k, v] of Object.entries(sel)) byNorm.set(normKey(k), v);
  return {
    QTY_PER_ROLL: str(byNorm.get(QTY_PER_ROLL_KEY)),
    QTY_PER_ROLL_MODE: str(byNorm.get(QTY_PER_ROLL_MODE_KEY)),
    MIN_LABELS_PER_ROLL: str(byNorm.get(MIN_LABELS_PER_ROLL_KEY)),
    MAX_LABELS_PER_ROLL: str(byNorm.get(MAX_LABELS_PER_ROLL_KEY)),
  };
}

/**
 * Values to show on the card: spec_selections first, then spec_display rows
 * (some sources only send the display rows).
 */
export function rollValuesFromSpecs(
  specs: Record<string, unknown> | null | undefined
): RollValues {
  const out = rollSelectionValues(specs?.spec_selections);
  for (const row of displayOf(specs)) {
    const k = displayRowKey(row);
    if (k && !out[k]) out[k] = str(row.value);
  }
  return out;
}

export function hasAnyRollValue(values: RollValues): boolean {
  return ROLL_KEYS.some((k) => values[k] !== "");
}

/** Fingerprint of the roll values in a spec_selections object. */
export function rollFingerprint(selections: unknown): string {
  const v = rollSelectionValues(selections);
  return JSON.stringify(ROLL_KEYS.map((k) => v[k]));
}

/** Digits only ("1,000" → "1000"); "" when none. */
export function rollDigits(value: unknown): string {
  return str(value).replace(/[^0-9]/g, "").replace(/^0+(?=\d)/, "");
}

/**
 * Write a full set of roll values onto specs: spec_selections keys (empty →
 * key removed) and matching spec_display rows (updated in place, appended
 * when missing, removed when empty). Other keys / rows are untouched.
 */
export function withRollValues(
  specs: Record<string, unknown>,
  values: Partial<RollValues>
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...specs };
  const sel: Record<string, unknown> = { ...selectionsOf(specs) };
  // Drop any differently-cased variants of the keys we set.
  for (const k of Object.keys(sel)) {
    const nk = normKey(k);
    if ((ROLL_KEYS as readonly string[]).includes(nk) && nk in values && k !== nk) {
      delete sel[k];
    }
  }
  for (const k of ROLL_KEYS) {
    if (!(k in values)) continue;
    const v = str(values[k]);
    if (v) sel[k] = v;
    else delete sel[k];
  }
  next.spec_selections = sel;

  const hadDisplay = Array.isArray(specs.spec_display);
  const rows = displayOf(specs).map((r) => ({ ...r }));
  const seen = new Set<RollKey>();
  const kept: DisplayRow[] = [];
  for (const row of rows) {
    const k = displayRowKey(row);
    if (!k || !(k in values)) {
      kept.push(row);
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    const v = str(values[k]);
    if (!v) continue;
    kept.push({ ...row, key: k, label: str(row.label) || ROLL_DISPLAY_LABELS[k], value: v });
  }
  for (const k of ROLL_KEYS) {
    if (!(k in values) || seen.has(k)) continue;
    const v = str(values[k]);
    if (!v) continue;
    kept.push({ key: k, label: ROLL_DISPLAY_LABELS[k], value: v });
  }
  if (hadDisplay || kept.length > 0) next.spec_display = kept;
  return next;
}

/**
 * One staff field change. Count fields keep digits only; entering a Qty per
 * roll with no mode yet sets the portal default ("At least").
 */
export function setRollSpecValue(
  specs: Record<string, unknown>,
  key: RollKey,
  rawValue: string
): Record<string, unknown> {
  const value = key === QTY_PER_ROLL_MODE_KEY ? str(rawValue) : rollDigits(rawValue);
  const patch: Partial<RollValues> = { [key]: value };
  if (key === QTY_PER_ROLL_KEY && value) {
    const cur = rollValuesFromSpecs(specs);
    if (!cur.QTY_PER_ROLL_MODE) patch.QTY_PER_ROLL_MODE = DEFAULT_QTY_PER_ROLL_MODE;
  }
  return withRollValues(specs, patch);
}

/** Blocking-style problem text ("" when fine) — the portal's rules. */
export function rollValuesProblem(values: RollValues, lineQty: number | null): string {
  const qty = values.QTY_PER_ROLL ? Number(values.QTY_PER_ROLL) : null;
  const fmt = (n: number) => n.toLocaleString("en-US");
  if (qty != null) {
    if (!(qty >= 1)) return "Enter at least 1 per roll.";
    if (
      values.QTY_PER_ROLL_MODE !== "Up to (max)" &&
      lineQty != null &&
      lineQty > 0 &&
      qty > lineQty
    ) {
      return `Qty per roll is more than the order quantity (${fmt(lineQty)}).`;
    }
  }
  const min = values.MIN_LABELS_PER_ROLL ? Number(values.MIN_LABELS_PER_ROLL) : null;
  const max = values.MAX_LABELS_PER_ROLL ? Number(values.MAX_LABELS_PER_ROLL) : null;
  if (min != null && max != null && min > max) {
    return `Min labels per roll (${fmt(min)}) is more than the max (${fmt(max)}).`;
  }
  return "";
}

/**
 * Roll-label card: it already has roll values, a Roll direction value, or the
 * product name says "roll" (same idea as the CRM's isBuilderRollLabelLine).
 */
export function isRollLabelCard(args: {
  specs: Record<string, unknown> | null | undefined;
  productName?: string | null;
  rollDirectionValue?: unknown;
}): boolean {
  const { specs } = args;
  if (hasAnyRollValue(rollValuesFromSpecs(specs))) return true;
  const sel = selectionsOf(specs);
  for (const [k, v] of Object.entries(sel)) {
    if (normKey(k) === "ROLL_DIRECTION" && str(v)) return true;
  }
  for (const row of displayOf(specs)) {
    if (
      (normKey(row.key) === "ROLL_DIRECTION" || normLabel(row.label) === "roll direction") &&
      str(row.value)
    ) {
      return true;
    }
  }
  if (str(args.rollDirectionValue)) return true;
  return /\broll/i.test(str(args.productName));
}

function isStaffEditedRoll(specs: Record<string, unknown>): boolean {
  const v = specs[ROLL_STAFF_EDITED_AT_KEY];
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Staff save path: keep the server-owned roll sync keys, then stamp the
 * staff-edited flag when the roll values actually changed. When the card has
 * no inbound fingerprint yet, the values it had BEFORE this first staff edit
 * are what the source last sent — record them so a later source change is
 * recognized.
 */
export function applyStaffRollEdit(
  existing: Record<string, unknown>,
  next: Record<string, unknown>,
  opts: { userId?: string | null; now?: Date } = {}
): Record<string, unknown> {
  const out = { ...next };
  for (const key of ROLL_SYNC_SPEC_KEYS) {
    if (Object.prototype.hasOwnProperty.call(existing, key)) out[key] = existing[key];
    else delete out[key];
  }
  const before = rollFingerprint(existing.spec_selections);
  const after = rollFingerprint(next.spec_selections);
  if (before === after) return out;
  if (
    typeof existing[ROLL_INBOUND_FINGERPRINT_KEY] !== "string" &&
    !isStaffEditedRoll(existing)
  ) {
    out[ROLL_INBOUND_FINGERPRINT_KEY] = before;
  }
  out[ROLL_STAFF_EDITED_AT_KEY] = (opts.now ?? new Date()).toISOString();
  if (opts.userId) out[ROLL_STAFF_EDITED_BY_KEY] = opts.userId;
  else delete out[ROLL_STAFF_EDITED_BY_KEY];
  return out;
}

/**
 * CRM / portal re-sync. Call AFTER the inbound spec_selections / spec_display
 * were written onto `nextSpecs` (only when the source sent spec_selections).
 * Returns the specs to store.
 */
export function resolveInboundRollResync(args: {
  existingSpecs: Record<string, unknown>;
  nextSpecs: Record<string, unknown>;
  inboundSelections: unknown;
}): { specs: Record<string, unknown>; keptStaffEdit: boolean } {
  const { existingSpecs, nextSpecs, inboundSelections } = args;
  if (!asRecord(inboundSelections)) {
    return { specs: nextSpecs, keptStaffEdit: false };
  }
  const fp = rollFingerprint(inboundSelections);
  const lastFp = existingSpecs[ROLL_INBOUND_FINGERPRINT_KEY];
  if (isStaffEditedRoll(existingSpecs) && (typeof lastFp !== "string" || lastFp === fp)) {
    const staff = rollSelectionValues(existingSpecs.spec_selections);
    const specs = withRollValues(nextSpecs, staff);
    specs[ROLL_INBOUND_FINGERPRINT_KEY] = fp;
    return { specs, keptStaffEdit: true };
  }
  const specs: Record<string, unknown> = { ...nextSpecs, [ROLL_INBOUND_FINGERPRINT_KEY]: fp };
  delete specs[ROLL_STAFF_EDITED_AT_KEY];
  delete specs[ROLL_STAFF_EDITED_BY_KEY];
  return { specs, keptStaffEdit: false };
}

export type RollActivityChange = { field: string; from?: unknown; to?: unknown };

/** Activity-log lines for roll value changes ("Qty Per Roll: 500 → 1000"). */
export function describeRollActivityChanges(
  oldSelections: unknown,
  newSelections: unknown
): RollActivityChange[] {
  const a = rollSelectionValues(oldSelections);
  const b = rollSelectionValues(newSelections);
  const out: RollActivityChange[] = [];
  for (const k of ROLL_KEYS) {
    if (a[k] === b[k]) continue;
    out.push({
      field: ROLL_DISPLAY_LABELS[k],
      from: a[k] || "(empty)",
      to: b[k] || "(empty)",
    });
  }
  return out;
}
