import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { fireNotificationRules } from "@/lib/fire-notification-rules";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await getTenantContext();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    order_id?: string;
  };
  if (!body.order_id) {
    return NextResponse.json({ error: "order_id is required" }, { status: 400 });
  }

  const supabase = await createClient();
  const tenantId = ctx.tenant.id;

  // Load the button (RLS ensures it belongs to the user's tenant).
  const { data: button } = await supabase
    .from("fast_action_buttons")
    .select("*")
    .eq("id", id)
    .eq("tenant_id", tenantId)
    .eq("enabled", true)
    .maybeSingle();

  if (!button?.destination_column_id) {
    return NextResponse.json(
      { error: "Button not found or has no destination column" },
      { status: 404 }
    );
  }

  // Verify the order exists and belongs to this tenant.
  const { data: order } = await supabase
    .from("orders")
    .select("id, column_id, removed_at")
    .eq("id", body.order_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }
  if (order.removed_at) {
    return NextResponse.json(
      { error: "Removed orders cannot be moved" },
      { status: 400 }
    );
  }

  // No-op if already in the destination column.
  if (order.column_id === button.destination_column_id) {
    return NextResponse.json({ ok: true, alreadyThere: true });
  }

  const { error: moveError } = await supabase
    .from("orders")
    .update({ column_id: button.destination_column_id })
    .eq("id", body.order_id)
    .eq("tenant_id", tenantId);

  if (moveError) {
    return NextResponse.json({ error: moveError.message }, { status: 500 });
  }

  // Fire notification rules linked to this button (fire-and-forget).
  if (button.notification_rule_id) {
    fireNotificationRules(
      body.order_id,
      button.destination_column_id,
      tenantId
    ).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[FastActionBtn] notification error:", message);
    });
  }

  return NextResponse.json({ ok: true });
}
