import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import {
  formatReadyToShipGroupLabel,
  listOrderGroupMembers,
} from "@/lib/ready-to-ship-group";

/**
 * GET /api/board/ready-to-ship-check?orderId=...&columnId=...
 *
 * Returns:
 *  - siblingCount: total number of parts in the group (including this order)
 *  - siblingsInColumn: how many of those parts are currently in columnId
 *  - siblingTitles: titles of all group parts
 *  - groupLabel: customer-facing label (includes all parts when grouped)
 *  - previousNotificationDate: ISO string of the last ready_to_ship notification
 *    sent for any part of this group, or null
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

  const { data: order } = await supabase
    .from("orders")
    .select("id, title, specs, column_id, description")
    .eq("id", orderId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const members = await listOrderGroupMembers(supabase, tenantId, {
    id: order.id as string,
    title: order.title as string,
    column_id: order.column_id as string | null,
    description: order.description as string | null,
    specs: (order.specs ?? {}) as Record<string, unknown>,
  });

  const siblingCount = members.length;
  const siblingsInColumn = members.filter((m) => m.column_id === columnId).length;
  const siblingTitles = members.map((m) => m.title);
  const groupLabel = formatReadyToShipGroupLabel(members);

  const memberIds = members.map((m) => m.id);
  const { data: previousNotif } = await supabase
    .from("job_notifications")
    .select("created_at")
    .in("order_id", memberIds)
    .eq("type", "ready_to_ship")
    .in("status", ["sent", "responded", "pending"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    siblingCount,
    siblingsInColumn,
    siblingTitles,
    groupLabel,
    previousNotificationDate: previousNotif?.created_at ?? null,
  });
}
