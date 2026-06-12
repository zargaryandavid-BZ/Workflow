import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PRINT_FIELDS } from "@/lib/print-field-defaults";

/**
 * Idempotently seeds the default print-production custom fields for a tenant.
 * Existing fields (matched by name) are left untouched; only missing ones are
 * appended after the current highest position. Returns the number added.
 */
export async function seedDefaultPrintFields(
  client: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { data: existing } = await client
    .from("custom_fields")
    .select("name, position")
    .eq("tenant_id", tenantId);

  const existingNames = new Set(
    (existing ?? []).map((f: { name: string }) => f.name.toLowerCase())
  );
  let position =
    (existing ?? []).reduce(
      (max: number, f: { position: number }) => Math.max(max, f.position),
      -1
    ) + 1;

  const toInsert = DEFAULT_PRINT_FIELDS.filter(
    (f) => !existingNames.has(f.name.toLowerCase())
  ).map((f) => ({
    tenant_id: tenantId,
    name: f.name,
    field_type: f.field_type,
    options: f.options,
    required: f.required ?? false,
    position: position++,
  }));

  if (toInsert.length === 0) return 0;

  const { error } = await client.from("custom_fields").insert(toInsert);
  if (error) throw new Error(error.message);
  return toInsert.length;
}

/**
 * For each default field that has options, overwrites the `options` column on
 * the matching existing field (matched by name, case-insensitive).
 * Fields not in the defaults are left untouched. Returns the number updated.
 */
export async function syncFieldOptions(
  client: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { data: existing } = await client
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", tenantId);

  if (!existing || existing.length === 0) return 0;

  const byName = new Map(
    (existing as { id: string; name: string }[]).map((f) => [
      f.name.toLowerCase(),
      f.id,
    ])
  );

  const toSync = DEFAULT_PRINT_FIELDS.filter(
    (f) => f.options.length > 0 && byName.has(f.name.toLowerCase())
  );

  let updated = 0;
  for (const f of toSync) {
    const id = byName.get(f.name.toLowerCase())!;
    const { error } = await client
      .from("custom_fields")
      .update({ options: f.options })
      .eq("id", id)
      .eq("tenant_id", tenantId);
    if (error) throw new Error(error.message);
    updated++;
  }

  return updated;
}
