import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderWithRelations } from "@/lib/types";

/** Card list: skip crm_snapshot / notes blobs. Detail views use GET /api/orders/[id]. */
export const BOARD_ORDER_LIST_SELECT = `
  id, tenant_id, column_id, customer_id, tag_id, title, description,
  specs, priority, due_date, position, created_by, removed_at, removed_by,
  created_at, updated_at, last_moved_at, webhook_source, crm_order_id,
  locked_by, locked_by_name, lock_reason, locked_at, integration_mode,
  customer:customers(id, name, email, phone, company, preferred_channel),
  tag:tags(id, name, color)
`.replace(/\s+/g, " ").trim();

const ORDER_SELECT_BASE = BOARD_ORDER_LIST_SELECT.replace(
  ", tag:tags(id, name, color)",
  ""
);

export async function loadOrdersWithRelations(
  supabase: SupabaseClient,
  tenantId: string
): Promise<OrderWithRelations[]> {
  // Single query with left join — tag may be null if not set or tags table
  // migration hasn't run yet, which is fine.
  const { data, error } = await supabase
    .from("orders")
    .select(BOARD_ORDER_LIST_SELECT)
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
    .select(BOARD_ORDER_LIST_SELECT)
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
    .select(BOARD_ORDER_LIST_SELECT)
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
