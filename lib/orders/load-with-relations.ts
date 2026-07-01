import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderWithRelations } from "@/lib/types";

const ORDER_SELECT_WITH_TAG =
  "*, customer:customers(*), tag:tags(id, name, color)";
const ORDER_SELECT_BASE = "*, customer:customers(*)";

export async function loadOrdersWithRelations(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderWithRelations[]> {
  const withTag = await supabase
    .from("orders")
    .select(ORDER_SELECT_WITH_TAG)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .order("position", { ascending: true });

  if (!withTag.error) {
    return (withTag.data ?? []) as OrderWithRelations[];
  }

  const fallback = await supabase
    .from("orders")
    .select(ORDER_SELECT_BASE)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .order("position", { ascending: true });

  if (fallback.error) return [];
  return (fallback.data ?? []) as OrderWithRelations[];
}

export async function loadRemovedOrdersWithRelations(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderWithRelations[]> {
  const withTag = await supabase
    .from("orders")
    .select(ORDER_SELECT_WITH_TAG)
    .eq("tenant_id", tenantId)
    .not("removed_at", "is", null)
    .order("removed_at", { ascending: false });

  if (!withTag.error) {
    return (withTag.data ?? []) as OrderWithRelations[];
  }

  const fallback = await supabase
    .from("orders")
    .select(ORDER_SELECT_BASE)
    .eq("tenant_id", tenantId)
    .not("removed_at", "is", null)
    .order("removed_at", { ascending: false });

  if (fallback.error) return [];
  return (fallback.data ?? []) as OrderWithRelations[];
}

export async function loadOrderWithRelations(
  supabase: SupabaseClient,
  orderId: string,
  tenantId: string
): Promise<OrderWithRelations | null> {
  const withTag = await supabase
    .from("orders")
    .select(ORDER_SELECT_WITH_TAG)
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!withTag.error && withTag.data) {
    return withTag.data as OrderWithRelations;
  }

  const fallback = await supabase
    .from("orders")
    .select(ORDER_SELECT_BASE)
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (fallback.error || !fallback.data) return null;
  return fallback.data as OrderWithRelations;
}
