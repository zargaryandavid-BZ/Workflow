import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Keep `designer_name` in lockstep with `designer_id`.
 * Visibility (designer board) filters on id; the card used to show the
 * stored name, so a stale name made admin/AM see Har while Marianna still
 * received the card.
 */
export async function withCanonicalDesignerName(
  client: SupabaseClient,
  specs: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const rawId = specs.designer_id;
  const id = typeof rawId === "string" ? rawId.trim() : "";
  if (!id) {
    if (rawId === null || rawId === "") {
      return { ...specs, designer_id: null, designer_name: null };
    }
    return specs;
  }

  const { data } = await client
    .from("profiles")
    .select("full_name")
    .eq("id", id)
    .maybeSingle();
  const profileName =
    typeof data?.full_name === "string" ? data.full_name.trim() : "";
  const storedName =
    typeof specs.designer_name === "string" ? specs.designer_name.trim() : "";
  return {
    ...specs,
    designer_id: id,
    designer_name: profileName || storedName || null,
  };
}
