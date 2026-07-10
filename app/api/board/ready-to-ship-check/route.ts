import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";

/**
 * GET /api/board/ready-to-ship-check?orderId=...&columnId=...
 *
 * Returns:
 *  - siblingCount: total number of parts in the group (including this order)
 *  - siblingsInColumn: how many of those parts are currently in columnId
 *  - previousNotificationDate: ISO string of the last ready_to_ship notification
 *    sent for this order, or null
 */
export async function GET(request: Request) {
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");
  const columnId = searchParams.get("columnId");

  if (!orderId || !columnId) {
    return NextResponse.json(
      { error: "orderId and columnId are required" },
      { status: 400 }
    );
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  // Load the order to find its group key.
  const { data: order } = await supabase
    .from("orders")
    .select("id, title, specs, column_id")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  // Determine group key — same logic as fireNotificationRules.
  const webhookKey =
    typeof order.specs?.webhook_order_number === "string"
      ? order.specs.webhook_order_number.trim()
      : null;
  const titleMatch = (order.title as string).match(/^(.+)-(\d+)$/);
  const groupKey = webhookKey || (titleMatch ? titleMatch[1] : null);

  let siblingCount = 1;
  let siblingsInColumn = order.column_id === columnId ? 1 : 0;

  if (groupKey) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from("orders")
      .select("id, column_id")
      .eq("tenant_id", tenantId)
      .is("removed_at", null)
      .neq("id", orderId);

    if (webhookKey) {
      q = q.filter("specs->>'webhook_order_number'", "eq", webhookKey);
    } else {
      q = q.ilike("title", `${groupKey}-%`);
    }

    const { data: siblings } = await q;
    const sibs = (siblings ?? []) as { id: string; column_id: string }[];

    // +1 to include the current order itself.
    siblingCount = sibs.length + 1;
    siblingsInColumn =
      sibs.filter((s) => s.column_id === columnId).length +
      (order.column_id === columnId ? 1 : 0);
  }

  // Check for a previous ready_to_ship notification on this order.
  const { data: previousNotif } = await supabase
    .from("notifications")
    .select("created_at")
    .eq("order_id", orderId)
    .eq("type", "ready_to_ship")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    siblingCount,
    siblingsInColumn,
    previousNotificationDate: previousNotif?.created_at ?? null,
  });
}
