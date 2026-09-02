import { fuzzyMatch } from "./fuzzyMatch.ts";
import { preferLinkedCatalogName } from "./product-spec-options.ts";

/** Product + Materials skip catalog remap / alias / fuzzy on Admin-shaped lines. */
export const ADMIN_IDENTITY_SELECT_FIELDS = new Set(["product", "materials"]);

/** Size keys persist as-is on Admin-shaped lines (no Finished Size alias rewrite). */
export const ADMIN_SIZE_PERSIST_FIELDS = new Set([
  "finished_size",
  "width",
  "height",
]);

const NONE_SENTINELS = new Set([
  "none",
  "none (inactive)",
  "n/a",
  "na",
  "-",
  "—",
]);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

export function isAdminIdentitySelectField(field: string): boolean {
  return ADMIN_IDENTITY_SELECT_FIELDS.has(field.trim().toLowerCase());
}

/** Case- and whitespace-insensitive exact option match. Returns the option's stored spelling. */
export function exactSelectOption(
  incoming: string,
  options: string[]
): string | null {
  const key = incoming.trim().toLowerCase().replace(/\s+/g, " ");
  if (!key) return null;
  for (const option of options) {
    if (option.trim().toLowerCase().replace(/\s+/g, " ") === key) {
      return option;
    }
  }
  return null;
}

export function isPositiveBazaarItemId(value: unknown): boolean {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return false;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0;
  }
  return false;
}

export function pickSpecSelections(
  source: unknown
): Record<string, unknown> | null {
  const rec = asRecord(source);
  const raw = rec?.spec_selections;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (Object.keys(raw).length === 0) return null;
  return raw as Record<string, unknown>;
}

/**
 * spec_selections from the line, or from a flat / single-item body.
 * Multi-item payloads do not inherit order-level spec_selections onto siblings
 * (mixed carts: a legacy line must not pick up a sibling's bazaar_item_id).
 */
export function resolveLineSpecSelections(
  item: unknown,
  body?: unknown
): Record<string, unknown> | null {
  const fromItem = pickSpecSelections(item);
  if (fromItem) return fromItem;
  const items = asRecord(body)?.items;
  if (Array.isArray(items) && items.length > 1) return null;
  return pickSpecSelections(body);
}

/**
 * Admin-shaped line = that line's spec_selections.bazaar_item_id is a finite
 * number > 0 (numeric string accepted). Order-level catalog_source alone is
 * never enough — mixed carts decide per line.
 */
export function isAdminCatalogLine(item: unknown, body?: unknown): boolean {
  const selections = resolveLineSpecSelections(item, body);
  return isPositiveBazaarItemId(selections?.bazaar_item_id);
}

/**
 * Known CRM → Workflow option aliases for select fields.
 * Keys are lowercase incoming values; values are preferred option labels.
 */
