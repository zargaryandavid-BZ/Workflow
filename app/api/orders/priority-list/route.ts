import { NextResponse } from "next/server";
import { getTenantContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { canSetBoardTagAndPriority } from "@/lib/permissions";
import { logActivity } from "@/lib/automation";
import { normalizeSkus } from "@/lib/skus";
import { ORDER_QTY_FIELD_NAME, QUANTITY_FIELD_NAME } from "@/lib/constants";
import type { DailyPriorityBucket, PressType } from "@/lib/types";
import type { SupabaseClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

const PRESSES: PressType[] = ["6K", "15K"];
const BUCKETS: DailyPriorityBucket[] = ["today", "tomorrow"];

const PRIORITY_LIST_SELECT = [
  "id",
  "title",
  "webhook_source",
  "specs",
  "due_date",
  "press",
  "production_stage",
  "daily_priority_bucket",
  "daily_priority_rank",
  "daily_priority_done",
  "daily_priority_done_at",
  "daily_priority_note",
  "column_id",
  "customer:customers(id, name, company)",
].join(", ");

/** Same UTC calendar day as `now` — used to auto-reset the Done checkbox each day. */
function isSameUtcDay(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getUTCFullYear() === now.getUTCFullYear() &&
    d.getUTCMonth() === now.getUTCMonth() &&
    d.getUTCDate() === now.getUTCDate()
  );
}

/**
 * Product + qty for single-item orders that have no specs.skus (multi-SKU
 * orders already carry name+qty per line in specs.skus — see PRIORITY_LIST
 * GET below). Batches one lookup for the whole page instead of one per row.
 */
async function fetchProductQtyFallback(
  supabase: SupabaseClient,
  tenantId: string,
  orderIds: string[]
): Promise<Map<string, { product: string | null; qty: number | null }>> {
  const out = new Map<string, { product: string | null; qty: number | null }>();
  if (orderIds.length === 0) return out;

  const { data: fields } = await supabase
    .from("custom_fields")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .in("name", ["Product", ORDER_QTY_FIELD_NAME, QUANTITY_FIELD_NAME]);
  const fieldRows = (fields ?? []) as { id: string; name: string }[];
  const productFieldId = fieldRows.find((f) => f.name === "Product")?.id;
  const qtyFieldId =
    fieldRows.find((f) => f.name === ORDER_QTY_FIELD_NAME)?.id ??
    fieldRows.find((f) => f.name === QUANTITY_FIELD_NAME)?.id;
  const fieldIds = [productFieldId, qtyFieldId].filter(Boolean) as string[];
  if (fieldIds.length === 0) return out;

  const { data: values } = await supabase
    .from("custom_field_values")
    .select("order_id, custom_field_id, value")
    .in("order_id", orderIds)
    .in("custom_field_id", fieldIds);

  for (const row of (values ?? []) as {
    order_id: string;
    custom_field_id: string;
    value: unknown;
  }[]) {
    const entry = out.get(row.order_id) ?? { product: null, qty: null };
    if (row.custom_field_id === productFieldId) {
      entry.product = typeof row.value === "string" ? row.value.trim() || null : null;
    } else if (row.custom_field_id === qtyFieldId) {
      const n = Number(row.value);
      entry.qty = Number.isFinite(n) ? n : null;
    }
    out.set(row.order_id, entry);
  }
  return out;
}

/**
 * Shared Priority List (per press, per day).
 *
 *   GET ?search=text   → up to 15 open orders matching text, not yet on the
 *                         list (id/title/customer), for the "add to list" picker.
 *   GET                → { orders } every order currently on the list
 *                         (press + daily_priority_bucket both set), sorted by
 *                         rank within press+bucket (ties broken by created_at).
 *                         Any tenant member may read this — production staff
 *                         need to see it without asking, per the feature spec.
 *   PATCH { updates }  → admin / preprod_owner only. Bulk-assigns press,
 *                         bucket, and rank (add to list / reorder / move
 *                         between today ↔ tomorrow / take off the list by
 *                         setting bucket to null).
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;
  const url = new URL(request.url);
  const search = url.searchParams.get("search")?.trim();

  if (search) {
    const { data, error } = await supabase
      .from("orders")
      .select("id, title, due_date, daily_priority_bucket, customer:customers(name, company)")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .ilike("title", `%${search}%`)
      .limit(15);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const results = (data ?? [])
      .filter((o) => !(o as { daily_priority_bucket?: string | null }).daily_priority_bucket)
      .map((o) => ({
        id: o.id as string,
        title: (o.title as string) ?? "",
        due_date: (o.due_date as string | null) ?? null,
        customer: (o.customer as { name?: string; company?: string } | null) ?? null,
      }));
    return NextResponse.json({ orders: results });
  }

  const { data, error } = await supabase
    .from("orders")
    .select(PRIORITY_LIST_SELECT)
    .eq("tenant_id", tenantId)
    .is("removed_at", null)
    .not("press", "is", null)
    .not("daily_priority_bucket", "is", null)
    .order("daily_priority_rank", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = new Date();
  const rows = data ?? [];
  const skusByOrderId = new Map(
    rows.map((row) => {
      const r = row as unknown as { id: string; specs: Record<string, unknown> | null };
      return [r.id, normalizeSkus(r.specs?.skus)] as const;
    })
  );
  const fallbackOrderIds = rows
    .map((row) => (row as unknown as { id: string }).id)
    .filter((id) => (skusByOrderId.get(id)?.length ?? 0) === 0);
  const fallback = await fetchProductQtyFallback(supabase, tenantId, fallbackOrderIds);

  const orders = rows.map((row) => {
    const r = row as unknown as Record<string, unknown>;
    const rawDone = Boolean(r.daily_priority_done);
    const doneAt = (r.daily_priority_done_at as string | null) ?? null;
    const skus = skusByOrderId.get(r.id as string) ?? [];
    return {
      ...r,
      // Staff-facing "done" resets automatically the next day without a
      // separate cron job — see isSameUtcDay(). The underlying DB value is
      // left alone; only what the UI shows is recomputed here.
      daily_priority_done: rawDone && isSameUtcDay(doneAt, now),
      // Brief job context for the shop floor — SKU name+qty when the order
      // has line items, else the single-item Product/QTY custom fields.
      skus: skus.map((s) => ({ name: s.name, qty: s.qty })),
      product: skus.length === 0 ? (fallback.get(r.id as string)?.product ?? null) : null,
      qty: skus.length === 0 ? (fallback.get(r.id as string)?.qty ?? null) : null,
    };
  });

  return NextResponse.json({
    orders,
    presses: PRESSES,
    buckets: BUCKETS,
    canManage: canSetBoardTagAndPriority(ctx.role),
  });
}

export async function PATCH(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canSetBoardTagAndPriority(ctx.role)) {
    return NextResponse.json(
      { error: "Only Admin or Pre-prod owner can set the daily priority list." },
      { status: 403 }
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    updates?: Array<{
      orderId: string;
      press?: PressType | null;
      daily_priority_bucket?: DailyPriorityBucket | null;
      daily_priority_rank?: number | null;
      daily_priority_note?: string | null;
    }>;
  };
  const updates = Array.isArray(body.updates) ? body.updates : [];
  if (updates.length === 0) {
    return NextResponse.json({ error: "updates is required" }, { status: 400 });
  }
  for (const u of updates) {
    if (!u.orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }
    if (u.press !== undefined && u.press !== null && !PRESSES.includes(u.press)) {
      return NextResponse.json({ error: `Invalid press: ${u.press}` }, { status: 400 });
    }
    if (
      u.daily_priority_bucket !== undefined &&
      u.daily_priority_bucket !== null &&
      !BUCKETS.includes(u.daily_priority_bucket)
    ) {
      return NextResponse.json(
        { error: `Invalid bucket: ${u.daily_priority_bucket}` },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;
  const ids = updates.map((u) => u.orderId);
  const { data: existingRows, error: fetchError } = await supabase
    .from("orders")
    .select("id, title, press, daily_priority_bucket")
    .eq("tenant_id", tenantId)
    .in("id", ids);
  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }
  const existingById = new Map(
    (existingRows ?? []).map((r) => [r.id as string, r as Record<string, unknown>])
  );

  let updated = 0;
  for (const u of updates) {
    const existing = existingById.get(u.orderId);
    if (!existing) continue; // not in this tenant — skip silently

    const patch: Record<string, unknown> = {};
    if (u.press !== undefined) patch.press = u.press;
    if (u.daily_priority_bucket !== undefined) {
      patch.daily_priority_bucket = u.daily_priority_bucket;
    }
    if (u.daily_priority_rank !== undefined) patch.daily_priority_rank = u.daily_priority_rank;
    if (u.daily_priority_note !== undefined) {
      patch.daily_priority_note = u.daily_priority_note?.trim() || null;
    }

    // Assignment changed (press or bucket) → reset the Done checkbox; a
    // re-queued or moved job is not "done" for its new slot.
    const pressChanged = u.press !== undefined && u.press !== existing.press;
    const bucketChanged =
      u.daily_priority_bucket !== undefined &&
      u.daily_priority_bucket !== existing.daily_priority_bucket;
    if (pressChanged || bucketChanged) {
      patch.daily_priority_done = false;
      patch.daily_priority_done_at = null;
    }

    if (Object.keys(patch).length === 0) continue;

    const { error } = await supabase
      .from("orders")
      .update(patch)
      .eq("id", u.orderId)
      .eq("tenant_id", tenantId);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    updated += 1;

    if (pressChanged || bucketChanged) {
      void logActivity(supabase, {
        tenantId,
        orderId: u.orderId,
        actor: ctx.userId,
        action: "priority_list_updated",
        metadata: {
          press: u.press ?? existing.press ?? null,
          daily_priority_bucket:
            u.daily_priority_bucket ?? existing.daily_priority_bucket ?? null,
        },
      }).catch(() => {});
    }
  }

  return NextResponse.json({ ok: true, updated });
}
