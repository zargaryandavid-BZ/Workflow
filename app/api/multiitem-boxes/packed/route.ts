import { NextResponse } from "next/server";
import { resolveMultiitemAccess } from "@/lib/multiitem-box-access";
import { packedSkuQuantitiesForOrder } from "@/lib/multiitem-box-lookup";

/**
 * GET /api/multiitem-boxes/packed?order_id=…&exclude_box_id=…
 * Per-SKU quantities of one order already packed in other boxes, so the scan
 * preview can offer only what is left (a SKU split across boxes).
 */
export async function GET(request: Request) {
  const access = await resolveMultiitemAccess();
  if ("error" in access) return access.error;
  const { supabase, tenantId } = access;

  const url = new URL(request.url);
  const orderId = url.searchParams.get("order_id")?.trim() ?? "";
  if (!orderId) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }
  const excludeBoxId = url.searchParams.get("exclude_box_id")?.trim() || null;

  try {
    const packed = await packedSkuQuantitiesForOrder(
      supabase,
      tenantId,
      orderId,
      excludeBoxId
    );
    return NextResponse.json({
      packed: [...packed].map(([page, quantity]) => ({ page, quantity })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Lookup failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