export function resolveKnownSelectAlias(
  fieldName: string,
  incoming: string
): string | null {
  const field = fieldName.trim().toLowerCase();
  const key = incoming.trim().toLowerCase().replace(/\s+/g, " ");
  if (field === "product") {
    const map: Record<string, string> = {
      "die cut / kiss cut stickers": "Diecut Stickers",
      "die-cut / kiss-cut stickers": "Diecut Stickers",
      "die cut stickers": "Diecut Stickers",
      "kiss cut stickers": "Diecut Stickers",
      "diecut stickers": "Diecut Stickers",
      "roll labels": "Labels (Roll)",
      "labels (roll)": "Labels (Roll)",
      "sheet labels": "Labels (Sheet)",
      "labels (sheet)": "Labels (Sheet)",
    };
    return map[key] ?? null;
  }
  if (field === "materials") {
    const map: Record<string, string> = {
      "holographic label (rainbow holographic bopp)": "Holo BOPP",
      "rainbow holographic bopp": "Holo BOPP",
      "holographic label": "Holo BOPP",
      "holo bopp": "Holo BOPP",
      "white bopp (aggressive glue)": "White BOPP",
      "white bopp (regular glue)": "White BOPP",
      "clear bopp (aggressive glue)": "Clear BOPP",
      "clear bopp (regular glue)": "Clear BOPP",
      "silver bopp (aggressive glue)": "Silver BOPP",
      "silver bopp (regular glue)": "Silver BOPP",
    };
    return map[key] ?? null;
  }
  if (field === "lamination" || field === "finishing") {
    const map: Record<string, string> = {
      "matte lamination": "Matte",
      "gloss lamination": "Gloss",
      "soft touch lamination": "Soft Touch",
      gloss: "Gloss Lamination",
      matte: "Matte Lamination",
      "soft touch": "Soft Touch Lamination",
      "soft touch (non-scratch)": "Soft Touch Lamination (Non-Scratch)",
      "soft touch non-scratch": "Soft Touch Lamination (Non-Scratch)",
      "rainbow holographic": "Rainbow Holographic Lamination",
      "rainbow holo lamination": "Rainbow Holographic Lamination",
      "holo lamination": "Rainbow Holographic Lamination",
    };
    return map[key] ?? null;
  }
  if (field === "sides") {
    const map: Record<string, string> = {
      "1 side": "Single-sided",
      "1-side": "Single-sided",
      "one side": "Single-sided",
      "single sided": "Single-sided",
      "single-sided": "Single-sided",
      simplex: "Single-sided",
      "2 sides": "Double-sided",
      "2-sides": "Double-sided",
      "two sides": "Double-sided",
      "double sided": "Double-sided",
      "double-sided": "Double-sided",
      duplex: "Double-sided",
    };
    return map[key] ?? null;
  }
  return null;
}

export function mapWebhookSelectValue(params: {
  field: string;
  value: string;
  options: string[];
  adminIdentity?: boolean;
  corrections?: string[];
  keepUnmatched?: boolean;
}): string | null {
  const {
    field,
    value,
    options,
    adminIdentity = false,
    corrections = [],
    keepUnmatched = false,
  } = params;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const fieldKey = field.trim().toLowerCase();

  // Die is stored as free text (not a SELECT_WEBHOOK_KEYS field).
  if (fieldKey === "die") {
    return trimmed;
  }

  // Admin size: persist SET_SIZE elsewhere; width/height/finished_size as-is.
  if (adminIdentity && ADMIN_SIZE_PERSIST_FIELDS.has(fieldKey)) {
    return trimmed;
  }

  const identity =
    adminIdentity && isAdminIdentitySelectField(fieldKey);

  if (identity) {
    const exact = exactSelectOption(trimmed, options);
    if (exact) {
      if (exact !== trimmed) {
        corrections.push(`"${field}": "${trimmed}" → "${exact}" (exact)`);
      }
      return exact;
    }
    corrections.push(
      `"${field}": "${trimmed}" — stored as-is (admin catalog)`
    );
    return trimmed;
  }

  if (fieldKey === "product") {
    const preferred = preferLinkedCatalogName(trimmed, options);
    if (preferred) {
      if (preferred !== trimmed) {
        corrections.push(
          `"${field}": "${trimmed}" → "${preferred}" (catalog)`
        );
      }
      return preferred;
    }
  }

  if (NONE_SENTINELS.has(trimmed.toLowerCase())) {
    const noneOption = options.find((o) => o.trim().toLowerCase() === "none");
    if (noneOption) return noneOption;
    return null;
  }

  const exact = exactSelectOption(trimmed, options);
  if (exact) return exact;

  const alias = resolveKnownSelectAlias(fieldKey, trimmed);
  if (alias) {
    const aliased = exactSelectOption(alias, options);
    if (aliased) {
      if (aliased !== trimmed) {
        corrections.push(`"${field}": "${trimmed}" → "${aliased}" (alias)`);
      }
      return aliased;
    }
  }

  const match = fuzzyMatch(trimmed, options);
  if (match) {
    if (match.score < 1) {
      corrections.push(
        `"${field}": "${trimmed}" → "${match.matched}" (${Math.round(match.score * 100)}% match)`
      );
    }
    return match.matched;
  }

  if (keepUnmatched) {
    corrections.push(
      `"${field}": "${trimmed}" — not in options, stored as-is`
    );
    return trimmed;
  }

  corrections.push(`"${field}": "${trimmed}" — no match found, left blank`);
  return null;
}
