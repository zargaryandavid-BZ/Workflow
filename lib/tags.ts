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

export const DIE_REQUEST_TAG_NAME = "DIE REQUEST";

/** CRM product/category "Cutting" is a die job, not a Cutting color tag. */
export function canonicalBoardTagName(name: string): string {
  const trimmed = name.trim();
  if (trimmed.toLowerCase() === "cutting") return DIE_REQUEST_TAG_NAME;
  return trimmed;
}

export const DEFAULT_TAGS = [
  {
    name: DIE_REQUEST_TAG_NAME,
    color: "#0ea5e9",
    description: "Die service line — order the die from the manufacturer",
  },
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

/** Create a named tag if this tenant does not already have it. */
export async function ensureNamedTag(
  supabase: SupabaseClient,
  tenantId: string,
  name: string,
  color: string,
  description?: string
): Promise<string | null> {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const { data: existing } = await supabase
    .from("tags")
    .select("id")
    .eq("tenant_id", tenantId)
    .ilike("name", trimmed)
    .maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: last } = await supabase
    .from("tags")
    .select("position")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last?.position as number | null) ?? -1) + 1;

  const { data: created, error } = await supabase
    .from("tags")
    .insert({
      tenant_id: tenantId,
      name: trimmed,
      color,
      description: description ?? null,
      position,
    })
    .select("id")
    .single();
  if (error || !created?.id) return existing?.id ?? null;
  return created.id as string;
}
