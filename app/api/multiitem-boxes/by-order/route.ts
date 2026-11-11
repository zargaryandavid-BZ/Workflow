import { NextResponse } from "next/server";
import { resolveMultiitemAccess } from "@/lib/multiitem-box-access";

/**
 * GET ?order_id= — the multi-item boxes this order is packed in (Scan badge).
 * Staff session or a registered floor device, like the rest of the box API.
 */
export async function GET(request: Request) {
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId } = access;
  const orderId = new URL(request.url).searchParams.get("order_id")?.trim() ?? "";
  if (!orderId) return NextResponse.json({ boxes: [] });

  const { data, error } = await supabase
    .from("multiitem_box_orders")
    .select("quantity, box:multiitem_boxes(*)")
    .eq("tenant_id", tenantId)
    .eq("order_id", orderId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const boxes = ((data ?? []) as {
    quantity: number;
    box: Record<string, unknown> | Record<string, unknown>[] | null;
  }[])
    .map((row) => {
      const box = Array.isArray(row.box) ? row.box[0] : row.box;
      if (!box) return null;
      return {
        id: String(box.id),
        name: String(box.box_name ?? ""),
        status: String(box.status ?? "open"),
        savedAt: (box.saved_at as string | null) ?? null,
        carrier: (box.carrier as string | null) ?? null,
        trackingNumber: (box.tracking_number as string | null) ?? null,
        shippedAt: (box.shipped_at as string | null) ?? null,
        quantity: row.quantity,
      };
    })
    .filter(Boolean);
  return NextResponse.json({ boxes });
}
