import type { SupabaseClient } from "@supabase/supabase-js";

export const TAG_COLORS = [
  "#6366f1",
  "#3b82f6",
  "#06b6d4",
  "#10b981",
  "#f59e0b",
  "#f97316",
  "#ef4444",
  "#ec4899",
  "#8b5cf6",
  "#64748b",
] as const;

export const DEFAULT_TAGS = [
  {
    name: "Rush Order",
    color: "#ef4444",
    description: "Urgent / rush production",
  },
  {
    name: "Reprint",
    color: "#f97316",
    description: "Reprint of a previous order",
  },
  {
    name: "New Customer",
    color: "#10b981",
    description: "First order from this customer",
  },
  {
    name: "Custom Project",
    color: "#6366f1",
    description: "Fully custom or unique work",
  },
  {
    name: "Sample / Proof",
    color: "#64748b",
    description: "Sample run or proof only",
  },
] as const;

export async function seedDefaultTags(
  supabase: SupabaseClient,
  tenantId: string
): Promise<number> {
  const { count } = await supabase
    .from("tags")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  if ((count ?? 0) > 0) return 0;

  const rows = DEFAULT_TAGS.map((tag, index) => ({
    tenant_id: tenantId,
    name: tag.name,
    color: tag.color,
    description: tag.description,
    position: index,
  }));

  const { error } = await supabase.from("tags").insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}
