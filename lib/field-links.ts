import type { CustomField, FieldLink } from "@/lib/types";

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value != null) return String(value);
  return "";
}

/**
 * Normalize option labels for matching.
 * "👕 Apparel" and "Apparel" compare equal; preserves no mutation of stored values.
 */
export function normalizeOptionKey(value: string): string {
  return value
    .replace(
      /^[\p{Extended_Pictographic}\p{Emoji_Presentation}\p{Emoji}\uFE0F\u200D\s]+/u,
      ""
    )
    .trim()
    .toLowerCase();
}

export function optionsMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const na = normalizeOptionKey(a);
  const nb = normalizeOptionKey(b);
  return Boolean(na && nb && na === nb);
}

/** Find the exact option string (including emoji) that matches a value. */
export function findMatchingOption(
  options: string[] | null | undefined,
  value: string
): string | undefined {
  const v = value.trim();
  if (!v || !options?.length) return undefined;
  const exact = options.find((o) => o === v);
  if (exact) return exact;
  const key = normalizeOptionKey(v);
  if (!key) return undefined;
  return options.find((o) => normalizeOptionKey(o) === key);
}

/** Preserve order while dropping duplicate strings. */
export function uniqueOptions(options: string[] | null | undefined): string[] {
  if (!options?.length) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of options) {
    const opt = typeof raw === "string" ? raw : String(raw ?? "");
    if (seen.has(opt)) continue;
    seen.add(opt);
    out.push(opt);
  }
  return out;
}

/**
 * Options for a select field after applying linked-dropdown rules.
 * - No link targeting this field → all options
 * - Source empty → all options
 * - Link with no mappings for the current source value → all options
 * - Otherwise → intersection of field.options and mapped target values
 *
 * formValues must be keyed by custom field UUID.
 */
export function getFilteredOptions(
  field: CustomField,
  fieldValues: Record<string, unknown>,
  links: FieldLink[]
): string[] {
  const options = uniqueOptions(field.options);
  const link = links.find((l) => l.target_field_id === field.id);
  if (!link) return options;

  const srcValue = asString(fieldValues[link.source_field_id]).trim();
  if (!srcValue) return options;

  const mapped = mappedTargetsForSource(link, srcValue);
  if (mapped.length === 0) return options;

  return options.filter((opt) =>
    mapped.some((m) => optionsMatch(opt, m))
  );
}

/** Target field IDs that should be cleared when a source field's value changes. */
export function clearTargetsForSourceChange(
  links: FieldLink[],
  sourceFieldId: string
): string[] {
  return links
    .filter((l) => l.source_field_id === sourceFieldId)
    .map((l) => l.target_field_id);
}

export function findSelectFieldByName(
  fields: CustomField[],
  name: string
): CustomField | undefined {
  const lower = name.toLowerCase();
  return fields.find(
    (f) =>
      f.field_type === "select" && f.name.trim().toLowerCase() === lower
  );
}

/** Mapped target values for a source value on a specific link (empty if none). */
export function mappedTargetsForSource(
  link: FieldLink | undefined,
  sourceValue: string
): string[] {
  if (!link || !sourceValue.trim()) return [];
  const mappings = link.field_link_mappings ?? [];
  const exact = mappings
    .filter((m) => m.source_value === sourceValue)
    .map((m) => m.target_value);
  if (exact.length > 0) return exact;
  return mappings
    .filter((m) => optionsMatch(m.source_value, sourceValue))
    .map((m) => m.target_value);
}

/**
 * Options for a target select from a specific source→target link.
 * Returns null when no such link exists (caller should use catalog fallback).
 * Returns all field options when source is empty or has no mappings for that value.
 */
export function linkedTargetOptions(
  links: FieldLink[],
  sourceFieldId: string,
  targetField: CustomField,
  sourceValue: string
): string[] | null {
  const link = links.find(
    (l) =>
      l.source_field_id === sourceFieldId &&
      l.target_field_id === targetField.id
  );
  if (!link) return null;
  const options = uniqueOptions(targetField.options);
  const src = sourceValue.trim();
  if (!src) return options;
  const mapped = mappedTargetsForSource(link, src);
  if (mapped.length === 0) return options;
  return options.filter((opt) => mapped.some((m) => optionsMatch(opt, m)));
}
