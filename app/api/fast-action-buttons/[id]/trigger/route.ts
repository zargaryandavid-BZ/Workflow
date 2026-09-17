import { after, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getTenantContext } from "@/lib/auth";
import { fireNotificationRules } from "@/lib/fire-notification-rules";
import { isFulfilledStage, notifyCrmOrderFulfilled } from "@/lib/net-terms-fulfill";
import { notifyCustomerOrderFinished } from "@/lib/finished-order-sms";
import type { Order } from "@/lib/types";
import { maybeStopWorkTimersOnColumnEnter } from "@/lib/stop-order-timers";

export const maxDuration = 300;

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
  const orderId = body.order_id?.trim();
  if (!orderId) {
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
  const destColumnId = button.destination_column_id as string;

  // Verify the order exists and belongs to this tenant.
  const { data: order } = await supabase
    .from("orders")
    .select("id, column_id, removed_at")
    .eq("id", orderId)
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
  if (order.column_id === destColumnId) {
    return NextResponse.json({ ok: true, alreadyThere: true });
  }

  const { error: moveError } = await supabase
    .from("orders")
    .update({
      column_id: destColumnId,
      last_moved_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("tenant_id", tenantId);

  if (moveError) {
    return NextResponse.json({ error: moveError.message }, { status: 500 });
  }

  const { data: destCol } = await supabase
    .from("board_columns")
    .select("kind, name")
    .eq("id", destColumnId)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  await maybeStopWorkTimersOnColumnEnter({
    tenantId,
    orderId,
    column: {
      kind: (destCol as { kind?: string } | null)?.kind,
      name: (destCol as { name?: string } | null)?.name,
    },
  });

  after(async () => {
    try {
      const { data: previewOrder } = await supabase
        .from("orders")
        .select("id, title, tenant_id, specs")
        .eq("id", orderId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (previewOrder) {
        const { generateApprovalLayerPreviewsIfWaitingColumn } = await import(
          "@/lib/approval-layer-previews"
        );
        await generateApprovalLayerPreviewsIfWaitingColumn(
          previewOrder as Pick<Order, "id" | "title" | "tenant_id" | "specs">,
          destCol
        );
      }
    } catch (err: unknown) {
      console.error(
        "[FastActionBtn] approval layer previews:",
        err instanceof Error ? err.message : err
      );
    }
    if (button.notification_rule_id) {
      try {
        await fireNotificationRules(orderId, destColumnId, tenantId);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("[FastActionBtn] notification error:", message);
      }
    }
  });

  // Portal → Bazaar status (fire-and-forget).
  void (async () => {
    try {
      const { data: fullOrder } = await supabase
        .from("orders")
        .select("id, title, webhook_source, specs")
        .eq("id", orderId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      const { data: col } = await supabase
        .from("board_columns")
        .select("name")
        .eq("id", destColumnId)
        .eq("tenant_id", tenantId)
        .maybeSingle();
      if (!fullOrder || !col?.name) return;
      const { notifyBazaarPortalStatus } = await import(
        "@/lib/bazaar-portal-sync"
      );
      await notifyBazaarPortalStatus({
        client: supabase,
        tenantId,
        order: {
          id: fullOrder.id as string,
          title: String(fullOrder.title ?? ""),
          webhook_source:
            (fullOrder.webhook_source as string | null | undefined) ?? null,
          specs:
            (fullOrder.specs as Record<string, unknown> | null | undefined) ??
            {},
        },
        columnName: col.name as string,
      });
      // Net-terms invoice on ship — a button move into a Fulfilled/Finished
      // column must fire the CRM fulfill ping too (not only drag via /api/orders/move).
      if (isFulfilledStage(col.name as string)) {
        try {
          await notifyCrmOrderFulfilled(fullOrder as unknown as Order, col.name as string);
        } catch (e) {
          console.error("[FastActionBtn] net-terms-fulfill:", e instanceof Error ? e.message : e);
        }
        try {
          await notifyCustomerOrderFinished(
            fullOrder as unknown as Order,
            col.name as string
          );
        } catch (e) {
          console.error(
            "[FastActionBtn] finished-sms:",
            e instanceof Error ? e.message : e
          );
        }
      }
    } catch (err: unknown) {
      console.error(
        "[FastActionBtn] bazaar-portal-sync:",
        err instanceof Error ? err.message : err
      );
    }
  })();

  return NextResponse.json({ ok: true });
}
