import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderWithRelations } from "@/lib/types";

const ORDER_SELECT_WITH_TAG =
  "*, customer:customers(*), tag:tags(id, name, color)";
const ORDER_SELECT_BASE = "*, customer:customers(*)";

export async function loadOrdersWithRelations(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderWithRelations[]> {
  // Single query with left join — tag may be null if not set or tags table
  // migration hasn't run yet, which is fine.
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT_WITH_TAG)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .order("position", { ascending: true });

  if (!error) {
    return (data ?? []) as OrderWithRelations[];
  }

  // Only fall back if the join itself failed (e.g., tags table doesn't exist)
  if (error.message?.includes("tags")) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("orders")
      .select(ORDER_SELECT_BASE)
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .order("position", { ascending: true });

    if (fallbackError) return [];
    return (fallback ?? []) as OrderWithRelations[];
  }

  return [];
}

export async function loadRemovedOrdersWithRelations(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderWithRelations[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT_WITH_TAG)
    .eq("tenant_id", tenantId)
    .not("removed_at", "is", null)
    .order("removed_at", { ascending: false });

  if (!error) {
    return (data ?? []) as OrderWithRelations[];
  }

  if (error.message?.includes("tags")) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("orders")
      .select(ORDER_SELECT_BASE)
      .eq("tenant_id", tenantId)
      .not("removed_at", "is", null)
      .order("removed_at", { ascending: false });

    if (fallbackError) return [];
    return (fallback ?? []) as OrderWithRelations[];
  }

  return [];
}

export async function loadOrderWithRelations(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string
): Promise<OrderWithRelations | null> {
  // Single query with left join — tag may be null if not set or tags table
  // migration hasn't run yet, which is fine.
  const { data, error } = await supabase
    .from("orders")
    .select(ORDER_SELECT_WITH_TAG)
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!error && data) return data as OrderWithRelations;

  // Only fall back if the join itself failed (e.g., tags table doesn't exist)
  if (error?.message?.includes("tags")) {
    const { data: fallback } = await supabase
      .from("orders")
      .select(ORDER_SELECT_BASE)
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return (fallback as OrderWithRelations | null) ?? null;
  }

  return null;
}
