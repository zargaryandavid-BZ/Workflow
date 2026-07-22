import type { CustomField, FieldLink } from "@/lib/types";

function asString(value: unknown): string {
  if (typeof value === "string") return value;
  if (value != null) return String(value);
  return "";
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

  const allowed = (link.field_link_mappings ?? [])
    .filter((m) => m.source_value === srcValue)
    .map((m) => m.target_value);

  if (allowed.length === 0) return options;

  const allowedSet = new Set(allowed);
  return options.filter((opt) => allowedSet.has(opt));
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
  return (link.field_link_mappings ?? [])
    .filter((m) => m.source_value === sourceValue)
    .map((m) => m.target_value);
}
