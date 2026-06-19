import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderSpecs } from "@/lib/types";

export const ORDER_TAG_STYLES: Record<string, string> = {
  Emailed: "bg-blue-100 text-blue-700 border border-blue-200",
};

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
  const tags = orderTagsFromSpecs(existingSpecs as OrderSpecs);
  if (tags.includes(tag)) return;

  const { error } = await supabase
    .from("orders")
    .update({
      specs: { ...existingSpecs, tags: [...tags, tag] },
    })
    .eq("id", orderId)
    .eq("tenant_id", tenantId);

  if (error) {
    throw new Error(error.message);
  }
}
