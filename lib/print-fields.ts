import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_PRINT_FIELDS } from "@/lib/constants";

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
    position: position++,
  }));

  if (toInsert.length === 0) return 0;

  const { error } = await client.from("custom_fields").insert(toInsert);
  if (error) throw new Error(error.message);
  return toInsert.length;
}
