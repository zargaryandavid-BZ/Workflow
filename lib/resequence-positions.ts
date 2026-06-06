import type { SupabaseClient } from "@supabase/supabase-js";

async function resequenceTable(
  supabase: SupabaseClient,
  table: "board_columns" | "custom_fields",
  tenantId: string
): Promise<number> {
  const { data: rows, error } = await supabase
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  if (error) throw new Error(`${table}: ${error.message}`);

  const ids = (rows ?? []).map((r) => r.id as string);
  await Promise.all(
    ids.map((id, index) =>
      supabase.from(table).update({ position: index }).eq("id", id)
    )
  );

  return ids.length;
}

export async function resequencePositionsForTenant(
  supabase: SupabaseClient,
  tenantId: string
): Promise<{ columns: number; custom_fields: number }> {
  const [columns, custom_fields] = await Promise.all([
    resequenceTable(supabase, "board_columns", tenantId),
    resequenceTable(supabase, "custom_fields", tenantId),
  ]);
  return { columns, custom_fields };
}

export async function resequenceAllPositions(
  supabase: SupabaseClient
): Promise<
  { tenantId: string; columns: number; custom_fields: number }[]
> {
  const { data: tenants, error } = await supabase.from("tenants").select("id");
  if (error) throw new Error(error.message);

  const results: { tenantId: string; columns: number; custom_fields: number }[] =
    [];
  for (const tenant of tenants ?? []) {
    const tenantId = tenant.id as string;
    const summary = await resequencePositionsForTenant(supabase, tenantId);
    results.push({ tenantId, ...summary });
  }
  return results;
}
