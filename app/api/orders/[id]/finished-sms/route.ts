import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { isFinishedNoReviewStage } from "@/lib/net-terms-fulfill";
import {
  markFinishedCompletionSmsSkipped,
  notifyCustomerOrderFinished,
} from "@/lib/finished-order-sms";
import type { Order } from "@/lib/types";

/**
 * Opt-in completion SMS after a card enters a Finished / not-review column.
 * The move itself never sends that SMS until action=send.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await params;
  const ctx = await getTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    action?: string;
  };
  const action = body.action === "send" ? "send" : "skip";

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  const typed = order as Order;
  const { data: column } = await supabase
    .from("board_columns")
    .select("name")
    .eq("id", typed.column_id)
    .eq("tenant_id", ctx.tenant.id)
    .maybeSingle();

  const columnName = typeof column?.name === "string" ? column.name : "";
  if (!isFinishedNoReviewStage(columnName)) {
    return NextResponse.json(
      { error: "This order is not in a Finished / not-review column." },
      { status: 400 }
    );
  }

  if (action === "skip") {
    await markFinishedCompletionSmsSkipped(typed);
    return NextResponse.json({ skipped: true });
  }

  await notifyCustomerOrderFinished(typed, columnName, { confirmed: true });
  return NextResponse.json({ sent: true });
}
