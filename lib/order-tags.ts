import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderSpecs } from "@/lib/types";

export const ORDER_TAG_STYLES: Record<string, string> = {
  Emailed: "bg-green-100 text-green-700 border border-green-200",
  Texted: "bg-sky-100 text-sky-700 border border-sky-200",
  Review: "bg-violet-100 text-violet-700 border border-violet-200",
  "In stock": "bg-emerald-100 text-emerald-700 border border-emerald-200",
  Ordered: "bg-blue-100 text-blue-700 border border-blue-200",
  "Can't get": "bg-red-100 text-red-700 border border-red-200",
};

/** Card tag for a button automation: "Review Request" → Review; otherwise fallback. */
export function actionTagForButton(
  buttonName: string,
  fallback: "Emailed" | "Texted"
): string {
  if (/review/i.test(buttonName)) return "Review";
  return fallback;
}

export function orderTagsFromSpecs(
  specs: OrderSpecs | null | undefined
): string[] {
  const raw = specs?.tags;
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (tag): tag is string => typeof tag === "string" && tag.trim().length > 0
  );
}

export async function addOrderTag(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string,
  tag: string,
  existingSpecs: Record<string, unknown>
): Promise<void> {
  // Replace any existing action tags with the new one so only the most recent action shows on the card.
  const { error } = await supabase
    .from("orders")
    .update({
      specs: { ...existingSpecs, tags: [tag] },
    })
    .eq("id", orderId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(error.message);
  }
}
