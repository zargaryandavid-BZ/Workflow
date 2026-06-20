import type { SupabaseClient } from "@supabase/supabase-js";

export interface CustomFieldValueInput {
  customFieldId: string;
  value: unknown;
}

/**
 * Keep only rows whose custom_field_id exists for the tenant.
 * Prevents FK violations when field definitions changed or the client is stale.
 */
export async function filterValidCustomFieldValues(
  client: SupabaseClient,
  tenantId: string,
  values: CustomFieldValueInput[]
): Promise<{
  valid: CustomFieldValueInput[];
  invalidIds: string[];
}> {
  if (values.length === 0) {
    return { valid: [], invalidIds: [] };
  }

  const ids = [...new Set(values.map((v) => v.customFieldId))];
  const { data, error } = await client
    .from("custom_fields")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("id", ids);

  if (error) {
    throw new Error(error.message);
  }

  const allowed = new Set((data ?? []).map((row) => row.id as string));
  const invalidIds = ids.filter((id) => !allowed.has(id));
  const valid = values.filter((v) => allowed.has(v.customFieldId));

  return { valid, invalidIds };
}

export function staleCustomFieldsMessage(invalidIds: string[]): string {
  const count = invalidIds.length;
  return count === 1
    ? "A custom field on this card is out of date (definitions may have changed). Refresh the page and try again."
    : `${count} custom fields on this card are out of date (definitions may have changed). Refresh the page and try again.`;
}
