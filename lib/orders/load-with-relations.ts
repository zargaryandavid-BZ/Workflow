import type { SupabaseClient } from "@supabase/supabase-js";
import type { OrderWithRelations } from "@/lib/types";

/** Card list: skip crm_snapshot / note history. Detail uses ORDER_DETAIL_SELECT. */
export const BOARD_ORDER_LIST_SELECT = [
  "id",
  "tenant_id",
  "column_id",
  "customer_id",
  "tag_id",
  "title",
  "description",
  "specs",
  "priority",
  "due_date",
  "position",
  "created_by",
  "removed_at",
  "created_at",
  "updated_at",
  "last_moved_at",
  "webhook_source",
  "customer:customers(id, name, email, phone, company)",
  "tag:tags(id, name, color)",
].join(", ");

/** Single-card GET/PATCH — includes Notes tab (`internal_note`). */
export const ORDER_DETAIL_SELECT = [
  "id",
  "tenant_id",
  "column_id",
  "customer_id",
  "tag_id",
  "title",
  "description",
  "specs",
  "priority",
  "due_date",
  "position",
  "created_by",
  "removed_at",
  "created_at",
  "updated_at",
  "last_moved_at",
  "webhook_source",
    "internal_note",
  "customer:customers(id, name, email, phone, company)",
  "tag:tags(id, name, color)",
].join(", ");

/** If a listed column is missing on a live DB, PostgREST returns 42703. */
export const BOARD_ORDER_LIST_SELECT_FALLBACK =
  "*, customer:customers(*), tag:tags(id, name, color)";

export function isMissingRelationColumnError(
  err: { code?: string; message?: string } | null | undefined
): err is { code?: string; message?: string } {
  if (!err) return false;
  return (
    err.code === "42703" || /column .+ does not exist/i.test(err.message ?? "")
  );
}

export function asBoardOrders(data: unknown): OrderWithRelations[] {
  if (!Array.isArray(data)) return [];
  return data as OrderWithRelations[];
}

export function asBoardOrder(
  data: unknown
): OrderWithRelations | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  return data as OrderWithRelations;
}

const ORDER_SELECT_BASE = ORDER_DETAIL_SELECT.replace(
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
    return asBoardOrders(data);
  }

  if (isMissingRelationColumnError(error)) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("orders")
      .select(BOARD_ORDER_LIST_SELECT_FALLBACK)
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .order("position", { ascending: true });
    if (!fallbackError) return asBoardOrders(fallback);
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
    return asBoardOrders(fallback);
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
    return asBoardOrders(data);
  }

  if (isMissingRelationColumnError(error)) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("orders")
      .select(BOARD_ORDER_LIST_SELECT_FALLBACK)
      .eq("tenant_id", tenantId)
      .not("removed_at", "is", null)
      .order("removed_at", { ascending: false });
    if (!fallbackError) return asBoardOrders(fallback);
  }

  if (error.message?.includes("tags")) {
    const { data: fallback, error: fallbackError } = await supabase
      .from("orders")
      .select(ORDER_SELECT_BASE)
      .eq("tenant_id", tenantId)
      .not("removed_at", "is", null)
      .order("removed_at", { ascending: false });

    if (fallbackError) return [];
    return asBoardOrders(fallback);
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
    .select(ORDER_DETAIL_SELECT)
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!error && data) return asBoardOrder(data);

  if (isMissingRelationColumnError(error)) {
    const { data: fallback } = await supabase
      .from("orders")
      .select(BOARD_ORDER_LIST_SELECT_FALLBACK)
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (fallback) return asBoardOrder(fallback);
  }

  // Only fall back if the join itself failed (e.g., tags table doesn't exist)
  if (error?.message?.includes("tags")) {
    const { data: fallback } = await supabase
      .from("orders")
      .select(ORDER_SELECT_BASE)
      .eq("id", orderId)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return asBoardOrder(fallback);
  }

  return null;
}
