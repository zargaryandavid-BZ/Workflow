import { findMatchingOption, optionsMatch } from "@/lib/field-links";

/** Field names that store multiple options as a comma-separated string. */
const MULTI_SELECT_FIELD_NAMES = new Set([
  "special effects",
  "special effect",
  "specialeffects",
]);

export function isMultiSelectField(field: { name: string }): boolean {
  return MULTI_SELECT_FIELD_NAMES.has(field.name.trim().toLowerCase());
}

/**
 * Parse a stored multi-select value into individual option labels.
 * Webhooks store `"X, Y"`; arrays are also accepted.
 */
export function parseMultiSelectValue(
  value: unknown,
  options: string[] = []
): string[] {
  if (value == null) return [];

  const rawParts: string[] = [];
  if (Array.isArray(value)) {
    for (const v of value) {
      const s = typeof v === "string" ? v.trim() : String(v ?? "").trim();
      if (s) rawParts.push(s);
    }
  } else {
    const text = String(value).trim();
    if (!text) return [];

    // Exact catalog match (single option, even if label has commas).
    const exact = findMatchingOption(options, text);
    if (exact) return [exact];

    if (!/[;,|]/.test(text)) {
      return [text];
    }

    for (const part of text.split(/[,;|]/)) {
      const s = part.trim();
      if (s) rawParts.push(s);
    }
  }

  const selected: string[] = [];
  for (const part of rawParts) {
    const match = findMatchingOption(options, part) ?? part;
    if (!selected.some((s) => optionsMatch(s, match))) {
      selected.push(match);
    }
  }
  return selected;
}

/** Persist multi-select the same way webhooks do: `"X, Y"`. */
export function formatMultiSelectValue(selected: string[]): string {
  return selected
    .map((s) => s.trim())
    .filter(Boolean)
    .join(", ");
}
